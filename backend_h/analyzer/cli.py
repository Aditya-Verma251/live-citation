"""CLI: analyze PDFs referenced by MVP 1 discovery JSON."""
from __future__ import annotations

import argparse
import sys

from .pipeline import run_pipeline


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Retrieve accessible PDFs, parse them, extract structured research information, and save JSON."
    )
    parser.add_argument("discovery_json", help="MVP 1 JSON output containing a papers array")
    parser.add_argument("--max-papers", type=int, default=5, help="Maximum papers to process (default: 5)")
    parser.add_argument("--parser", choices=["auto", "grobid", "pymupdf"], default="auto")
    parser.add_argument("--extractor", choices=["rules"], default="rules")
    parser.add_argument("--out", default="output", help="Output directory for analysis JSON files")
    parser.add_argument("--pdf-dir", default="storage/pdfs", help="Directory for downloaded PDF files")
    parser.add_argument("--force-download", action="store_true", help="Download PDFs again even if a local copy exists")
    parser.add_argument("--max-pdf-mb", type=int, default=None, help="Override maximum PDF size (MB)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        summary = run_pipeline(
            args.discovery_json,
            max_papers=args.max_papers,
            parser_backend=args.parser,
            extractor=args.extractor,
            out_dir=args.out,
            pdf_dir=args.pdf_dir,
            force_download=args.force_download,
            max_pdf_mb=args.max_pdf_mb,
        )
    except (OSError, ValueError) as exc:
        print(f"Analyzer failed: {exc}", file=sys.stderr)
        return 2

    print(f"Papers processed : {summary['processed_count']}")
    print(f"Successfully analyzed: {summary['analyzed_count']}")
    print(f"Skipped          : {summary['skipped_count']}")
    print(f"Failed           : {summary['failed_count']}")
    print(f"Summary saved    : {summary['summary_path']}")
    for item in summary["papers"]:
        print(f"- [{item['status']}] {item.get('title') or item['paper_id']}")
        if item.get("error"):
            print(f"    {item['error']}")
        elif item.get("retrieval", {}).get("message") and item["status"] != "analyzed":
            print(f"    {item['retrieval']['message']}")
    return 0 if summary["failed_count"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
