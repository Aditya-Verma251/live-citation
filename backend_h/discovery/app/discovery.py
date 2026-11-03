"""Keyword/DOI discovery and one-hop citation-neighborhood expansion."""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone
from typing import Any

from .clients import OpenAlexClient, normalize_doi, short_openalex_id

DOI_RE = re.compile(r"^\s*(?:https?://(?:dx\.)?doi\.org/|doi:)?(10\.\d{4,9}/\S+)\s*$", re.I)


def reconstruct_abstract(inverted_index: dict[str, list[int]] | None) -> str | None:
    if not inverted_index:
        return None
    words: dict[int, str] = {}
    for token, positions in inverted_index.items():
        for position in positions:
            words[int(position)] = token
    if not words:
        return None
    return " ".join(words[index] for index in sorted(words))


def normalize_title(title: str | None) -> str:
    if not title:
        return ""
    normalized = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", normalized.lower()).strip()


def paper_key(paper: dict[str, Any]) -> str:
    doi = paper.get("doi")
    if doi:
        return "doi:" + normalize_doi(doi).lower()
    return "title:" + normalize_title(paper.get("title")) + ":" + str(paper.get("publication_year") or "")


def normalize_paper(raw: dict[str, Any], discovered_via: str) -> dict[str, Any] | None:
    title = raw.get("title")
    openalex_id = raw.get("id")
    if not title or not openalex_id:
        return None

    authors = []
    for authorship in raw.get("authorships") or []:
        author = (authorship or {}).get("author") or {}
        if author.get("display_name"):
            authors.append(author["display_name"])

    primary_location = raw.get("primary_location") or {}
    source = primary_location.get("source") or {}
    oa_location = raw.get("best_oa_location") or {}
    open_access = raw.get("open_access") or {}

    return {
        "id": short_openalex_id(openalex_id),
        "openalex_id": openalex_id,
        "doi": normalize_doi(raw["doi"]) if raw.get("doi") else None,
        "title": title,
        "year": raw.get("publication_year"),
        "publication_date": raw.get("publication_date"),
        "type": raw.get("type"),
        "authors": authors,
        "venue": source.get("display_name"),
        "landing_page_url": primary_location.get("landing_page_url"),
        "pdf_url": oa_location.get("pdf_url"),
        "is_open_access": open_access.get("is_oa"),
        "cited_by_count": raw.get("cited_by_count", 0),
        "abstract": reconstruct_abstract(raw.get("abstract_inverted_index")),
        "referenced_work_ids": [short_openalex_id(x) for x in raw.get("referenced_works", [])],
        "related_work_ids": [short_openalex_id(x) for x in raw.get("related_works", [])],
        "discovered_via": [discovered_via],
    }


