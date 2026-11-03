"""FastAPI entry point for the file-based research backend.

Run this from the directory containing api.py, app.py, analyzer/, discovery/:
    uvicorn api:app --reload --host 127.0.0.1 --port 8000

The API uses the existing JSON files under ./output. No database is required.
"""
from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app import run_research_pipeline
from relationships.analyzer import analyze_paper_against_board

BASE_DIR = Path(__file__).resolve().parent
_output_setting = Path(os.getenv("RESEARCH_OUTPUT_ROOT", "output")).expanduser()
OUTPUT_DIR = (_output_setting if _output_setting.is_absolute() else BASE_DIR / _output_setting).resolve()
JOBS_DIR = OUTPUT_DIR / ".jobs"

DEFAULT_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
FRONTEND_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv("FRONTEND_ORIGINS", ",".join(DEFAULT_ORIGINS)).split(",")
    if origin.strip()
]

app = FastAPI(
    title="Research Backend API",
    version="1.4.0",
    description="REST API for research discovery, paper analysis, relationships and knowledge graphs.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Accept", "Content-Type", "Authorization"],
)

# Atomic JSON writes keep polling clients from observing partially written job files.
_JOB_WRITE_LOCK = threading.Lock()


class ResearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=300)
    mode: Literal["auto", "keyword", "title", "doi", "arxiv", "openalex", "pmid"] = "auto"
    seeds: int = Field(default=2, ge=1, le=10)
    per_neighborhood: int = Field(default=3, ge=0, le=20)
    max_discovered: int = Field(default=30, ge=1, le=100)
    analyze_limit: int = Field(default=10, ge=1, le=30)
    parser: Literal["auto", "grobid", "pymupdf"] = "pymupdf"
    extractor: Literal["rules"] = "rules"
    force_download: bool = False


class WhiteboardRelationshipRequest(BaseModel):
    """A new paper and the current paper nodes/edges on one whiteboard."""
    new_paper: dict[str, Any]
    existing_papers: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    existing_edges: list[dict[str, Any]] = Field(default_factory=list, max_length=5000)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path, default: Any = None) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _validate_project_id(project_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", project_id or ""):
        raise HTTPException(status_code=400, detail="Invalid project ID.")
    return project_id


def _project_dir(project_id: str) -> Path:
    """Resolve a project directory without allowing path traversal."""
    project_id = _validate_project_id(project_id)
    root = OUTPUT_DIR.resolve()
    candidate = (root / project_id).resolve()
    if candidate.parent != root or not candidate.is_dir():
        raise HTTPException(status_code=404, detail="Research project not found.")
    if not (candidate / "discovery.json").is_file():
        raise HTTPException(status_code=404, detail="Research project is missing discovery.json.")
    return candidate


def read_project_json(project_id: str, filename: str) -> Any:
    """Read a JSON file from a project, restricting reads to that project folder."""
    project = _project_dir(project_id)
    relative = Path(filename)
    if relative.is_absolute() or ".." in relative.parts:
        raise HTTPException(status_code=400, detail="Invalid project file path.")
    path = (project / relative).resolve()
    if project not in path.parents:
        raise HTTPException(status_code=400, detail="Invalid project file path.")
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"Project file not found: {filename}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Project file contains invalid JSON: {filename}") from exc


def _project_ids() -> list[Path]:
    if not OUTPUT_DIR.is_dir():
        return []
    return sorted(
        [
            path for path in OUTPUT_DIR.iterdir()
            if path.is_dir() and not path.name.startswith(".")
            and (path / "discovery.json").is_file()
        ],
        key=lambda path: path.name,
        reverse=True,
    )


