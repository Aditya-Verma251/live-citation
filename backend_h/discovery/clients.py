"""Small OpenAlex REST client used by the discovery pipeline.

API docs: https://help.openalex.org/api/
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any, Iterable

from . import config


class OpenAlexError(RuntimeError):
    """Raised when OpenAlex returns an error or cannot be reached."""


WORK_FIELDS = ",".join(
    [
        "id",
        "ids",
        "doi",
        "title",
        "publication_year",
        "publication_date",
        "type",
        "cited_by_count",
        "authorships",
        "primary_location",
        "best_oa_location",
        "open_access",
        "referenced_works",
        "related_works",
        "abstract_inverted_index",
    ]
)


class OpenAlexClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self.base_url = (base_url or config.OPENALEX_BASE_URL).rstrip("/")
        self.api_key = config.OPENALEX_API_KEY if api_key is None else api_key

    def _get_json(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        query = dict(params or {})
        query.setdefault("select", WORK_FIELDS)
        if self.api_key:
            query["api_key"] = self.api_key
        if config.CONTACT_EMAIL:
            query["mailto"] = config.CONTACT_EMAIL
        url = f"{self.base_url}{path}?{urllib.parse.urlencode(query, doseq=True)}"
        request = urllib.request.Request(
            url,
            headers={"User-Agent": config.USER_AGENT, "Accept": "application/json"},
            method="GET",
        )

        last_error: Exception | None = None
        for attempt in range(config.MAX_RETRIES + 1):
            try:
                with urllib.request.urlopen(request, timeout=config.HTTP_TIMEOUT_SECONDS) as response:
                    payload = response.read().decode("utf-8")
                    return json.loads(payload)
            except urllib.error.HTTPError as exc:
                last_error = exc
                # Retry throttling and transient server-side failures only.
                if exc.code not in (429, 500, 502, 503, 504) or attempt >= config.MAX_RETRIES:
                    detail = exc.read().decode("utf-8", errors="replace")[:500]
                    raise OpenAlexError(
                        f"OpenAlex returned HTTP {exc.code}. Response: {detail}"
                    ) from exc
                retry_after = exc.headers.get("Retry-After")
                delay = float(retry_after) if retry_after and retry_after.isdigit() else 1.5 * (attempt + 1)
                time.sleep(min(delay, 10))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt >= config.MAX_RETRIES:
                    break
                time.sleep(0.75 * (attempt + 1))

        raise OpenAlexError(
            "Could not reach OpenAlex. Check your internet connection, API base URL, "
            f"and firewall/DNS settings. Last error: {last_error}"
        ) from last_error

    def search_works(self, query: str, per_page: int = 5) -> list[dict[str, Any]]:
        data = self._get_json(
            "/works",
            {"search": query, "per_page": min(max(per_page, 1), 100), "sort": "relevance_score:desc"},
        )
        return data.get("results", [])

    def lookup_doi(self, doi: str) -> list[dict[str, Any]]:
        normalized = normalize_doi(doi)
        data = self._get_json(
            "/works",
            {
                "filter": f"doi:https://doi.org/{normalized}",
                "per_page": 1,
            },
        )
        return data.get("results", [])

    def lookup_pmid(self, pmid: str) -> list[dict[str, Any]]:
        """Resolve a PubMed identifier using OpenAlex's supported PMID lookup."""
        normalized = str(pmid).strip()
        data = self._get_json("/works/pmid:" + normalized)
        return [data] if isinstance(data, dict) and data.get("id") else []

    def get_work_by_id(self, work_id: str) -> dict[str, Any] | None:
        """Fetch one OpenAlex work by its canonical W identifier."""
        short_id = short_openalex_id(work_id)
        if not short_id.upper().startswith("W"):
            raise ValueError("OpenAlex work identifiers must start with W.")
        data = self._get_json(f"/works/{short_id}")
        return data if isinstance(data, dict) and data.get("id") else None

    def get_works_by_ids(self, work_ids: Iterable[str]) -> list[dict[str, Any]]:
        ids = [short_openalex_id(value) for value in work_ids if value]
        ids = list(dict.fromkeys(value for value in ids if value))[:100]
        if not ids:
            return []
        data = self._get_json(
            "/works",
            {"filter": "openalex:" + "|".join(ids), "per_page": len(ids)},
        )
        return data.get("results", [])

    def get_citing_works(self, work_id: str, per_page: int = 5) -> list[dict[str, Any]]:
        short_id = short_openalex_id(work_id)
        data = self._get_json(
            "/works",
            {
                "filter": f"cites:{short_id}",
                "per_page": min(max(per_page, 1), 100),
                "sort": "publication_date:desc",
            },
        )
        return data.get("results", [])



