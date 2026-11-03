"""Run parser + extractor + JSON storage on one local PDF (no discovery API needed)."""
from __future__ import annotations

import argparse
import sys

from .pipeline import analyze_local_pdf


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analyze one local PDF without network access.")
    parser.add_argument("pdf_path", help="Path to a local PDF")
    parser.add_argument("--parser", choices=["auto", "grobid", "pymupdf"], default="pymupdf")
    parser.add_argument("--extractor", choices=["rules"], default="rules")
    parser.add_argument("--out", default="output/local_test")
    args = parser.parse_args(argv)
    try:
        result = analyze_local_pdf(
            args.pdf_path,
            out_dir=args.out,
            parser_backend=args.parser,
            extractor=args.extractor,
        )
    except Exception as exc:
        print(f"Local PDF analysis failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    analysis = result["analysis"]
    print(f"Status          : {result['status']}")
    print(f"Paper           : {result.get('title')}")
    print(f"Parser          : {result.get('parser')}")
    print(f"Method snippets : {len(analysis.get('methodology', []))}")
    print(f"Key findings    : {len(analysis.get('key_findings', []))}")
    print(f"Research gaps   : {len(analysis.get('research_gaps', []))}")
    print(f"Analysis JSON   : {result['analysis_path']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