def _summary_view(project_dir: Path) -> dict[str, Any]:
    summary = _read_json(project_dir / "research_summary.json", {}) or {}
    discovery = summary.get("discovery") or {}
    selection = summary.get("selection") or {}
    analysis = summary.get("analysis") or _read_json(project_dir / "analysis" / "analysis_summary.json", {}) or {}
    relationships = summary.get("relationships") or _read_json(project_dir / "relationships" / "relationships.json", {}) or {}
    graph = summary.get("knowledge_graph") or {}
    return {
        "project_id": project_dir.name,
        "query": summary.get("query") or project_dir.name,
        "created_at": summary.get("created_at"),
        "mode": summary.get("mode"),
        "input_resolution": summary.get("input_resolution"),
        "resolved_paper": (summary.get("input_resolution") or {}).get("resolved_paper"),
        "discovery": {
            "paper_count": discovery.get("paper_count", 0),
            "edge_count": discovery.get("edge_count", 0),
        },
        "selection": {
            "selected_count": selection.get("selected_count", 0),
            "selected_papers": selection.get("selected_papers", []),
        },
        "analysis": {
            "processed_count": analysis.get("processed_count", 0),
            "analyzed_count": analysis.get("analyzed_count", 0),
            "skipped_count": analysis.get("skipped_count", 0),
            "failed_count": analysis.get("failed_count", 0),
            "research_profile_summary": analysis.get("research_profile_summary", {}),
        },
        "relationships": {
            "analyzed_paper_count": relationships.get("analyzed_paper_count", 0),
            "pairwise_comparison_count": relationships.get("pairwise_comparison_count", 0),
            "inferred_relationship_count": relationships.get("inferred_relationship_count", 0),
            "gap_count": relationships.get("gap_count", len(relationships.get("gaps") or [])),
        },
        "knowledge_graph": graph,
    }


def _find_analysis_artifact(project_dir: Path, paper_id: str) -> dict[str, Any] | None:
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,200}", paper_id or ""):
        raise HTTPException(status_code=400, detail="Invalid paper ID.")
    analyses_dir = project_dir / "analysis" / "analyses"
    if not analyses_dir.is_dir():
        return None
    for path in analyses_dir.glob("*.json"):
        item = _read_json(path)
        if isinstance(item, dict) and str((item.get("paper") or {}).get("id", "")) == paper_id:
            return item
    return None


def _set_job(job_id: str, **updates: Any) -> dict[str, Any]:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    path = JOBS_DIR / f"{job_id}.json"
    with _JOB_WRITE_LOCK:
        current = _read_json(path, {"job_id": job_id, "created_at": _now()}) or {}
        current.update(updates)
        current["updated_at"] = _now()
        _write_json(path, current)
    return current


def _run_research_job(job_id: str, request: ResearchRequest) -> None:
    _set_job(job_id, status="running", started_at=_now())
    try:
        result = run_research_pipeline(
            request.query,
            mode=request.mode,
            seed_limit=request.seeds,
            per_neighborhood=request.per_neighborhood,
            max_discovered=request.max_discovered,
            analyze_limit=request.analyze_limit,
            parser_backend=request.parser,
            extractor=request.extractor,
            output_root=OUTPUT_DIR,
            force_download=request.force_download,
        )
        result_project_dir = Path(result["project_dir"]).resolve()
        # Ensure a buggy/misconfigured pipeline cannot write a project ID outside OUTPUT_DIR.
        if OUTPUT_DIR.resolve() not in result_project_dir.parents:
            raise RuntimeError("Pipeline returned a project directory outside the configured output directory.")
        _set_job(
            job_id,
            status="completed",
            finished_at=_now(),
            project_id=result_project_dir.name,
            result=_summary_view(result_project_dir),
        )
    except Exception as exc:
        _set_job(
            job_id,
            status="failed",
            finished_at=_now(),
            error=f"{type(exc).__name__}: {exc}",
        )


@app.post("/api/whiteboard/relationships")
def scan_new_whiteboard_paper(request: WhiteboardRelationshipRequest) -> dict[str, Any]:
    """Incrementally compare one newly added paper against all existing board papers."""
    try:
        return analyze_paper_against_board(
            request.new_paper,
            request.existing_papers,
            request.existing_edges,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Whiteboard relationship scan failed: {type(exc).__name__}: {exc}",
        ) from exc


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "research-backend",
        "output_dir": str(OUTPUT_DIR),
        "output_dir_exists": OUTPUT_DIR.is_dir(),
        "extractor": "rules",
        "relationship_engine": "offline_independent_category_v4",
        "relationship_categories": [
            "similar_research_focus",
            "similar_methodology",
            "shared_research_gap",
            "potentially_addresses_gap",
            "potentially_conflicting_findings",
        ],
        "whiteboard_auto_relationships": True,
        "whiteboard_relationship_endpoint": "/api/whiteboard/relationships",
        "whiteboard_diagnostics_schema": "2.0",
        "whiteboard_max_existing_papers": 500,
        "research_profile_schema": "1.0",
        "research_profile_extractor_version": "research-profile-rules-v3",
        "external_ai_required": False,
        "identifier_resolution_version": "scholarly-identifiers-v3",
        "supported_research_identifiers": ["doi", "arxiv", "openalex", "pmid", "exact_title", "keyword"],
    }


