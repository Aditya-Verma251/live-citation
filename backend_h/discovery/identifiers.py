"""Normalize and classify scholarly-paper references entered by users.

Supported inputs:
- DOI strings and DOI resolver URLs
- arXiv IDs and arXiv abs/pdf URLs (new and legacy ID formats)
- OpenAlex work IDs and OpenAlex work URLs
- PubMed IDs and PubMed URLs
- Plain paper titles
- Plain topic keywords (when the caller explicitly selects keyword mode)

Unknown arbitrary URLs are rejected instead of being silently sent to text search.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import unquote, urlparse


DOI_RE = re.compile(r"(?i)(10\.\d{4,9}/[^\s\"<>?#]+)")
ARXIV_RE = re.compile(
    r"(?i)^(?:arxiv\s*:\s*)?((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*/\d{7})(?:v\d+)?)$"
)
OPENALEX_RE = re.compile(r"(?i)^W\d{5,}$")
PMID_RE = re.compile(r"(?i)^(?:pmid\s*:\s*)?(\d{6,10})$")


@dataclass(frozen=True)
class ParsedResearchInput:
    kind: str
    value: str
    original: str
    source_url: str | None = None


def _strip_wrappers(value: str) -> str:
    return value.strip().strip("<>\"' ").strip()


def normalize_doi_input(value: str) -> str | None:
    """Extract a clean DOI from a DOI string or URL."""
    candidate = unquote(_strip_wrappers(value))
    candidate = re.sub(r"(?i)^doi\s*:\s*", "", candidate)
    candidate = re.sub(r"(?i)^https?://(?:dx\.)?doi\.org/", "", candidate)
    candidate = re.sub(r"(?i)^https?://(?:www\.)?doi\.org/", "", candidate)
    match = DOI_RE.search(candidate)
    if not match:
        return None
    doi = match.group(1).rstrip(".,;:!?) ]}")
    return doi or None


def normalize_arxiv_id(value: str) -> str | None:
    candidate = unquote(_strip_wrappers(value))
    candidate = re.sub(r"(?i)^arxiv\s*:\s*", "", candidate)
    candidate = re.sub(r"(?i)\.pdf$", "", candidate)
    match = ARXIV_RE.fullmatch(candidate)
    return match.group(1) if match else None


def normalize_openalex_id(value: str) -> str | None:
    candidate = _strip_wrappers(value).rstrip("/")
    candidate = re.sub(r"(?i)^openalex\s*:\s*", "", candidate)
    if "://" in candidate:
        parsed = urlparse(candidate)
        if (parsed.hostname or "").lower() not in {"openalex.org", "www.openalex.org", "api.openalex.org"}:
            return None
        candidate = parsed.path.rstrip("/").split("/")[-1]
    if "/" in candidate:
        candidate = candidate.rstrip("/").split("/")[-1]
    return candidate.upper() if OPENALEX_RE.fullmatch(candidate) else None


def normalize_pmid(value: str) -> str | None:
    match = PMID_RE.fullmatch(_strip_wrappers(value))
    return match.group(1) if match else None


def parse_research_input(value: str) -> ParsedResearchInput:
    """Classify a user-entered identifier, supported URL, or paper title."""
    original = value
    candidate = _strip_wrappers(value)
    if not candidate:
        raise ValueError("Enter a research keyword, paper title, DOI, arXiv ID, OpenAlex ID, PMID or supported paper URL.")

    # URLs: inspect provider path first, then look for an embedded DOI.
    if re.match(r"(?i)^https?://", candidate):
        parsed = urlparse(candidate)
        host = (parsed.hostname or "").lower()
        path = unquote(parsed.path or "")
        if host in {"doi.org", "dx.doi.org", "www.doi.org"}:
            doi = normalize_doi_input(candidate)
            if doi:
                return ParsedResearchInput("doi", doi, original, candidate)

        if host == "openalex.org" or host.endswith(".openalex.org"):
            openalex_id = normalize_openalex_id(candidate)
            if openalex_id:
                return ParsedResearchInput("openalex", openalex_id, original, candidate)

        if host == "arxiv.org" or host.endswith(".arxiv.org"):
            parts = [part for part in path.split("/") if part]
            if len(parts) >= 2 and parts[0].lower() in {"abs", "pdf"}:
                # Legacy arXiv identifiers contain a slash, e.g. hep-th/9901001.
                arxiv_reference = "/".join(parts[1:])
                arxiv_id = normalize_arxiv_id(arxiv_reference)
                if arxiv_id:
                    return ParsedResearchInput("arxiv", arxiv_id, original, candidate)

        if host in {"pubmed.ncbi.nlm.nih.gov", "www.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov"}:
            numeric_parts = [part for part in path.split("/") if part.isdigit()]
            if numeric_parts:
                return ParsedResearchInput("pmid", numeric_parts[0], original, candidate)

        embedded_doi = normalize_doi_input(candidate)
        if embedded_doi:
            return ParsedResearchInput("doi", embedded_doi, original, candidate)

        raise ValueError(
            "This paper URL is not a recognized DOI, arXiv, OpenAlex or PubMed URL. "
            "Paste its DOI, a supported identifier URL, or the exact paper title instead."
        )

    doi = normalize_doi_input(candidate)
    if doi:
        return ParsedResearchInput("doi", doi, original)

    arxiv_id = normalize_arxiv_id(candidate)
    if arxiv_id:
        return ParsedResearchInput("arxiv", arxiv_id, original)

    openalex_id = normalize_openalex_id(candidate)
    if openalex_id:
        return ParsedResearchInput("openalex", openalex_id, original)

    pmid = normalize_pmid(candidate)
    if pmid:
        return ParsedResearchInput("pmid", pmid, original)

    return ParsedResearchInput("title", candidate, original)


def normalize_title(value: str | None) -> str:
    if not value:
        return ""
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def title_match_score(query: str, candidate: str) -> float:
    """Conservative, deterministic title similarity used to resolve paper titles."""
    from difflib import SequenceMatcher

    left = normalize_title(query)
    right = normalize_title(candidate)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0

    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return 0.0
    token_f1 = (2 * len(left_tokens & right_tokens)) / (len(left_tokens) + len(right_tokens))
    sequence = SequenceMatcher(None, left, right).ratio()
    return round(0.55 * sequence + 0.45 * token_f1, 4)
