"""Command-line interface for the paper discovery MVP."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .clients import OpenAlexError
from .discovery import PaperDiscovery


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Discover papers and a one-hop citation neighbourhood via OpenAlex.")
    parser.add_argument("query", help="Keyword, paper title, DOI, or DOI URL")
    parser.add_argument("--mode", choices=["auto", "keyword", "title", "doi"], default="auto")
    parser.add_argument("--seeds", type=int, default=2, help="Number of seed papers (default: 2)")
    parser.add_argument("--per-neighborhood", type=int, default=3, help="References, citations and related papers per seed (default: 3)")
    parser.add_argument("--max-papers", type=int, default=15, help="Hard cap on collected papers (default: 15)")
    parser.add_argument("--out", default="output/discovery.json", help="Output JSON path")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = PaperDiscovery().discover(
            args.query,
            mode=args.mode,
            seed_limit=args.seeds,
            per_neighborhood=args.per_neighborhood,
            max_papers=args.max_papers,
        )
    except (OpenAlexError, ValueError) as exc:
        print(f"Discovery failed: {exc}", file=sys.stderr)
        return 2

    output_path = Path(args.out)
    if not output_path.is_absolute():
        output_path = Path.cwd() / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Input mode : {result['input_mode']}")
    print(f"Papers     : {result['paper_count']}")
    print(f"Graph edges: {result['edge_count']}")
    print(f"Saved to   : {output_path}")
    for number, paper in enumerate(result["papers"][:10], start=1):
        year = paper.get("year") or "year n/a"
        print(f"{number:>2}. [{year}] {paper['title']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