class ArxivError(RuntimeError):
    """Raised when arXiv metadata cannot be retrieved or parsed."""


class ArxivClient:
    """Small client for the public arXiv Atom API; no third-party package required."""

    API_URL = "https://export.arxiv.org/api/query"
    ATOM_NS = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}

    def __init__(self, timeout: float | None = None):
        self.timeout = timeout or config.HTTP_TIMEOUT_SECONDS

    def lookup_arxiv(self, arxiv_id: str) -> dict[str, Any] | None:
        normalized = str(arxiv_id).strip()
        if not normalized:
            return None
        url = f"{self.API_URL}?" + urllib.parse.urlencode({"id_list": normalized, "max_results": 1})
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": config.USER_AGENT,
                "Accept": "application/atom+xml, application/xml;q=0.9, */*;q=0.5",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                xml_payload = response.read().decode("utf-8", errors="replace")
            root = ET.fromstring(xml_payload)
        except (urllib.error.URLError, TimeoutError, OSError, ET.ParseError) as exc:
            raise ArxivError(f"Could not retrieve arXiv record {normalized}: {exc}") from exc

        entry = root.find("atom:entry", self.ATOM_NS)
        if entry is None:
            return None

        def text(path: str) -> str:
            node = entry.find(path, self.ATOM_NS)
            return " ".join((node.text or "").split()) if node is not None else ""

        title = text("atom:title")
        if not title:
            return None
        abstract = text("atom:summary")
        published = text("atom:published")
        try:
            year = datetime.fromisoformat(published.replace("Z", "+00:00")).year if published else None
        except ValueError:
            year = None

        authors = [
            " ".join((author.findtext("atom:name", default="", namespaces=self.ATOM_NS)).split())
            for author in entry.findall("atom:author", self.ATOM_NS)
        ]
        authors = [author for author in authors if author]
        doi = text("arxiv:doi") or None
        journal_ref = text("arxiv:journal_ref") or None
        entry_id = text("atom:id")
        resolved_id = normalized
        if entry_id:
            # Preserve legacy arXiv archive prefixes: /abs/hep-th/9901001
            # must remain hep-th/9901001 rather than being truncated to 9901001.
            entry_path = urllib.parse.urlparse(entry_id).path
            match = re.search(r"/(?:abs|pdf)/(.+)$", entry_path, flags=re.IGNORECASE)
            if match:
                resolved_id = match.group(1).strip("/")
            else:
                tail = entry_path.rstrip("/").split("/")[-1]
                if tail:
                    resolved_id = tail
        pdf_url = f"https://arxiv.org/pdf/{resolved_id}"
        landing_url = f"https://arxiv.org/abs/{resolved_id}"
        safe_id = "arxiv_" + re.sub(r"[^A-Za-z0-9._-]+", "_", resolved_id).strip("._-")

        return {
            "id": safe_id,
            "openalex_id": None,
            "arxiv_id": resolved_id,
            "doi": normalize_doi(doi) if doi else None,
            "title": title,
            "year": year,
            "publication_year": year,
            "publication_date": published[:10] if published else None,
            "type": "preprint",
            "authors": authors,
            "venue": journal_ref or "arXiv preprint",
            "landing_page_url": landing_url,
            "pdf_url": pdf_url,
            "is_open_access": True,
            "cited_by_count": 0,
            "abstract": abstract or None,
            "referenced_work_ids": [],
            "related_work_ids": [],
            "discovered_via": ["arxiv_identifier"],
            "identifier_type": "doi" if doi else "arxiv",
            "identifier_value": normalize_doi(doi) if doi else resolved_id,
        }

def normalize_doi(value: str) -> str:
    doi = value.strip()
    for prefix in ("https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "doi:"):
        if doi.lower().startswith(prefix):
            doi = doi[len(prefix):]
            break
    return doi.strip().rstrip(".,; ")


def short_openalex_id(value: str) -> str:
    """Convert https://openalex.org/W... or W... to W..."""
    return value.rstrip("/").split("/")[-1]
