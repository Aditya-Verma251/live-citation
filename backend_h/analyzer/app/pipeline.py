"""Orchestrate PDF retrieval, parsing, extraction, and research-profile storage."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .downloader import download_pdf, safe_paper_id
from .extractor import RuleBasedExtractor
from .parsers import parse_pdf
from .research_profile import summarize_profile_collection, summarize_research_profile
from .storage import read_json, write_json


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _profile_summary(analysis: dict[str, Any]) -> dict[str, Any] | None:
    return summarize_research_profile(analysis.get("research_profile"))


def _readiness(profile_summary: dict[str, Any] | None) -> dict[str, bool]:
    if not isinstance(profile_summary, dict):
        return {}
    return {
        key: bool(value.get("ready"))
        for key, value in (profile_summary.get("dimensions") or {}).items()
        if isinstance(value, dict)
    }


def analyze_local_pdf(
    pdf_path: str | Path,
    *,
    paper: dict[str, Any] | None = None,
    out_dir: str | Path = "output/local_analysis",
    parser_backend: str = "pymupdf",
    extractor: str = "rules",
) -> dict[str, Any]:
    """Analyze an existing PDF and persist parsed text, analysis and profile."""
    path = Path(pdf_path)
    record = dict(paper or {})
    record.setdefault("id", safe_paper_id(path.stem))
    record.setdefault("title", path.stem.replace("_", " "))
    if extractor != "rules":
        raise ValueError("Only the offline rules extractor is supported; use extractor='rules'.")

    parsed = parse_pdf(path, backend=parser_backend)
    analysis = RuleBasedExtractor().extract(record, parsed)
    profile_summary = _profile_summary(analysis)

    destination = Path(out_dir)
    parsed_path = destination / "parsed" / f"{safe_paper_id(record['id'])}.json"
    analysis_path = destination / "analyses" / f"{safe_paper_id(record['id'])}.json"
    write_json(parsed_path, parsed)
    artifact = {
        "processed_at": _utc_now(),
        "paper": record,
        "pdf_path": str(path.resolve()),
        "parser": parsed.get("parser"),
        "parsed_document_path": str(parsed_path),
        "analysis": analysis,
        "research_profile_completeness": profile_summary,
    }
    write_json(analysis_path, artifact)
    return {
        "status": "analyzed",
        "paper_id": record["id"],
        "title": record.get("title"),
        "parser": parsed.get("parser"),
        "parsed_path": str(parsed_path),
        "analysis_path": str(analysis_path),
        "analysis": analysis,
        "research_profile_completeness": profile_summary,
    }


def run_pipeline(
    discovery_json: str | Path,
    *,
    max_papers: int = 5,
    parser_backend: str = "auto",
    extractor: str = "rules",
    out_dir: str | Path = "output",
    pdf_dir: str | Path = "storage/pdfs",
    force_download: bool = False,
    max_pdf_mb: int | None = None,
) -> dict[str, Any]:
    """Process selected papers and save per-paper research profiles."""
    if max_papers < 1:
        raise ValueError("max_papers must be at least 1")
    if parser_backend not in {"auto", "grobid", "pymupdf"}:
        raise ValueError("parser_backend must be auto, grobid, or pymupdf")
    if extractor != "rules":
        raise ValueError("Only the offline rules extractor is supported; use extractor='rules'.")
    if max_pdf_mb is not None and max_pdf_mb < 1:
        raise ValueError("max_pdf_mb must be at least 1")

    discovery = read_json(discovery_json)
    if not isinstance(discovery, dict):
        raise ValueError("Discovery JSON must be a JSON object")
    papers = discovery.get("papers")
    if not isinstance(papers, list):
        raise ValueError("Discovery JSON must contain a 'papers' array")

    output_root = Path(out_dir)
    pdf_root = Path(pdf_dir)
    parsed_root = output_root / "parsed"
    analyses_root = output_root / "analyses"
    parsed_root.mkdir(parents=True, exist_ok=True)
    analyses_root.mkdir(parents=True, exist_ok=True)

    summary: dict[str, Any] = {
        "created_at": _utc_now(),
        "input_discovery_file": str(Path(discovery_json).resolve()),
        "discovery_input": discovery.get("input"),
        "provider": discovery.get("provider"),
        "parser_backend_requested": parser_backend,
        "extractor_requested": "rules",
        "extractor_version": "research-profile-rules-v3",
        "external_ai_used": False,
        "requested_papers": min(max_papers, len(papers)),
        "processed_count": 0,
        "analyzed_count": 0,
        "skipped_count": 0,
        "failed_count": 0,
        "papers": [],
    }
    collected_profiles: list[dict[str, Any]] = []

    for paper in papers[:max_papers]:
        paper_id = safe_paper_id(
            paper.get("id") or paper.get("openalex_id") or paper.get("doi") or paper.get("title") or "paper"
        )
        item: dict[str, Any] = {
            "paper_id": paper_id,
            "title": paper.get("title"),
            "doi": paper.get("doi"),
            "status": "starting",
        }
        summary["processed_count"] += 1
        try:
            retrieval = download_pdf(
                paper,
                pdf_root,
                force=force_download,
                max_pdf_mb=max_pdf_mb,
            )
            item["retrieval"] = retrieval
            if retrieval.get("status") not in {"downloaded", "reused"}:
                item["status"] = retrieval.get("status", "skipped")
                if item["status"] == "failed":
                    summary["failed_count"] += 1
                else:
                    summary["skipped_count"] += 1
                summary["papers"].append(item)
                continue

            pdf_path = Path(retrieval["pdf_path"])
            parsed = parse_pdf(pdf_path, backend=parser_backend)
            parsed_path = parsed_root / f"{paper_id}.json"
            write_json(parsed_path, parsed)

            analysis = RuleBasedExtractor().extract(paper, parsed)
            profile_summary = _profile_summary(analysis)
            profile_ready = _readiness(profile_summary)

            analysis_path = analyses_root / f"{paper_id}.json"
            artifact = {
                "processed_at": _utc_now(),
                "paper": paper,
                "retrieval": retrieval,
                "pdf_path": str(pdf_path.resolve()),
                "parser": parsed.get("parser"),
                "parsed_document_path": str(parsed_path.resolve()),
                "analysis": analysis,
                "research_profile_completeness": profile_summary,
            }
            write_json(analysis_path, artifact)

            item.update({
                "status": "analyzed",
                "parser": parsed.get("parser"),
                "page_count": parsed.get("page_count"),
                "section_count": len(parsed.get("sections", [])),
                "parsed_path": str(parsed_path.resolve()),
                "analysis_path": str(analysis_path.resolve()),
                "evidence_count": len(analysis.get("evidence", [])),
                "research_profile_completeness": profile_summary,
                "comparison_readiness": profile_ready,
                "document_quality": parsed.get("document_quality") or {},
            })
            collected_profiles.append(analysis.get("research_profile") or {})
            summary["analyzed_count"] += 1
        except Exception as exc:  # Keep batch processing resilient per paper.
            item["status"] = "failed"
            item["error"] = f"{type(exc).__name__}: {exc}"
            summary["failed_count"] += 1
        summary["papers"].append(item)

    summary["research_profile_summary"] = summarize_profile_collection(collected_profiles)
    summary_path = output_root / "analysis_summary.json"
    summary["summary_path"] = str(summary_path.resolve())
    write_json(summary_path, summary)
    return summary
