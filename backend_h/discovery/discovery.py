"""Research-paper identifier resolution and one-hop citation discovery."""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone
from typing import Any

from .clients import ArxivClient, OpenAlexClient, normalize_doi, short_openalex_id
from .identifiers import normalize_arxiv_id, normalize_doi_input, normalize_pmid, parse_research_input, title_match_score

TITLE_MATCH_MIN_SCORE = 0.86
TITLE_MATCH_AMBIGUITY_MARGIN = 0.035
STRUCTURED_MODES = {"doi", "arxiv", "openalex", "pmid"}
VALID_MODES = {"auto", "keyword", "title", *STRUCTURED_MODES}


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
    """Deduplicate records by the strongest persistent identifier available."""
    identifiers = paper.get("identifiers") if isinstance(paper.get("identifiers"), dict) else {}
    doi = paper.get("doi") or identifiers.get("doi")
    if doi:
        normalized_doi = normalize_doi_input(str(doi)) or str(doi).strip()
        return "doi:" + normalized_doi.lower()
    pmid = paper.get("pmid") or identifiers.get("pmid")
    if pmid:
        return "pmid:" + re.sub(r"\D", "", str(pmid))
    arxiv_id = paper.get("arxiv_id") or identifiers.get("arxiv")
    if arxiv_id:
        # arXiv versions are versions of the same work for discovery deduplication.
        normalized_arxiv = normalize_arxiv_id(str(arxiv_id)) or str(arxiv_id).strip()
        return "arxiv:" + re.sub(r"(?i)v\d+$", "", normalized_arxiv).lower()
    openalex_id = paper.get("openalex_id") or identifiers.get("openalex")
    if openalex_id:
        return "openalex:" + short_openalex_id(str(openalex_id)).upper()
    return "title:" + normalize_title(paper.get("title")) + ":" + str(paper.get("publication_year") or paper.get("year") or "")


def normalize_paper(raw: dict[str, Any], discovered_via: str) -> dict[str, Any] | None:
    """Normalize OpenAlex and direct arXiv records to one stable paper schema."""
    title = raw.get("title")
    source_id = raw.get("id") or raw.get("openalex_id")
    if not title or not source_id:
        return None

    raw_ids = raw.get("ids") if isinstance(raw.get("ids"), dict) else {}
    openalex_id = raw.get("openalex_id") or raw_ids.get("openalex")
    if not openalex_id and isinstance(source_id, str):
        if "openalex.org/" in source_id or re.fullmatch(r"(?i)W\d{5,}", source_id):
            openalex_id = source_id

    paper_id = short_openalex_id(str(openalex_id)) if openalex_id else str(source_id)
    doi_value = raw.get("doi") or raw_ids.get("doi")
    doi = normalize_doi(str(doi_value)) if doi_value else None
    arxiv_value = raw.get("arxiv_id") or raw_ids.get("arxiv")
    arxiv_id = None
    if arxiv_value:
        try:
            parsed_arxiv = parse_research_input(str(arxiv_value))
            arxiv_id = parsed_arxiv.value if parsed_arxiv.kind == "arxiv" else normalize_arxiv_id(str(arxiv_value))
        except ValueError:
            arxiv_id = normalize_arxiv_id(str(arxiv_value))
    pmid_value = raw.get("pmid") or raw_ids.get("pmid")
    pmid = normalize_pmid(str(pmid_value)) if pmid_value else None
    if not pmid and pmid_value:
        pmid_match = re.search(r"(\d{6,10})", str(pmid_value))
        pmid = pmid_match.group(1) if pmid_match else None

    authors: list[str] = []
    for author in raw.get("authors") or []:
        if isinstance(author, str) and author.strip():
            authors.append(author.strip())
        elif isinstance(author, dict) and author.get("display_name"):
            authors.append(str(author["display_name"]))
    for authorship in raw.get("authorships") or []:
        author = (authorship or {}).get("author") or {}
        if author.get("display_name") and author["display_name"] not in authors:
            authors.append(author["display_name"])

    primary_location = raw.get("primary_location") or {}
    source = primary_location.get("source") or {}
    oa_location = raw.get("best_oa_location") or {}
    open_access = raw.get("open_access") or {}

    identifier_type = raw.get("input_identifier_type") or raw.get("identifier_type") or (
        "doi" if doi else "arxiv" if arxiv_id else "pmid" if pmid else "openalex" if openalex_id else "title"
    )
    identifier_value = (
        raw.get("input_identifier_value")
        or raw.get("identifier_value")
        or doi
        or arxiv_id
        or pmid
        or (short_openalex_id(str(openalex_id)) if openalex_id else paper_id)
    )
    identifiers = {
        key: value for key, value in {
            "openalex": short_openalex_id(str(openalex_id)) if openalex_id else None,
            "doi": doi,
            "arxiv": arxiv_id,
            "pmid": pmid,
        }.items() if value
    }

    referenced = raw.get("referenced_work_ids") or raw.get("referenced_works") or []
    related = raw.get("related_work_ids") or raw.get("related_works") or []
    year = raw.get("publication_year") or raw.get("year")
    abstract = raw.get("abstract") or reconstruct_abstract(raw.get("abstract_inverted_index"))
    pdf_url = oa_location.get("pdf_url") or raw.get("pdf_url")
    landing_url = primary_location.get("landing_page_url") or raw.get("landing_page_url")

    return {
        "id": paper_id,
        "canonical_id": short_openalex_id(str(openalex_id)) if openalex_id else paper_id,
        "openalex_id": openalex_id,
        "arxiv_id": arxiv_id,
        "doi": doi,
        "pmid": pmid,
        "identifiers": identifiers,
        "identifier_type": identifier_type,
        "identifier_value": identifier_value,
        "title": title,
        "year": year,
        "publication_year": year,
        "publication_date": raw.get("publication_date"),
        "type": raw.get("type"),
        "authors": authors,
        "venue": source.get("display_name") or raw.get("venue"),
        "landing_page_url": landing_url,
        "pdf_url": pdf_url,
        "is_open_access": open_access.get("is_oa", raw.get("is_open_access")),
        "cited_by_count": raw.get("cited_by_count", 0),
        "abstract": abstract,
        "referenced_work_ids": [short_openalex_id(str(x)) for x in referenced],
        "related_work_ids": [short_openalex_id(str(x)) for x in related],
        "discovered_via": list(dict.fromkeys([*(raw.get("discovered_via") or []), discovered_via])),
    }


