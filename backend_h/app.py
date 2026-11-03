"""Coordinate MVP 1 paper discovery with MVP 2 PDF analysis.

Expected project layout:

research_backend/
    app.py
    main.py
    discovery/       # contents of MVP 1's app/ directory
    analyzer/        # contents of MVP 2's app/ directory
    output/
    storage/
    .env

This version deliberately uses JSON/filesystem storage. It does not require a DB.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from analyzer.pipeline import run_pipeline
from analyzer.storage import write_json
from discovery.discovery import PaperDiscovery
from relationships.analyzer import analyze_project
from knowledge_graph.builder import build_knowledge_graph


def _slugify(value: str, max_length: int = 48) -> str:
    """Create a filesystem-safe project name from a user query."""
    slug = re.sub(r"[^A-Za-z0-9]+", "_", value.strip()).strip("_").lower()
    return (slug[:max_length].strip("_") or "research_project")


def _paper_priority(paper: dict[str, Any]) -> tuple[int, int, int, int]:
    """Rank records likely to be analyzable first.

    A DOI is still useful even when OpenAlex says the work is closed because
    MVP 2 can check Unpaywall. A closed record with a DOI is not discarded.
    """
    has_usable_openalex_pdf = bool(
        paper.get("pdf_url") and paper.get("is_open_access") is not False
    )
    is_open_access = paper.get("is_open_access") is True
    has_doi = bool(paper.get("doi"))
    has_abstract = bool(paper.get("abstract"))

    return (
        int(has_usable_openalex_pdf),
        int(is_open_access),
        int(has_doi),
        int(has_abstract),
    )


def run_research_pipeline(
    query: str,
    *,
    mode: str = "auto",
    seed_limit: int = 2,
    per_neighborhood: int = 3,
    max_discovered: int = 30,
    analyze_limit: int = 10,
    parser_backend: str = "pymupdf",
    extractor: str = "rules",
    output_root: str | Path = "output",
    max_pdf_mb: int | None = None,
    force_download: bool = False,
) -> dict[str, Any]:
    """Discover papers, select candidates, analyze PDFs, and save run artifacts.

    Each run gets its own timestamped directory. The complete discovery result
    is preserved; a separate analysis_input.json contains only the selected
    papers passed to MVP 2.
    """
    if not query or not query.strip():
        raise ValueError("Query cannot be empty.")
    if analyze_limit < 1:
        raise ValueError("analyze_limit must be at least 1.")
    if max_discovered < 1:
        raise ValueError("max_discovered must be at least 1.")

    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y%m%dT%H%M%SZ")
    project_name = f"{_slugify(query)}_{timestamp}"
    project_dir = Path(output_root) / project_name
    project_dir.mkdir(parents=True, exist_ok=False)

    # MVP 1: keyword/title/DOI discovery and citation-neighborhood expansion.
    discovery_result = PaperDiscovery().discover(
        query,
        mode=mode,
        seed_limit=seed_limit,
        per_neighborhood=per_neighborhood,
        max_papers=max_discovered,
    )

    discovery_path = project_dir / "discovery.json"
    write_json(discovery_path, discovery_result)

    discovered_papers = discovery_result.get("papers") or []
    ranked_papers = sorted(
        discovered_papers,
        key=_paper_priority,
        reverse=True,
    )
    selected_papers = ranked_papers[:analyze_limit]

    # Do not modify discovery.json: preserve the complete graph and metadata.
    # MVP 2 only needs the papers array, so create a separate input snapshot.
    analysis_input = dict(discovery_result)
    analysis_input["papers"] = selected_papers
    analysis_input["analysis_selection"] = {
        "limit": analyze_limit,
        "selected_count": len(selected_papers),
        "selection_order": "OpenAlex PDF availability, OA flag, DOI, abstract",
    }
    analysis_input_path = project_dir / "analysis_input.json"
    write_json(analysis_input_path, analysis_input)

    # MVP 2: retrieve legally accessible PDFs, parse, extract, and save JSON.
    # run_pipeline creates parsed/, analyses/, and analysis_summary.json.
    analysis_summary = run_pipeline(
        analysis_input_path,
        max_papers=max(1, len(selected_papers)),
        parser_backend=parser_backend,
        extractor=extractor,
        out_dir=project_dir / "analysis",
        pdf_dir=project_dir / "pdfs",
        force_download=force_download,
        max_pdf_mb=max_pdf_mb,
    )

    # MVP 3: compare successfully analyzed papers. If only one paper has a PDF,
    # the module still extracts its explicit gap records, but creates no pairwise
    # paper-to-paper inference.
    relationship_result = analyze_project(project_dir, discovery_result)

    # MVP 4: combine OpenAlex citation edges with evidence-backed candidate
    # research relationships and explicit research-gap nodes.
    graph_result = build_knowledge_graph(
        project_dir, discovery_result, analysis_summary, relationship_result
    )

    result: dict[str, Any] = {
        "created_at": now.isoformat(),
        "query": query,
        "mode": discovery_result.get("input_mode", mode),
        "input_resolution": discovery_result.get("input_resolution"),
        "project_dir": str(project_dir.resolve()),
        "discovery": {
            "paper_count": discovery_result.get("paper_count", len(discovered_papers)),
            "edge_count": discovery_result.get("edge_count", len(discovery_result.get("edges") or [])),
            "seed_paper_ids": discovery_result.get("seed_paper_ids", []),
            "file": str(discovery_path.resolve()),
        },
        "selection": {
            "requested_limit": analyze_limit,
            "selected_count": len(selected_papers),
            "selected_papers": [
                {
                    "id": paper.get("id"),
                    "title": paper.get("title"),
                    "doi": paper.get("doi"),
                    "is_open_access": paper.get("is_open_access"),
                    "has_direct_pdf_url": bool(paper.get("pdf_url")),
                }
                for paper in selected_papers
            ],
            "file": str(analysis_input_path.resolve()),
        },
        "analysis": analysis_summary,
        "relationships": {
            "analyzed_paper_count": relationship_result.get("analyzed_paper_count", 0),
            "pairwise_comparison_count": relationship_result.get("pairwise_comparison_count", 0),
            "inferred_relationship_count": relationship_result.get("inferred_relationship_count", 0),
            "gap_count": len(relationship_result.get("gaps") or []),
            "file": relationship_result.get("file"),
        },
        "knowledge_graph": {
            "paper_nodes": (graph_result.get("summary") or {}).get("paper_nodes", 0),
            "gap_nodes": (graph_result.get("summary") or {}).get("gap_nodes", 0),
            "edge_count": (graph_result.get("summary") or {}).get("edges", 0),
            "file": graph_result.get("file"),
        },
    }

    summary_path = project_dir / "research_summary.json"
    result["summary_file"] = str(summary_path.resolve())
    write_json(summary_path, result)
    return result
