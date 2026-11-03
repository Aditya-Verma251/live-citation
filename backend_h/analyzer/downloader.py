"""Download legally accessible open-access PDFs from MVP 1 discovery records.

Primary source: OpenAlex best_oa_location.pdf_url saved as `pdf_url` by MVP 1.
Fallback: Unpaywall DOI endpoint (requires an email query parameter).
This module never attempts to bypass a paywall or fetch a landing page as a PDF.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from . import config


class DownloadError(RuntimeError):
    """A PDF could not be retrieved or validated."""


def safe_paper_id(value: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value)).strip("._")
    return clean[:100] or "paper"


def _get_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": config.USER_AGENT, "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.HTTP_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise DownloadError(f"Metadata lookup returned HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise DownloadError(f"Could not contact open-access metadata service: {exc}") from exc


def _unpaywall_candidates(doi: str) -> tuple[list[dict[str, Any]], str]:
    """Return all direct PDF URLs from Unpaywall's OA locations.

    Unpaywall's best location is preferred, but another OA location may be the
    one that exposes a direct PDF URL. Landing-page URLs are deliberately not
    treated as PDFs.
    """
    if not config.UNPAYWALL_EMAIL:
        return [], ""

    encoded_doi = urllib.parse.quote(doi.strip(), safe="/")
    query = urllib.parse.urlencode({"email": config.UNPAYWALL_EMAIL})
    data = _get_json(f"https://api.unpaywall.org/v2/{encoded_doi}?{query}")

    if data.get("is_oa") is not True:
        status = data.get("oa_status") or "closed / unknown"
        return [], f"Unpaywall was queried, but reports no open-access copy (oa_status={status})."

    locations: list[dict[str, Any]] = []
    best = data.get("best_oa_location")
    if isinstance(best, dict):
        locations.append(best)
    for location in data.get("oa_locations") or []:
        if isinstance(location, dict) and location not in locations:
            locations.append(location)

    candidates: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for location in locations:
        pdf_url = str(location.get("url_for_pdf") or "").strip()
        if not pdf_url or pdf_url in seen_urls:
            continue
        seen_urls.add(pdf_url)
        candidates.append({
            "url": pdf_url,
            "license": location.get("license"),
            "version": location.get("version"),
            "host_type": location.get("host_type"),
            "source": "Unpaywall best_oa_location" if location is best else "Unpaywall oa_locations",
            "is_open_access": True,
        })

    if candidates:
        return candidates, ""
    return [], "Unpaywall reports an open-access copy, but none of its locations has a direct PDF URL."


def get_pdf_candidates(paper: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    """Return legal OA PDF candidates and a useful reason when none are known."""
    candidates: list[dict[str, Any]] = []
    doi = (paper.get("doi") or "").strip()

    # An OpenAlex OA URL is usable only when the record does not explicitly
    # mark the work closed. A false OA flag must not prevent DOI fallback.
    if paper.get("is_open_access") is not False and paper.get("pdf_url"):
        candidates.append({
            "url": paper["pdf_url"],
            "license": paper.get("license"),
            "version": paper.get("version"),
            "host_type": None,
            "source": "OpenAlex best_oa_location",
            "is_open_access": True,
        })

    unpaywall_note: str | None = None
    if doi:
        try:
            fallback_candidates, unpaywall_note = _unpaywall_candidates(doi)
            for candidate in fallback_candidates:
                if all(existing["url"] != candidate["url"] for existing in candidates):
                    candidates.append(candidate)
        except DownloadError as exc:
            unpaywall_note = f"Unpaywall lookup failed: {exc}"
            # Preserve any valid OpenAlex candidate if Unpaywall is temporarily unavailable.
            if not candidates:
                raise

    if candidates:
        return candidates, None

    if not doi and not paper.get("pdf_url"):
        return [], "No DOI or direct OA PDF URL is available for this paper."
    if unpaywall_note:
        return [], unpaywall_note
    if doi and not config.UNPAYWALL_EMAIL:
        return [], (
            "OpenAlex marks this work as not open access and no direct PDF URL was supplied. "
            "Unpaywall was not queried because UNPAYWALL_EMAIL is missing; create a .env file "
            "in the MVP 2 project root and set UNPAYWALL_EMAIL."
        )
    if paper.get("is_open_access") is False:
        return [], "OpenAlex and Unpaywall did not provide an accessible open-access PDF."
    return [], "No direct PDF was found in the available open-access locations."


def download_pdf(
    paper: dict[str, Any],
    output_dir: Path,
    *,
    force: bool = False,
    max_pdf_mb: int | None = None,
) -> dict[str, Any]:
    """Download and validate one OA PDF. Existing valid files are reused."""
    paper_id = safe_paper_id(paper.get("id") or paper.get("openalex_id") or paper.get("doi") or paper.get("title") or "paper")
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / f"{paper_id}.pdf"
    limit_bytes = (max_pdf_mb or config.MAX_PDF_MB) * 1024 * 1024

    if destination.exists() and not force:
        with destination.open("rb") as existing_file:
            header = existing_file.read(5)
        if header == b"%PDF-":
            return {
                "status": "reused",
                "pdf_path": str(destination),
                "bytes": destination.stat().st_size,
                "source_url": None,
                "source": "previous download",
                "license": paper.get("license"),
                "message": "Existing validated PDF reused.",
            }
        destination.unlink(missing_ok=True)

    candidates, reason = get_pdf_candidates(paper)
    if not candidates:
        return {"status": "skipped", "pdf_path": None, "message": reason}

    errors: list[str] = []
    for candidate in candidates:
        url = str(candidate.get("url") or "").strip()
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            errors.append("Rejected a non-HTTP(S) PDF URL.")
            continue
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": config.USER_AGENT,
                "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.5",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=config.HTTP_TIMEOUT_SECONDS) as response:
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > limit_bytes:
                    raise DownloadError(f"PDF exceeds configured size limit ({max_pdf_mb or config.MAX_PDF_MB} MB).")
                payload = response.read(limit_bytes + 1)
            if len(payload) > limit_bytes:
                raise DownloadError(f"PDF exceeds configured size limit ({max_pdf_mb or config.MAX_PDF_MB} MB).")
            if not payload.startswith(b"%PDF-"):
                raise DownloadError("The URL did not return PDF data (PDF signature missing).")
            temp_path = destination.with_suffix(".pdf.part")
            temp_path.write_bytes(payload)
            temp_path.replace(destination)
            return {
                "status": "downloaded",
                "pdf_path": str(destination),
                "bytes": len(payload),
                "source_url": url,
                "source": candidate.get("source"),
                "license": candidate.get("license"),
                "version": candidate.get("version"),
                "host_type": candidate.get("host_type"),
                "message": "Open-access PDF downloaded and PDF signature validated.",
            }
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, DownloadError, ValueError) as exc:
            errors.append(str(exc))
            continue

    return {
        "status": "failed",
        "pdf_path": None,
        "message": "All open-access PDF candidates failed: " + " | ".join(errors[:3]),
    }