def _aliases_for_paper(paper: dict[str, Any]) -> list[str]:
    """Return canonical and external IDs in one normalized alias namespace."""
    identifiers = paper.get("identifiers") if isinstance(paper.get("identifiers"), dict) else {}
    values = [
        paper.get("id"),
        paper.get("canonical_id"),
        paper.get("openalex_id"),
        identifiers.get("openalex"),
        paper.get("doi"),
        identifiers.get("doi"),
        paper.get("arxiv_id"),
        identifiers.get("arxiv"),
        paper.get("pmid"),
        identifiers.get("pmid"),
        paper.get("identifier_value"),
    ]
    aliases: list[str] = []
    for value in values:
        if value is None or not str(value).strip():
            continue
        raw = str(value).strip()
        try:
            parsed = parse_research_input(raw)
        except ValueError:
            parsed = None
        if parsed and parsed.kind == "doi":
            alias = parsed.value.lower()
        elif parsed and parsed.kind == "openalex":
            alias = parsed.value.upper()
        elif parsed and parsed.kind == "pmid":
            alias = parsed.value
        elif parsed and parsed.kind == "arxiv":
            alias = parsed.value.lower()
        else:
            alias = raw
        if alias and alias not in aliases:
            aliases.append(alias)
    return aliases


class PaperDiscovery:
    """Resolve a paper reference correctly, then expand its citation neighbourhood."""

    def __init__(self, client: OpenAlexClient | None = None, arxiv_client: ArxivClient | None = None):
        self.client = client or OpenAlexClient()
        self.arxiv_client = arxiv_client or ArxivClient()

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
        # Explicit keyword mode must remain a keyword search, even if the text
        # happens to contain a URL. Paper/title mode and auto mode are parsed
        # into a specific scholarly identifier before any provider lookup.
        parsed_input = None if selected_mode == "keyword" else parse_research_input(query)
        input_value = parsed_input.value if parsed_input and selected_mode in STRUCTURED_MODES else query.strip()
        resolution: dict[str, Any] = {
            "status": "search",
            "input_type": selected_mode,
            "raw_input": query,
            "input_identifier": {"type": selected_mode, "value": input_value},
            "normalized_identifier": parsed_input.value if parsed_input and selected_mode in STRUCTURED_MODES else None,
            "provider": None,
            "match_score": None,
            "resolved_paper": None,
        }

        title_match: dict[str, Any] | None = None
        if selected_mode == "doi":
            assert parsed_input is not None
            seeds = self.client.lookup_doi(parsed_input.value)
            if not seeds:
                raise ValueError(f"No OpenAlex work was found for DOI {parsed_input.value}.")
            resolution["provider"] = "OpenAlex DOI lookup"

        elif selected_mode == "openalex":
            assert parsed_input is not None
            work = self.client.get_work_by_id(parsed_input.value)
            seeds = [work] if work else []
            if not seeds:
                raise ValueError(f"OpenAlex work {parsed_input.value} was not found.")
            resolution["provider"] = "OpenAlex work ID lookup"

        elif selected_mode == "pmid":
            assert parsed_input is not None
            seeds = self.client.lookup_pmid(parsed_input.value)
            if not seeds:
                raise ValueError(f"No OpenAlex work was found for PubMed ID {parsed_input.value}.")
            resolution["provider"] = "OpenAlex PMID lookup"

        elif selected_mode == "arxiv":
            assert parsed_input is not None
            arxiv_record = self.arxiv_client.lookup_arxiv(parsed_input.value)
            if not arxiv_record:
                raise ValueError(f"No arXiv paper was found for ID {parsed_input.value}.")
            seeds = self._enrich_arxiv_record(arxiv_record)
            resolution["provider"] = "arXiv API"
            resolution["normalized_identifier"] = arxiv_record.get("arxiv_id") or parsed_input.value

        elif selected_mode == "title":
            candidates = self.client.search_works(query.strip(), per_page=10)
            ranked = sorted(
                candidates,
                key=lambda item: title_match_score(query, str(item.get("title") or "")),
                reverse=True,
            )
            best = ranked[0] if ranked else None
            score = title_match_score(query, str(best.get("title") or "")) if best else 0.0
            second_score = title_match_score(query, str(ranked[1].get("title") or "")) if len(ranked) > 1 else 0.0
            second_is_same_exact_title = bool(
                best and len(ranked) > 1 and second_score >= 0.9999
                and normalize_title(str(best.get("title") or ""))
                    == normalize_title(str(ranked[1].get("title") or ""))
                and short_openalex_id(str(best.get("id") or ""))
                    != short_openalex_id(str(ranked[1].get("id") or ""))
            )
            ambiguous = bool(
                best and len(ranked) > 1 and (
                    second_is_same_exact_title
                    or (score < 0.9999 and (score - second_score) < TITLE_MATCH_AMBIGUITY_MARGIN)
                )
            )
            if best is None or score < TITLE_MATCH_MIN_SCORE or ambiguous:
                suggestions = [
                    f"{item.get('title')} ({item.get('publication_year') or 'year unknown'}; "
                    f"match {title_match_score(query, str(item.get('title') or '')):.2f})"
                    for item in ranked[:3]
                ]
                detail = "; ".join(suggestions) if suggestions else "No title candidates were returned by OpenAlex."
                reason = "the search returned multiple similarly matching papers" if ambiguous else (
                    f"the best title match scored {score:.2f}, below the required {TITLE_MATCH_MIN_SCORE:.2f}"
                )
                raise ValueError(
                    f"Could not uniquely identify this paper title because {reason}. "
                    f"Candidates: {detail}. Provide the DOI, arXiv ID, OpenAlex ID or PMID for an exact lookup."
                )
            seeds = [best]
            title_match = {"score": score, "matched_title": best.get("title"), "second_best_score": second_score}
            resolution["provider"] = "OpenAlex title search"
            resolution["match_score"] = score

        else:  # keyword mode
            seeds = self.client.search_works(query.strip(), per_page=seed_limit)
            resolution["provider"] = "OpenAlex keyword search"

        if not seeds:
            if selected_mode == "keyword":
                return self._empty_result(query, selected_mode, resolution)
            raise ValueError(f"No paper could be resolved from the supplied {selected_mode} reference.")

        # Preserve the exact identifier the user supplied on the resolved seed.
        # `id` remains the canonical internal paper ID (normally OpenAlex W...),
        # while identifier_type/value explain how this particular seed was found.
        if selected_mode in STRUCTURED_MODES:
            seeds = [
                {
                    **seed,
                    "input_identifier_type": selected_mode,
                    "input_identifier_value": parsed_input.value,
                }
                for seed in seeds
            ]

        papers_by_key: dict[str, dict[str, Any]] = {}
        id_to_key: dict[str, str] = {}
        pending_edges: list[dict[str, str]] = []
        seed_ids: list[str] = []

        def merge_record(existing: dict[str, Any], incoming: dict[str, Any]) -> None:
            for tag in incoming.get("discovered_via") or []:
                if tag not in existing.setdefault("discovered_via", []):
                    existing["discovered_via"].append(tag)
            for field in (
                "abstract", "doi", "arxiv_id", "pmid", "openalex_id",
                "canonical_id", "pdf_url", "venue", "authors", "year",
                "publication_year", "publication_date", "landing_page_url",
                "identifier_type", "identifier_value",
            ):
                if not existing.get(field) and incoming.get(field):
                    existing[field] = incoming[field]
            existing_identifiers = existing.setdefault("identifiers", {})
            for name, value in (incoming.get("identifiers") or {}).items():
                existing_identifiers.setdefault(name, value)
            if not existing.get("cited_by_count") and incoming.get("cited_by_count"):
                existing["cited_by_count"] = incoming["cited_by_count"]

        def add(raw: dict[str, Any], via: str) -> str | None:
            normalized = normalize_paper(raw, via)
            if not normalized:
                return None
            aliases = _aliases_for_paper(normalized)
            matched_keys = list(dict.fromkeys(
                id_to_key[alias] for alias in aliases if alias in id_to_key
            ))
            key = matched_keys[0] if matched_keys else paper_key(normalized)
            existing = papers_by_key.get(key)
            if existing:
                merge_record(existing, normalized)
                # A newly observed record can bridge previously separate provider
                # records. Collapse those keys into the first canonical node.
                for duplicate_key in matched_keys[1:]:
                    duplicate = papers_by_key.pop(duplicate_key, None)
                    if duplicate is None or duplicate is existing:
                        continue
                    merge_record(existing, duplicate)
                    for alias in _aliases_for_paper(duplicate):
                        id_to_key[alias] = key
                for alias in _aliases_for_paper(existing) + aliases:
                    id_to_key[alias] = key
                return existing["id"]
            if len(papers_by_key) >= max_papers:
                return None
            papers_by_key[key] = normalized
            for alias in aliases:
                id_to_key[alias] = key
            return normalized["id"]


        for seed in seeds[:seed_limit]:
            seed_id = add(seed, "seed_search" if selected_mode in {"keyword", "title"} else f"seed_{selected_mode}")
            if seed_id:
                seed_ids.append(seed_id)
        seed_ids = list(dict.fromkeys(seed_ids))

        for seed in seeds[:seed_limit]:
            normalized_seed = normalize_paper(seed, "seed")
            if not normalized_seed:
                continue
            seed_id = normalized_seed["id"]
            seed_key = id_to_key.get(seed_id)
            if not seed_key:
                continue

            # Only OpenAlex records have citation/reference IDs. Direct arXiv fallback
            # records remain valid analyzable papers but may have no bibliographic edges.
            if not normalized_seed.get("openalex_id"):
                continue

            references = (seed.get("referenced_works") or [])[:per_neighborhood]
            related = (seed.get("related_works") or [])[:per_neighborhood]

            if references:
                fetched = self.client.get_works_by_ids(references)
                for raw in fetched:
                    target_id = add(raw, "reference")
                    if target_id:
                        target_key = id_to_key.get(short_openalex_id(str(raw.get("id") or "")))
                        if target_key:
                            pending_edges.append({"source": seed_id, "target": papers_by_key[target_key]["id"], "type": "cites"})

            if related and len(papers_by_key) < max_papers:
                fetched = self.client.get_works_by_ids(related)
                for raw in fetched:
                    target_id = add(raw, "related_work")
                    if target_id:
                        target_key = id_to_key.get(short_openalex_id(str(raw.get("id") or "")))
                        if target_key:
                            pending_edges.append({"source": seed_id, "target": papers_by_key[target_key]["id"], "type": "related_to"})

            if per_neighborhood and len(papers_by_key) < max_papers:
                citing = self.client.get_citing_works(seed_id, per_page=per_neighborhood)
                for raw in citing:
                    citing_id = add(raw, "citation")
                    if citing_id:
                        source_key = id_to_key.get(short_openalex_id(str(raw.get("id") or "")))
                        if source_key:
                            pending_edges.append({"source": papers_by_key[source_key]["id"], "target": seed_id, "type": "cites"})

        # Resolve endpoints against canonical paper IDs and remove self/duplicate edges.
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

        first_seed_normalized = normalize_paper(seeds[0], "seed") if seeds else None
        first_seed_key = next((
            id_to_key[alias] for alias in _aliases_for_paper(first_seed_normalized or {})
            if alias in id_to_key
        ), None)
        seed_record = papers_by_key.get(first_seed_key) if first_seed_key else None
        if seed_record:
            resolution["status"] = "resolved"
            resolution["resolved_paper"] = {
                "id": seed_record.get("id"),
                "openalex_id": seed_record.get("openalex_id"),
                "doi": seed_record.get("doi"),
                "arxiv_id": seed_record.get("arxiv_id"),
                "title": seed_record.get("title"),
                "year": seed_record.get("year"),
                "identifier_type": seed_record.get("identifier_type"),
                "identifier_value": seed_record.get("identifier_value"),
                "identifiers": seed_record.get("identifiers", {}),
                "canonical_id": seed_record.get("canonical_id") or seed_record.get("id"),
                "resolved_by": {"type": selected_mode, "value": input_value},
            }
        if title_match:
            resolution["title_match"] = title_match

        return {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "provider": "OpenAlex/arXiv",
            "input": query,
            "input_mode": selected_mode,
            "input_resolution": resolution,
            "seed_paper_ids": seed_ids,
            "paper_count": len(papers_by_key),
            "edge_count": len(edges),
            "papers": sorted(papers_by_key.values(), key=lambda p: (p.get("year") or 0, p["title"]), reverse=True),
            "edges": edges,
            "notes": [
                "Discovery is one-hop and intentionally capped by seed_limit, per_neighborhood, and max_papers.",
                "Paper references are resolved by their DOI, arXiv ID, OpenAlex ID, PubMed ID or exact-title matching path.",
                "Citation edges come from OpenAlex bibliographic links; related_to edges are OpenAlex related-work links.",
                "An arXiv-only record remains analyzable even when OpenAlex has no corresponding work record; it may have no citation-neighbour edges.",
            ],
        }

    def _enrich_arxiv_record(self, arxiv_record: dict[str, Any]) -> list[dict[str, Any]]:
        """Prefer OpenAlex metadata/citations when a matching record can be resolved."""
        openalex_record: dict[str, Any] | None = None
        doi = arxiv_record.get("doi")
        if doi:
            matches = self.client.lookup_doi(str(doi))
            if matches:
                openalex_record = matches[0]
        if openalex_record is None:
            candidates = self.client.search_works(str(arxiv_record.get("title") or ""), per_page=10)
            best, score = self._best_title_match(str(arxiv_record.get("title") or ""), candidates)
            if best is not None and score >= TITLE_MATCH_MIN_SCORE:
                openalex_record = best
        if openalex_record is None:
            return [arxiv_record]

        enriched = dict(openalex_record)
        enriched["arxiv_id"] = arxiv_record.get("arxiv_id")
        enriched["identifier_type"] = "arxiv"
        enriched["identifier_value"] = arxiv_record.get("arxiv_id")
        if not (enriched.get("best_oa_location") or {}).get("pdf_url") and not enriched.get("pdf_url"):
            enriched["pdf_url"] = arxiv_record.get("pdf_url")
            enriched["is_open_access"] = True
        if not enriched.get("abstract_inverted_index") and not enriched.get("abstract"):
            enriched["abstract"] = arxiv_record.get("abstract")
        if not enriched.get("doi"):
            enriched["doi"] = arxiv_record.get("doi")
        return [enriched]

    @staticmethod
    def _best_title_match(query: str, candidates: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, float]:
        ranked = sorted(
            candidates,
            key=lambda item: title_match_score(query, str(item.get("title") or "")),
            reverse=True,
        )
        if not ranked:
            return None, 0.0
        best = ranked[0]
        return best, title_match_score(query, str(best.get("title") or ""))

    @staticmethod
    def _resolve_mode(query: str, mode: str) -> str:
        if mode not in VALID_MODES:
            raise ValueError("mode must be auto, keyword, title, doi, arxiv, openalex or pmid")
        if mode == "keyword":
            return "keyword"

        parsed = parse_research_input(query)
        if parsed.kind in STRUCTURED_MODES:
            if mode in STRUCTURED_MODES and mode != parsed.kind:
                raise ValueError(f"The supplied reference is a {parsed.kind} identifier, not a {mode} identifier.")
            return parsed.kind

        if mode in STRUCTURED_MODES:
            raise ValueError(f"The supplied value is not a valid {mode} identifier.")
        if mode == "title":
            return "title"
        return "keyword"

    @staticmethod
    def _empty_result(query: str, mode: str, resolution: dict[str, Any] | None = None) -> dict[str, Any]:
        return {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "provider": "OpenAlex/arXiv",
            "input": query,
            "input_mode": mode,
            "input_resolution": resolution or {
                "status": "unresolved", "input_type": mode,
                "raw_input": query, "provider": "OpenAlex keyword search",
            },
            "seed_paper_ids": [],
            "paper_count": 0,
            "edge_count": 0,
            "papers": [],
            "edges": [],
            "notes": ["No matching work was returned by the selected discovery search."],
        }