@app.get("/api/projects")
def list_projects() -> dict[str, Any]:
    projects = []
    for directory in _project_ids():
        summary = _summary_view(directory)
        projects.append({
            "id": directory.name,
            "project_id": directory.name,
            "query": summary["query"],
            "created_at": summary.get("created_at") or directory.name,
            "paper_count": summary["discovery"]["paper_count"],
            "analyzed_count": summary["analysis"]["analyzed_count"],
            "skipped_count": summary["analysis"]["skipped_count"],
            "failed_count": summary["analysis"]["failed_count"],
            "relationship_count": summary["relationships"]["inferred_relationship_count"],
        })
    return {"projects": projects, "count": len(projects)}


@app.post("/api/research", status_code=202)
def start_research(request: ResearchRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    # Paper extraction and relationship scoring are fully local/rule-based.
    job_id = uuid.uuid4().hex
    request_data = request.model_dump() if hasattr(request, "model_dump") else request.dict()
    _set_job(job_id, status="queued", request=request_data)
    background_tasks.add_task(_run_research_job, job_id, request)
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    if not re.fullmatch(r"[a-f0-9]{32}", job_id or ""):
        raise HTTPException(status_code=400, detail="Invalid job ID.")
    job = _read_json(JOBS_DIR / f"{job_id}.json")
    if not job:
        raise HTTPException(status_code=404, detail="Research job not found.")
    return job


@app.get("/api/projects/{project_id}/summary")
def get_summary(project_id: str) -> dict[str, Any]:
    return _summary_view(_project_dir(project_id))


@app.get("/api/projects/{project_id}/papers")
def get_papers(project_id: str) -> dict[str, Any]:
    directory = _project_dir(project_id)
    discovery = read_project_json(project_id, "discovery.json")
    analysis = _read_json(directory / "analysis" / "analysis_summary.json", {}) or {}
    analysis_by_id = {
        str(item.get("paper_id")): item
        for item in analysis.get("papers", [])
        if item.get("paper_id")
    }
    papers = []
    for paper in discovery.get("papers", []):
        paper_id = str(paper.get("id", ""))
        status = analysis_by_id.get(paper_id, {})
        artifact = _find_analysis_artifact(directory, paper_id) if status.get("status") == "analyzed" else None
        item = {
            **paper,
            "analysis_status": status.get("status", "discovered"),
            "analysis_error": status.get("error"),
            "retrieval": status.get("retrieval"),
            "research_profile_completeness": status.get("research_profile_completeness"),
            "comparison_readiness": status.get("comparison_readiness", {}),
        }
        # The whiteboard uses extracted fields and their completeness metadata
        # for incremental node-to-board matching. Returning them here avoids a
        # second API call for each paper.
        if isinstance(artifact, dict):
            analysis_data = artifact.get("analysis") or {}
            item["analysis"] = analysis_data
            item["research_profile"] = analysis_data.get("research_profile")
            item["research_profile_completeness"] = (
                item.get("research_profile_completeness")
                or artifact.get("research_profile_completeness")
                or ((analysis_data.get("research_profile") or {}).get("completeness"))
            )
        papers.append(item)
    return {"project_id": project_id, "count": len(papers), "papers": papers}


@app.get("/api/projects/{project_id}/papers/{paper_id}")
def get_paper(project_id: str, paper_id: str) -> dict[str, Any]:
    directory = _project_dir(project_id)
    discovery = read_project_json(project_id, "discovery.json")
    paper = next((item for item in discovery.get("papers", []) if str(item.get("id")) == paper_id), None)
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found in this project.")
    return {"paper": paper, "analysis_artifact": _find_analysis_artifact(directory, paper_id)}


@app.get("/api/projects/{project_id}/graph")
def get_graph(project_id: str) -> dict[str, Any]:
    return read_project_json(project_id, "knowledge_graph/graph.json")


@app.get("/api/projects/{project_id}/relationships")
def get_relationships(project_id: str) -> dict[str, Any]:
    return read_project_json(project_id, "relationships/relationships.json")


@app.get("/api/projects/{project_id}/gaps")
def get_gaps(project_id: str) -> dict[str, Any]:
    relationships = read_project_json(project_id, "relationships/relationships.json")
    gaps = relationships.get("gaps") or []
    return {"project_id": project_id, "count": len(gaps), "gaps": gaps}
