"""Small OpenAlex REST client used by the discovery pipeline.

API docs: https://help.openalex.org/api/
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterable

from . import config


class OpenAlexError(RuntimeError):
    """Raised when OpenAlex returns an error or cannot be reached."""


WORK_FIELDS = ",".join(
    [
        "id",
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
