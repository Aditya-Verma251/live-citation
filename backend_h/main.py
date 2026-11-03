"""Command-line entry point for the integrated research backend."""
from __future__ import annotations

import argparse
import sys
from typing import Sequence

from app import run_research_pipeline
from discovery.clients import OpenAlexError


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Discover research papers with OpenAlex, then retrieve accessible PDFs, "
            "parse them, extract structured information locally, compare conclusions/gaps, and save results."
        )
    )
    parser.add_argument(
        "query",
        help="Keyword, exact paper title, DOI, arXiv ID, OpenAlex ID, PMID, or supported identifier URL.",
    )
    parser.add_argument(
        "--mode",
        choices=["auto", "keyword", "title", "doi", "arxiv", "openalex", "pmid"],
        default="auto",
        help="How to interpret the query (default: auto; structured IDs are auto-detected).",
    )
    parser.add_argument(
        "--seeds",
        type=int,
        default=2,
        help="Number of seed papers used for citation expansion (default: 2).",
    )
    parser.add_argument(
        "--per-neighborhood",
        type=int,
        default=3,
        help="Maximum references, citing works, and related works per seed (default: 3).",
    )
    parser.add_argument(
        "--max-discovered",
        type=int,
        default=30,
        help="Maximum total papers retained by discovery (default: 30).",
    )
    parser.add_argument(
        "--analyze-limit",
        type=int,
        default=5,
        help="Maximum selected papers passed to the analyzer (default: 5).",
    )
    parser.add_argument(
        "--parser",
        choices=["auto", "grobid", "pymupdf"],
        default="pymupdf",
        help="PDF parser backend (default: pymupdf).",
    )
    parser.add_argument(
        "--extractor",
        choices=["rules"],
        default="rules",
        help="Offline rule-based information extractor (no LLM or API key).",
    )
    parser.add_argument(
        "--out",
        default="output",
        help="Root directory for timestamped research projects (default: output).",
    )
    parser.add_argument(
        "--max-pdf-mb",
        type=int,
        default=None,
        help="Maximum PDF size in MB; uses analyzer config default when omitted.",
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="Download PDFs again even when a valid local copy already exists.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        result = run_research_pipeline(
            args.query,
            mode=args.mode,
            seed_limit=args.seeds,
            per_neighborhood=args.per_neighborhood,
            max_discovered=args.max_discovered,
            analyze_limit=args.analyze_limit,
            parser_backend=args.parser,
            extractor=args.extractor,
            output_root=args.out,
            max_pdf_mb=args.max_pdf_mb,
            force_download=args.force_download,
        )
    except (OpenAlexError, OSError, RuntimeError, ValueError) as exc:
        print(f"Research pipeline failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    discovery = result["discovery"]
    selection = result["selection"]
    analysis = result["analysis"]

    print("\nRESEARCH PIPELINE COMPLETE")
    print("=" * 30)
    print(f"Query                 : {result['query']}")
    print(f"Papers discovered     : {discovery['paper_count']}")
    print(f"Citation/related edges: {discovery['edge_count']}")
    print(f"Selected for analysis : {selection['selected_count']}")
    print(f"PDFs analyzed         : {analysis['analyzed_count']}")
    print(f"Skipped               : {analysis['skipped_count']}")
    print(f"Failed                : {analysis['failed_count']}")
    relationships = result.get("relationships", {})
    graph = result.get("knowledge_graph", {})
    print(f"Pairwise comparisons  : {relationships.get('pairwise_comparison_count', 0)}")
    print(f"Research relationships: {relationships.get('inferred_relationship_count', 0)}")
    print(f"Explicit gap records  : {relationships.get('gap_count', 0)}")
    print(f"Knowledge graph nodes : {graph.get('paper_nodes', 0)} papers + {graph.get('gap_nodes', 0)} gaps")
    print(f"Project directory     : {result['project_dir']}")
    print(f"Research summary      : {result['summary_file']}")
    if graph.get("file"):
        print(f"Knowledge graph       : {graph['file']}")
    print("Dashboard command     : python3 web.py --output-root output")

    for item in analysis.get("papers", []):
        title = item.get("title") or item.get("paper_id")
        print(f"\n- [{item.get('status', 'unknown')}] {title}")
        retrieval = item.get("retrieval") or {}
        message = retrieval.get("message") or item.get("error")
        if message:
            print(f"    {message}")

    if analysis["analyzed_count"] == 0:
        print(
            "\nNo PDFs were analyzed in this run. Discovery still succeeded; "
            "check the per-paper retrieval messages and try a query with known open-access papers."
        )

    # A fully completed run with legitimate skips is not treated as a crash.
    return 1 if analysis["failed_count"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
