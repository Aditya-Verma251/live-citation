"""Re-extract Phase 1 research profiles from already parsed project documents.

Usage:
    python rebuild_research_profiles.py output/<project_id>
    python rebuild_research_profiles.py output/<project_id> --dry-run

This uses saved ``analysis/parsed/*.json`` files, so it does not redownload PDFs.
It updates analysis artifacts and analysis summaries, while saving backups first.
It does not rebuild relationship edges or the knowledge graph.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from analyzer.extractor import RuleBasedExtractor
from analyzer.research_profile import summarize_profile_collection, summarize_research_profile
from analyzer.storage import write_json


def _read_object(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return data


def _parsed_path(project_dir: Path, artifact_path: Path, artifact: dict[str, Any]) -> Path | None:
    supplied = artifact.get("parsed_document_path")
    if supplied:
        candidate = Path(str(supplied)).expanduser()
        if candidate.is_file():
            return candidate
        if not candidate.is_absolute():
            project_candidate = (project_dir / candidate).resolve()
            if project_candidate.is_file():
                return project_candidate
    fallback = project_dir / "analysis" / "parsed" / f"{artifact_path.stem}.json"
    return fallback if fallback.is_file() else None


def rebuild_project(project_dir: Path, *, dry_run: bool = False) -> dict[str, Any]:
    analysis_dir = project_dir / "analysis"
    analyses_dir = analysis_dir / "analyses"
    if not analyses_dir.is_dir():
        raise FileNotFoundError(f"Analysis artifacts directory not found: {analyses_dir}")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_root = project_dir / ".phase1_profile_backups" / timestamp
    extractor = RuleBasedExtractor()
    profile_list: list[dict[str, Any]] = []
    updated = 0
    skipped: list[dict[str, str]] = []
    updates_by_id: dict[str, dict[str, Any]] = {}

    for artifact_path in sorted(analyses_dir.glob("*.json")):
        try:
            artifact = _read_object(artifact_path)
            paper = artifact.get("paper") or {}
            if not isinstance(paper, dict):
                raise ValueError("Artifact has no valid paper object")
            parsed_path = _parsed_path(project_dir, artifact_path, artifact)
            if parsed_path is None:
                skipped.append({
                    "artifact": artifact_path.name,
                    "reason": "Saved parsed JSON was not found; no PDF download was attempted.",
                })
                continue
            parsed = _read_object(parsed_path)
            analysis = extractor.extract(paper, parsed)
            profile_summary = summarize_research_profile(analysis.get("research_profile")) or {}
            profile = analysis.get("research_profile") or {}
            paper_id = str(paper.get("id") or paper.get("openalex_id") or artifact_path.stem)

            # Preserve annotations that are not owned by the local extractor.
            old_analysis = artifact.get("analysis") or {}
            if isinstance(old_analysis, dict):
                for key in ("user_notes", "manual_annotations", "whiteboard_metadata"):
                    if key in old_analysis and key not in analysis:
                        analysis[key] = old_analysis[key]

            updated_artifact = dict(artifact)
            updated_artifact["analysis"] = analysis
            updated_artifact["research_profile_completeness"] = profile_summary
            updated_artifact["profile_rebuilt_at"] = datetime.now(timezone.utc).isoformat()
            updated_artifact["parsed_document_path"] = str(parsed_path.resolve())

            if not dry_run:
                backup_path = backup_root / "analyses" / artifact_path.name
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(artifact_path, backup_path)
                write_json(artifact_path, updated_artifact)

            profile_list.append(profile)
            updates_by_id[paper_id] = {
                "research_profile_completeness": profile_summary,
                "comparison_readiness": {
                    key: bool(value.get("ready"))
                    for key, value in (profile_summary.get("dimensions") or {}).items()
                    if isinstance(value, dict)
                },
                "evidence_count": len(analysis.get("evidence") or []),
                "extractor_version": analysis.get("extractor_version"),
            }
            updated += 1
        except Exception as exc:
            skipped.append({
                "artifact": artifact_path.name,
                "reason": f"{type(exc).__name__}: {exc}",
            })

    summary_path = analysis_dir / "analysis_summary.json"
    summary = _read_object(summary_path) if summary_path.is_file() else {"papers": []}
    summary_papers = summary.get("papers") or []
    for item in summary_papers:
        if not isinstance(item, dict):
            continue
        paper_id = str(item.get("paper_id") or "")
        if paper_id in updates_by_id:
            item.update(updates_by_id[paper_id])
    summary["extractor_requested"] = "rules"
    summary["extractor_version"] = "research-profile-rules-v3"
    summary["external_ai_used"] = False
    summary["research_profile_summary"] = summarize_profile_collection(profile_list)
    summary["profile_rebuild"] = {
        "updated_artifacts": updated,
        "skipped_artifacts": len(skipped),
        "skipped": skipped,
        "dry_run": dry_run,
        "backup_directory": str(backup_root.resolve()) if not dry_run else None,
    }

    if not dry_run:
        write_json(summary_path, summary)
        project_summary_path = project_dir / "research_summary.json"
        if project_summary_path.is_file():
            project_summary = _read_object(project_summary_path)
            project_summary["analysis"] = summary
            write_json(project_summary_path, project_summary)

    return {
        "project_dir": str(project_dir.resolve()),
        "updated_artifacts": updated,
        "skipped_artifacts": len(skipped),
        "skipped": skipped,
        "research_profile_summary": summary["research_profile_summary"],
        "dry_run": dry_run,
        "backup_directory": str(backup_root.resolve()) if not dry_run else None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Rebuild local research profiles from saved parsed-document JSON files."
    )
    parser.add_argument("project_dir", help="Existing output/<project_id> directory")
    parser.add_argument("--dry-run", action="store_true", help="Report profile coverage without changing files")
    args = parser.parse_args(argv)

    project_dir = Path(args.project_dir).expanduser().resolve()
    if not project_dir.is_dir():
        parser.error(f"Project directory does not exist: {project_dir}")

    try:
        result = rebuild_project(project_dir, dry_run=args.dry_run)
    except Exception as exc:
        print(f"Could not rebuild research profiles: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    print("RESEARCH PROFILE REBUILD COMPLETE" + (" (DRY RUN)" if args.dry_run else ""))
    print("=" * 42)
    print(f"Updated artifacts : {result['updated_artifacts']}")
    print(f"Skipped artifacts : {result['skipped_artifacts']}")
    print(f"Profile summary   : {result['research_profile_summary']}")
    if result["backup_directory"]:
        print(f"Backups saved to  : {result['backup_directory']}")
    for item in result["skipped"]:
        print(f"SKIPPED {item['artifact']}: {item['reason']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