class PaperDiscovery:
    """Discover papers from a keyword/title/DOI and expand one graph hop."""

    def __init__(self, client: OpenAlexClient | None = None):
        self.client = client or OpenAlexClient()

    def discover(
        self,
        query: str,
        mode: str = "auto",
        seed_limit: int = 2,
        per_neighborhood: int = 3,
        max_papers: int = 15,
    ) -> dict[str, Any]:
        if not query or not query.strip():
            raise ValueError("Input cannot be empty")
        if max_papers < 1 or seed_limit < 1 or per_neighborhood < 0:
            raise ValueError("Limits must be positive (per_neighborhood may be zero)")

        selected_mode = self._resolve_mode(query, mode)
        if selected_mode == "doi":
            seeds = self.client.lookup_doi(normalize_doi(query))
        else:
            seeds = self.client.search_works(query.strip(), per_page=seed_limit)
            if selected_mode == "title" and seeds:
                # The OpenAlex relevance-ranked first result is treated as the title candidate.
                seeds = seeds[:1]

        if not seeds:
            return self._empty_result(query, selected_mode)

        papers_by_key: dict[str, dict[str, Any]] = {}
        id_to_key: dict[str, str] = {}
        pending_edges: list[dict[str, str]] = []
        seed_ids: list[str] = []

        def add(raw: dict[str, Any], via: str) -> str | None:
            normalized = normalize_paper(raw, via)
            if not normalized:
                return None
            key = paper_key(normalized)
            existing = papers_by_key.get(key)
            if existing:
                for tag in normalized["discovered_via"]:
                    if tag not in existing["discovered_via"]:
                        existing["discovered_via"].append(tag)
                # Preserve useful metadata if one provider record is more complete.
                for field in ("abstract", "doi", "pdf_url", "venue", "authors", "year"):
                    if not existing.get(field) and normalized.get(field):
                        existing[field] = normalized[field]
                id_to_key[normalized["id"]] = key
                id_to_key[normalized["openalex_id"]] = key
                return existing["id"]
            if len(papers_by_key) >= max_papers:
                return None
            papers_by_key[key] = normalized
            id_to_key[normalized["id"]] = key
            id_to_key[normalized["openalex_id"]] = key
            return normalized["id"]

        for seed in seeds[:seed_limit]:
            seed_id = add(seed, "seed_search")
            if seed_id:
                seed_ids.append(seed_id)
        seed_ids = list(dict.fromkeys(seed_ids))

        for seed in seeds[:seed_limit]:
            if len(papers_by_key) >= max_papers:
                break
            seed_id = short_openalex_id(seed.get("id", ""))
            # The seed may have been deduplicated against another seed.
            seed_key = id_to_key.get(seed_id)
            if not seed_key:
                continue

            references = (seed.get("referenced_works") or [])[:per_neighborhood]
            related = (seed.get("related_works") or [])[:per_neighborhood]

            if references:
                fetched = self.client.get_works_by_ids(references)
                for raw in fetched:
                    target_id = add(raw, "reference")
                    if target_id:
                        pending_edges.append({"source": seed_id, "target": short_openalex_id(raw["id"]), "type": "cites"})

            if related and len(papers_by_key) < max_papers:
                fetched = self.client.get_works_by_ids(related)
                for raw in fetched:
                    target_id = add(raw, "related_work")
                    if target_id:
                        pending_edges.append({"source": seed_id, "target": short_openalex_id(raw["id"]), "type": "related_to"})

            if per_neighborhood and len(papers_by_key) < max_papers:
                citing = self.client.get_citing_works(seed_id, per_page=per_neighborhood)
                for raw in citing:
                    citing_id = add(raw, "citation")
                    if citing_id:
                        pending_edges.append({"source": short_openalex_id(raw["id"]), "target": seed_id, "type": "cites"})

        # Resolve edge endpoints to deduplicated paper IDs and remove self/duplicate edges.
        edges: list[dict[str, str]] = []
        seen_edges: set[tuple[str, str, str]] = set()
        for edge in pending_edges:
            source_key = id_to_key.get(edge["source"])
            target_key = id_to_key.get(edge["target"])
            if not source_key or not target_key or source_key == target_key:
                continue
            source_id = papers_by_key[source_key]["id"]
            target_id = papers_by_key[target_key]["id"]
            marker = (source_id, target_id, edge["type"])
            if marker not in seen_edges:
                edges.append({"source": source_id, "target": target_id, "type": edge["type"]})
                seen_edges.add(marker)

        return {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "provider": "OpenAlex",
            "input": query,
            "input_mode": selected_mode,
            "seed_paper_ids": seed_ids,
            "paper_count": len(papers_by_key),
            "edge_count": len(edges),
            "papers": sorted(papers_by_key.values(), key=lambda p: (p.get("year") or 0, p["title"]), reverse=True),
            "edges": edges,
            "notes": [
                "Discovery is one-hop and intentionally capped by seed_limit, per_neighborhood, and max_papers.",
                "Citation edges come from OpenAlex bibliographic links; related_to edges are semantic-neighbour links.",
                "A missing abstract or PDF URL means OpenAlex did not provide it in this record; it does not mean the paper has no abstract or full text.",
            ],
        }

    @staticmethod
    def _resolve_mode(query: str, mode: str) -> str:
        if mode not in {"auto", "keyword", "title", "doi"}:
            raise ValueError("mode must be auto, keyword, title, or doi")
        if mode != "auto":
            return mode
        return "doi" if DOI_RE.match(query.strip()) else "keyword"

    @staticmethod
    def _empty_result(query: str, mode: str) -> dict[str, Any]:
        return {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "provider": "OpenAlex",
            "input": query,
            "input_mode": mode,
            "seed_paper_ids": [],
            "paper_count": 0,
            "edge_count": 0,
            "papers": [],
            "edges": [],
            "notes": ["No matching work was returned by OpenAlex."],
        }
