"""Local PDF and GROBID parsers with section/page provenance.

The parser exposes a stable, provider-neutral result containing section text,
page ranges, document quality and warnings. It does not perform OCR.
"""
from __future__ import annotations

import re
import statistics
import urllib.error
import urllib.request
import uuid
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Any

import pymupdf as fitz

from . import config


class ParseError(RuntimeError):
    """The PDF could not be parsed into extractable text."""


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _text(element: ET.Element | None) -> str:
    if element is None:
        return ""
    return re.sub(r"\s+", " ", " ".join(element.itertext())).strip()


def _section_number(heading: str) -> str | None:
    match = re.match(r"^\s*((?:\d+(?:\.\d+)*[.)]?|[IVX]+[.)]))\s+", heading or "", re.I)
    return match.group(1).rstrip(".)") if match else None


def _heading_base(heading: str) -> str:
    return re.sub(r"^\s*(?:(?:\d+(?:\.\d+)*[.)]?|[IVX]+[.)])\s+)", "", heading or "").strip()


def _is_back_matter_heading(heading: str) -> bool:
    base = _heading_base(heading).casefold().strip(" .:")
    return base in {
        "references", "bibliography", "works cited", "literature cited",
        "referencias", "daftar rujukan", "daftar pustaka",
        "acknowledgements", "acknowledgments", "agradecimientos", "agradecimentos",
        "ucapan terima kasih", "funding", "author contributions",
        "conflict of interest", "conflicts of interest", "supplementary material",
        "appendix references",
    }


