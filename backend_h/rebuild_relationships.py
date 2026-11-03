"""Re-run the offline relationship finder for an existing project folder.

Usage from the backend root:
    python rebuild_relationships.py output/<project_id>

This does not download PDFs, call an LLM, or re-run extraction. It consumes
existing analysis/analyses/*.json files and rebuilds relationships.json and
graph.json.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from relationships.analyzer import analyze_project
from knowledge_graph.builder import build_knowledge_graph


def _read(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"Required project file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected a JSON object in {path}")
    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Rebuild offline paper relationships and knowledge graph.")
    parser.add_argument("project_dir", help="Existing output/<project_id> directory")
    args = parser.parse_args(argv)

    project_dir = Path(args.project_dir).expanduser().resolve()
    if not project_dir.is_dir():
        parser.error(f"Project directory does not exist: {project_dir}")

    try:
        discovery = _read(project_dir / "discovery.json")
        analysis_summary_path = project_dir / "analysis" / "analysis_summary.json"
        if analysis_summary_path.is_file():
            analysis_summary = _read(analysis_summary_path)
        else:
            # Older or manually assembled projects may have analysis artifacts
            # without the aggregate summary. Reconstruct the minimum status
            # index required by the graph builder from those artifacts.
            analysis_summary = {"papers": []}
            analyses_dir = project_dir / "analysis" / "analyses"
            for artifact_path in sorted(analyses_dir.glob("*.json")):
                try:
                    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                paper = artifact.get("paper") or {} if isinstance(artifact, dict) else {}
                paper_id = paper.get("id") or paper.get("openalex_id") or artifact_path.stem
                analysis_summary["papers"].append({
                    "paper_id": str(paper_id),
                    "status": "analyzed",
                })
        result = analyze_project(project_dir, discovery)
        graph = build_knowledge_graph(project_dir, discovery, analysis_summary, result)
    except Exception as exc:
        print(f"Could not rebuild relationships: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    print("OFFLINE RELATIONSHIP REBUILD COMPLETE")
    print("=" * 40)
    print(f"Analyzed papers       : {result['analyzed_paper_count']}")
    print(f"Pairwise comparisons  : {result['pairwise_comparison_count']}")
    print(f"Candidate relationships: {result['candidate_relationship_count']}")
    print(f"Inferred edges        : {result['inferred_relationship_count']}")
    print(f"Relationship types    : {result['relationship_type_counts']}")
    print(f"Gap records           : {len(result.get('gaps') or [])}")
    print(f"Relationships JSON   : {result['file']}")
    print(f"Knowledge graph       : {graph['file']}")
    if result['analyzed_paper_count'] < 2:
        print("NOTE: At least two analysis artifacts are needed for pairwise comparison.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