def _normalise_heading_for_match(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = re.sub(r"\s+", " ", normalized).strip().casefold()
    return normalized


_HEADING_ALIASES = {
    "abstract", "summary", "resumen", "resumo", "abstrak",
    "introduction", "introduccion", "introducao", "pendahuluan", "background", "preamble",
    "motivation", "problem statement", "planteamiento del problema",
    "related work", "literature review", "previous work", "tinjauan pustaka", "kajian pustaka",
    "preliminaries", "method", "methods", "methodology", "metodologia", "metode",
    "metode penelitian", "materials and methods", "materiales y metodos", "materiais e metodos",
    "bahan dan metode", "research design", "approach", "proposed approach", "proposed method",
    "proposed framework", "system model", "system design", "architecture", "implementation",
    "experimental setup", "data and methods", "data collection",
    "experimental results", "result", "results", "evaluation", "experiments", "experiment",
    "performance evaluation", "ablation study", "findings", "hasil", "hasil penelitian",
    "hasil dan pembahasan", "discussion", "general discussion", "discusion", "discussao",
    "pembahasan", "diskusi", "conclusion", "conclusions", "concluding remarks", "summary and outlook",
    "conclusiones", "conclusao", "kesimpulan", "penutup", "limitations", "limitation",
    "study limitations", "threats to validity", "limitaciones", "limitacoes", "keterbatasan",
    "future work", "future directions", "future research", "open problems", "open challenges",
    "trabajo futuro", "trabalhos futuros", "penelitian selanjutnya", "arah penelitian", "saran",
    "contributions", "contribution", "references", "bibliography", "acknowledgements",
    "acknowledgments", "table of contents", "contents", "daftar isi",
}


def _is_known_heading(value: str) -> bool:
    normalized = _normalise_heading_for_match(value)
    normalized = re.sub(r"^\s*(?:(?:\d+(?:\.\d+)*[.)]?|[ivx]+[.)])\s+)", "", normalized)
    normalized = normalized.strip(" .:;–—")
    return normalized in _HEADING_ALIASES


_NUMBERED_HEADING = re.compile(
    r"^\s*((?:\d+(?:\.\d+)*[.)]?|[IVX]+[.)]))\s+(.{2,100})$",
    re.IGNORECASE,
)
_TOC_LEADERS = re.compile(r"(?:\.{3,}|…{2,}|_{3,}|-{4,})\s*\d+\s*$")


def _looks_like_heading(line: str) -> bool:
    """Lexical heading detector; generic numbered lines need layout evidence."""
    candidate = re.sub(r"\s+", " ", line or "").strip().strip(".:; ")
    if not candidate or len(candidate) > 120 or len(candidate) < 3:
        return False
    if _is_known_heading(candidate):
        return True
    return False


def _extract_lines(page: fitz.Page) -> list[dict[str, Any]]:
    """Extract visual lines, text-block context and typographic attributes."""
    records: list[dict[str, Any]] = []
    try:
        page_dict = page.get_text("dict", sort=True)
    except TypeError:  # Older PyMuPDF releases do not accept sort here.
        page_dict = page.get_text("dict")

    previous_y1: float | None = None
    for block_index, block in enumerate(page_dict.get("blocks", [])):
        if block.get("type", 0) != 0:
            continue
        raw_lines = []
        for line_index, line in enumerate(block.get("lines", [])):
            spans = line.get("spans", [])
            line_text = "".join(str(span.get("text") or "") for span in spans)
            line_text = re.sub(r"\s+", " ", line_text).strip()
            if not line_text:
                continue
            sizes = [float(span.get("size") or 0) for span in spans if span.get("text", "").strip()]
            total_chars = sum(len(str(span.get("text") or "")) for span in spans)
            bold_chars = sum(
                len(str(span.get("text") or ""))
                for span in spans
                if bool(int(span.get("flags", 0)) & 16)
                or "bold" in str(span.get("font", "")).casefold()
            )
            bold_ratio = (bold_chars / total_chars) if total_chars else 0.0
            bold = bold_ratio >= 0.65
            bbox = line.get("bbox") or block.get("bbox") or (0, 0, 0, 0)
            raw_lines.append({
                "text": line_text,
                "font_size": max(sizes, default=0.0),
                "bold": bold,
                "bold_ratio": round(bold_ratio, 3),
                "bbox": tuple(float(v) for v in bbox),
                "block_index": block_index,
                "line_index": line_index,
            })

        block_line_count = len(raw_lines)
        for item in raw_lines:
            y0 = item["bbox"][1]
            y1 = item["bbox"][3]
            item["block_line_count"] = block_line_count
            item["line_height"] = max(0.0, y1 - y0)
            item["gap_before"] = max(0.0, y0 - previous_y1) if previous_y1 is not None else 0.0
            records.append(item)
            previous_y1 = y1

    if records:
        return records

    # Fallback for unusual PDF text dictionaries.
    for line_index, line in enumerate((page.get_text("text") or "").splitlines()):
        clean = re.sub(r"\s+", " ", line).strip()
        if clean:
            records.append({
                "text": clean, "font_size": 0.0, "bold": False,
                "bbox": (0, 0, 0, 0), "block_index": line_index,
                "line_index": 0, "block_line_count": 1,
                "line_height": 0.0, "gap_before": 0.0,
            })
    return records


def _title_case_ratio(text: str) -> float:
    words = [word for word in re.findall(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*", text) if len(word) > 2]
    if not words:
        return 0.0
    function_words = {"and", "or", "of", "to", "for", "in", "on", "with", "the", "a", "an", "dan", "yang", "dari", "untuk"}
    content = [word for word in words if word.casefold() not in function_words]
    if not content:
        return 0.0
    return sum(word[0].isupper() or word.isupper() for word in content) / len(content)


def _is_styled_heading(line: dict[str, Any], median_body_size: float) -> bool:
    text = str(line.get("text") or "").strip()
    if not text:
        return False
    # These are often ordinary prose fragments, equation labels or chart labels.
    if _TOC_LEADERS.search(text) or re.search(r"[.!?]$", text):
        return False

    block_line_count = int(line.get("block_line_count") or 1)
    if _is_known_heading(text):
        # Exact, unpunctuated section labels can be embedded in a text block
        # with the paragraph that follows (common in conference PDFs).
        # Reject sentence punctuation so a prose fragment like "dataset." is
        # not mistaken for a heading.
        return len(text.split()) <= 10 and not re.search(r"[.!?]$", text)

    if len(text) > 115 or len(text.split()) > 14 or block_line_count != 1:
        return False

    numbered = _NUMBERED_HEADING.match(text)
    title = numbered.group(2).strip() if numbered else text
    words = title.split()
    if not words or len(words) > 13:
        return False
    if not numbered and len(words) < 2:
        return False
    if numbered:
        # Numbered paragraph prose commonly starts with a number (e.g. "12
        # years of age..."). Actual heading titles normally start with an
        # uppercase word and are short, isolated lines.
        if not title[0].isupper() and not title.isupper():
            return False
        if _title_case_ratio(title) < 0.32 and not title.isupper():
            return False
    else:
        # An unnumbered line needs stronger visual and title-like evidence.
        if not title[:1].isupper():
            return False
        sentence_starters = {
            "to", "we", "our", "this", "these", "those", "the", "a", "an",
            "however", "therefore", "because", "although", "patients", "any",
            "for", "in", "on", "of", "based", "according", "where", "if", "as",
        }
        if title.split()[0].casefold() in sentence_starters:
            return False
        if _title_case_ratio(title) < 0.45 and not title.isupper():
            return False

    lowered = _normalise_heading_for_match(text)
    if re.match(r"^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$", lowered):
        return False
    if any(token in lowered for token in (
        "issn", "isbn", "doi:", "journal of", "proceedings of", "university",
        "department of", "corresponding author", "edited by", "reviewed by",
        "received ", "accepted ", "copyright", "vol.", "volume ", "issue ",
        "author information", "data availability statement", "ethics statement",
    )):
        return False
    if text.count(",") >= 3:
        return False

    size = float(line.get("font_size") or 0)
    if median_body_size <= 0 or size <= 0:
        return False
    ratio = size / median_body_size
    bold_ratio = float(line.get("bold_ratio", 1.0 if line.get("bold") else 0.0))
    is_bold = bold_ratio >= 0.65
    gap_before = float(line.get("gap_before") or 0)
    line_height = float(line.get("line_height") or 0)
    separated = gap_before >= max(3.0, line_height * 0.28)

    if numbered:
        # A bold, enlarged numbered heading may share a PDF text block with
        # following body lines (seen in some publisher layouts). Otherwise,
        # require an isolated line with typography/spacing evidence.
        if is_bold and ratio >= 1.15:
            return True
        return (
            block_line_count == 1
            and (ratio >= 1.12 or separated)
            and (_title_case_ratio(title) >= 0.32 or title.isupper())
        )
    # Unknown unnumbered section headings must be visually distinct as well as
    # title-like; chart labels and ordinary body fragments fail this test.
    return (is_bold and ratio >= 1.18) or (block_line_count == 1 and ratio >= 1.48)


def _repeated_margin_lines(page_lines: list[list[dict[str, Any]]], page_heights: list[float]) -> set[str]:
    """Identify repeated short running headers/footers without removing body text."""
    occurrences: Counter[str] = Counter()
    for lines, height in zip(page_lines, page_heights):
        seen_on_page: set[str] = set()
        for line in lines:
            text = re.sub(r"\s+", " ", str(line.get("text") or "")).strip()
            if not text or len(text) > 90:
                continue
            y0 = line.get("bbox", (0, 0, 0, 0))[1]
            y1 = line.get("bbox", (0, 0, 0, 0))[3]
            if y0 <= height * 0.07 or y1 >= height * 0.93:
                key = text.casefold()
                if key not in seen_on_page:
                    occurrences[key] += 1
                    seen_on_page.add(key)
    minimum = max(2, (len(page_lines) + 1) // 3)
    return {text for text, count in occurrences.items() if count >= minimum}


def parse_tei_xml(xml_bytes: bytes) -> dict[str, Any]:
    """Convert GROBID TEI XML into sections, page ranges and document metadata."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise ParseError(f"GROBID returned invalid TEI XML: {exc}") from exc

    title = ""
    abstract = ""
    header = next((node for node in root.iter() if _local_name(node.tag) == "teiHeader"), None)
    title_scope = header if header is not None else root
    for element in title_scope.iter():
        if _local_name(element.tag) == "title":
            title = _text(element)
            if title:
                break

    for element in root.iter():
        name = _local_name(element.tag)
        element_type = (element.attrib.get("type") or "").casefold()
        if name == "abstract" or (name == "div" and element_type == "abstract"):
            paragraphs = [
                _text(child) for child in element.iter()
                if _local_name(child.tag) == "p" and _text(child)
            ]
            abstract = " ".join(paragraphs).strip() or _text(element)
            if abstract:
                break

    body = next((node for node in root.iter() if _local_name(node.tag) == "body"), None)
    sections: list[dict[str, Any]] = []
    current_page = 1
    max_page = 1

    def visit_div(div: ET.Element, inherited_heading: str = "", level: int = 1) -> None:
        nonlocal current_page, max_page
        heading = ""
        paragraphs: list[str] = []
        page_values: list[int] = []
        child_divisions: list[ET.Element] = []

        for child in list(div):
            name = _local_name(child.tag)
            if name == "pb":
                label = child.attrib.get("n") or child.attrib.get("facs")
                match = re.search(r"\d+", str(label or ""))
                if match:
                    current_page = int(match.group())
                    max_page = max(max_page, current_page)
            elif name == "head" and not heading:
                heading = _text(child)
            elif name == "p":
                paragraph = _text(child)
                if paragraph:
                    paragraphs.append(paragraph)
                    page_values.append(current_page)
                    for pb in child.iter():
                        if _local_name(pb.tag) == "pb":
                            match = re.search(r"\d+", str(pb.attrib.get("n") or pb.attrib.get("facs") or ""))
                            if match:
                                current_page = int(match.group())
                                max_page = max(max_page, current_page)
                                page_values.append(current_page)
            elif name == "div":
                child_divisions.append(child)

        label = heading or inherited_heading or "Unlabelled section"
        if paragraphs:
            start_page = min(page_values) if page_values else current_page
            end_page = max(page_values) if page_values else current_page
            sections.append({
                "heading": label,
                "text": "\n\n".join(paragraphs),
                "page_start": start_page,
                "page_end": end_page,
                "heading_level": level,
                "section_number": _section_number(label),
                "parent_heading": inherited_heading or None,
            })
        for nested in child_divisions:
            visit_div(nested, label, level + 1)

    if body is not None:
        for div in list(body):
            if _local_name(div.tag) == "pb":
                match = re.search(r"\d+", str(div.attrib.get("n") or ""))
                if match:
                    current_page = int(match.group())
                    max_page = max(max_page, current_page)
            elif _local_name(div.tag) == "div":
                visit_div(div)

    full_text = "\n\n".join(part for part in [abstract, *[s["text"] for s in sections]] if part)
    warnings: list[str] = []
    if not sections:
        warnings.append("GROBID returned no structured body sections.")
    if not abstract:
        warnings.append("No abstract was identified in the TEI document.")

    return {
        "parser": "grobid",
        "title": title or None,
        "abstract": abstract or None,
        "page_count": max_page if max_page > 1 else None,
        "sections": sections,
        "pages": [],
        "full_text": full_text,
        "warnings": warnings,
        "document_quality": {
            "extractable_text": bool(full_text.strip()),
            "text_characters": len(full_text),
            "page_count": max_page if max_page > 1 else None,
            "section_count": len(sections),
            "empty_text_pages": [],
            "section_structure": "tei_hierarchy",
        },
    }


def parse_with_pymupdf(pdf_path: Path) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    page_lines: list[list[dict[str, Any]]] = []
    page_heights: list[float] = []
    all_font_sizes: list[float] = []

    try:
        document = fitz.open(pdf_path)
    except Exception as exc:
        raise ParseError(f"PyMuPDF could not open {pdf_path}: {exc}") from exc

    try:
        metadata = document.metadata or {}
        document_title = (metadata.get("title") or "").strip()

        for page_index, page in enumerate(document, start=1):
            lines = _extract_lines(page)
            page_lines.append(lines)
            page_heights.append(float(page.rect.height))
            for line in lines:
                size = float(line.get("font_size") or 0)
                if size > 0 and len(str(line.get("text") or "").strip()) > 1:
                    all_font_sizes.append(size)
            page_text = page.get_text("text", sort=True) or ""
            pages.append({
                "page": page_index,
                "text": page_text.strip(),
                "character_count": len(page_text.strip()),
                "line_count": len([line for line in lines if line.get("text")]),
            })

        full_text = "\n\n".join(page["text"] for page in pages if page["text"])
        if len(full_text.strip()) < 80:
            raise ParseError(
                "No meaningful selectable text was extracted. This may be a scanned PDF; OCR is not included."
            )

        median_body_size = statistics.median(all_font_sizes) if all_font_sizes else 0.0
        repeated_margin = _repeated_margin_lines(page_lines, page_heights)

        sections: list[dict[str, Any]] = []
        current_heading = "Front matter"
        current_lines: list[str] = []
        current_start: int | None = None
        current_end: int | None = None
        current_level = 1
        current_number: str | None = None
        stopped_at_references = False
        in_table_of_contents = False

        def flush_section() -> None:
            nonlocal current_lines, current_start, current_end
            text = "\n".join(line for line in current_lines if line).strip()
            if text:
                sections.append({
                    "heading": current_heading,
                    "text": text,
                    "page_start": current_start,
                    "page_end": current_end,
                    "heading_level": current_level,
                    "section_number": current_number,
                })
            current_lines = []
            current_start = None
            current_end = None

        for page_index, lines in enumerate(page_lines, start=1):
            if stopped_at_references:
                break
            for line in lines:
                text = re.sub(r"\s+", " ", str(line.get("text") or "")).strip()
                if not text:
                    continue
                if text.casefold() in repeated_margin:
                    continue

                is_heading = _is_styled_heading(line, median_body_size)
                normalized_text = _normalise_heading_for_match(text).strip(" .:")

                if is_heading and normalized_text in {"table of contents", "contents", "daftar isi"}:
                    flush_section()
                    in_table_of_contents = True
                    current_heading = "Front matter"
                    current_start = None
                    current_end = None
                    continue

                if in_table_of_contents:
                    # Resume at the first real first-level section. Hierarchical
                    # entries and dotted leader lines belong to the contents list.
                    number = _section_number(text)
                    title = _heading_base(text)
                    first_level = bool(number and "." not in number)
                    known_major = _is_known_heading(title) and _normalise_heading_for_match(title) in {
                        "introduction", "background", "preamble", "method", "methods", "methodology",
                        "materials and methods", "metode penelitian", "pendahuluan",
                    }
                    toc_bold = float(line.get("bold_ratio", 1.0 if line.get("bold") else 0.0)) >= 0.65
                    toc_prominent = (
                        toc_bold
                        or float(line.get("font_size") or 0) >= median_body_size * 1.1
                        or float(line.get("gap_before") or 0) >= max(3.0, float(line.get("line_height") or 0) * 0.28)
                    )
                    real_start = (
                        is_heading
                        and not _TOC_LEADERS.search(text)
                        and ((first_level and known_major and toc_prominent)
                             or (not number and known_major and toc_prominent))
                    )
                    if not real_start:
                        continue
                    in_table_of_contents = False

                if is_heading:
                    if _is_back_matter_heading(text):
                        flush_section()
                        stopped_at_references = True
                        break
                    flush_section()
                    current_heading = text
                    current_start = page_index
                    current_end = page_index
                    current_number = _section_number(text)
                    current_level = max(1, current_number.count(".") + 1) if current_number else 1
                else:
                    if current_start is None:
                        current_start = page_index
                    current_end = page_index
                    current_lines.append(text)
            # Page boundaries are represented by page_start/page_end ranges.

        flush_section()

        # Prefer an explicit Abstract section. Some publishers omit the heading
        # but retain PDF metadata/abstract text in the first page's front matter.
        abstract = None
        for section in sections:
            section_heading = _normalise_heading_for_match(_heading_base(section["heading"])).strip(" .:")
            if section_heading in {"abstract", "abstrak", "resumen", "resumo"}:
                abstract = section["text"]
                break

        # If metadata has no title, use a short visually prominent first-page line.
        if not document_title and page_lines:
            first_page_candidates = [
                line for line in page_lines[0]
                if len(str(line.get("text") or "").split()) >= 3
                and len(str(line.get("text") or "")) <= 220
                and float(line.get("font_size") or 0) >= median_body_size * 1.25
                and not _looks_like_heading(str(line.get("text") or ""))
            ]
            if first_page_candidates:
                document_title = max(first_page_candidates, key=lambda item: float(item.get("font_size") or 0))["text"]

        empty_pages = [page["page"] for page in pages if page["character_count"] == 0]
        warnings: list[str] = []
        if empty_pages:
            warnings.append(f"No selectable text was found on {len(empty_pages)} page(s).")
        if not abstract:
            warnings.append("No explicitly headed abstract section was identified.")
        if len(sections) <= 1:
            warnings.append("Few section headings were identified; extraction may rely on unstructured text.")
        if len(document) >= 6 and len(sections) <= 3:
            warnings.append("The document has few detected sections for its length; verify publisher layout, columns, or OCR requirements.")
        if len(document) >= 6 and empty_pages and len(empty_pages) / len(document) >= 0.2:
            warnings.append("A substantial share of pages has no selectable text; OCR may be required for complete extraction.")

        page_char_counts = [page["character_count"] for page in pages]
        quality = {
            "extractable_text": True,
            "text_characters": len(full_text),
            "page_count": len(document),
            "average_characters_per_page": round(sum(page_char_counts) / len(page_char_counts), 1) if page_char_counts else 0.0,
            "empty_text_pages": empty_pages,
            "section_count": len(sections),
            "median_body_font_size": round(median_body_size, 2) if median_body_size else None,
            "repeated_margin_lines_removed": len(repeated_margin),
            "stopped_before_references": stopped_at_references,
            "section_structure": "typographic_and_heading_rules",
        }
        return {
            "parser": "pymupdf",
            "title": document_title or None,
            "abstract": abstract,
            "page_count": len(document),
            "sections": sections,
            "pages": pages,
            "full_text": full_text,
            "warnings": warnings,
            "document_quality": quality,
        }
    finally:
        document.close()


def _call_grobid(pdf_path: Path, grobid_url: str) -> dict[str, Any]:
    boundary = "----PaperAnalyzer" + uuid.uuid4().hex
    pdf_bytes = pdf_path.read_bytes()
    filename = pdf_path.name.replace('"', "")
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="input"; filename="{filename}"\r\n'
        "Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8") + pdf_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")
    request = urllib.request.Request(
        f"{grobid_url.rstrip('/')}/api/processFulltextDocument",
        data=body,
        headers={
            "User-Agent": config.USER_AGENT,
            "Accept": "application/xml",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.GROBID_TIMEOUT_SECONDS) as response:
            xml_bytes = response.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ParseError(f"GROBID request failed: {exc}") from exc
    result = parse_tei_xml(xml_bytes)
    if not result.get("full_text", "").strip():
        raise ParseError("GROBID returned TEI without extractable body text.")
    return result


def parse_pdf(
    pdf_path: str | Path,
    backend: str = "auto",
    grobid_url: str | None = None,
) -> dict[str, Any]:
    """Parse a PDF. ``auto`` tries GROBID first and falls back to PyMuPDF."""
    path = Path(pdf_path)
    if not path.exists() or not path.is_file():
        raise ParseError(f"PDF file does not exist: {path}")
    if path.suffix.lower() != ".pdf":
        raise ParseError(f"Expected a .pdf file, got: {path.name}")
    if backend not in {"auto", "grobid", "pymupdf"}:
        raise ValueError("backend must be auto, grobid, or pymupdf")

    service_url = grobid_url or config.GROBID_URL
    if backend in {"auto", "grobid"} and service_url:
        try:
            return _call_grobid(path, service_url)
        except ParseError as exc:
            if backend == "grobid":
                raise
            result = parse_with_pymupdf(path)
            result.setdefault("warnings", []).append(
                f"GROBID unavailable; PyMuPDF fallback used. Detail: {exc}"
            )
            return result
    if backend == "grobid":
        raise ParseError("GROBID backend requested but GROBID_URL is empty.")
    return parse_with_pymupdf(path)
