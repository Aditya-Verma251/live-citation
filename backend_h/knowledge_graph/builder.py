"""Build a unified JSON graph from bibliographic and content relationships."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from analyzer.storage import write_json


def _safe_id(value: Any) -> str:
    return str(value or "").strip()


def build_knowledge_graph(
    project_dir: str | Path,
    discovery: dict[str, Any],
    analysis_summary: dict[str, Any],
    relationships: dict[str, Any],
) -> dict[str, Any]:
    """Create nodes/edges and save project/knowledge_graph/graph.json."""
    root = Path(project_dir)
    analysis_status = {
        _safe_id(item.get("paper_id")): item
        for item in (analysis_summary.get("papers") or [])
    }
    analyzed_ids = {
        _safe_id(item.get("id"))
        for item in (relationships.get("analyzed_papers") or [])
    }

    nodes: list[dict[str, Any]] = []
    paper_ids: set[str] = set()
    for paper in discovery.get("papers") or []:
        paper_id = _safe_id(paper.get("id"))
        if not paper_id:
            continue
        paper_ids.add(paper_id)
        status_record = analysis_status.get(paper_id, {})
        nodes.append({
            "id": f"paper:{paper_id}",
            "type": "paper",
            "paper_id": paper_id,
            "label": paper.get("title") or paper_id,
            "title": paper.get("title"),
            "year": paper.get("year"),
            "doi": paper.get("doi"),
            "authors": paper.get("authors") or [],
            "venue": paper.get("venue"),
            "abstract": paper.get("abstract"),
            "cited_by_count": paper.get("cited_by_count"),
            "is_open_access": paper.get("is_open_access"),
            "pdf_url": paper.get("pdf_url"),
            "discovered_via": paper.get("discovered_via") or [],
            "status": "analyzed" if paper_id in analyzed_ids else status_record.get("status", "discovered"),
        })

    edges: list[dict[str, Any]] = []
    for index, edge in enumerate(discovery.get("edges") or []):
        source = _safe_id(edge.get("source"))
        target = _safe_id(edge.get("target"))
        if source not in paper_ids or target not in paper_ids:
            continue
        relation = edge.get("type") or "related_to"
        edges.append({
            "id": f"cite_{index}_{source}_{target}",
            "source": f"paper:{source}",
            "target": f"paper:{target}",
            "type": relation,
            "kind": "bibliographic" if relation == "cites" else "discovery_similarity",
            "label": "cites" if relation == "cites" else "related",
            "explanation": "Bibliographic citation relationship from OpenAlex." if relation == "cites" else "Related-work link supplied by OpenAlex.",
            "requires_human_review": False,
        })

    for edge in relationships.get("inferred_edges") or []:
        source = _safe_id(edge.get("source"))
        target = _safe_id(edge.get("target"))
        if source not in paper_ids or target not in paper_ids:
            continue
        copied = dict(edge)
        copied["source"] = f"paper:{source}"
        copied["target"] = f"paper:{target}"
        copied["label"] = str(edge.get("type", "relationship")).replace("_", " ")
        edges.append(copied)

    gap_groups: dict[str, dict[str, Any]] = {}
    for gap in relationships.get("gaps") or []:
        text = str(gap.get("text") or "").strip()
        paper_id = _safe_id(gap.get("paper_id"))
        if not text or paper_id not in paper_ids:
            continue
        gap_id = _safe_id(gap.get("id")) or "gap_" + hashlib.sha1(text.lower().encode()).hexdigest()[:12]
        group = gap_groups.setdefault(gap_id, {
            "id": f"gap:{gap_id}",
            "type": "research_gap",
            "label": text[:100] + ("…" if len(text) > 100 else ""),
            "text": text,
            "source_paper_ids": [],
            "evidence": gap.get("evidence"),
        })
        if paper_id not in group["source_paper_ids"]:
            group["source_paper_ids"].append(paper_id)

    nodes.extend(gap_groups.values())
    for gap_id, gap_node in gap_groups.items():
        for paper_id in gap_node["source_paper_ids"]:
            edges.append({
                "id": f"gaplink_{gap_id}_{paper_id}",
                "source": f"paper:{paper_id}",
                "target": gap_node["id"],
                "type": "identifies_gap",
                "kind": "extracted_evidence",
                "label": "identifies gap",
                "explanation": "The paper explicitly states this limitation or future-work item.",
                "evidence": gap_node.get("evidence"),
                "requires_human_review": True,
            })

    counts: dict[str, int] = {}
    for edge in edges:
        kind = str(edge.get("type") or "unknown")
        counts[kind] = counts.get(kind, 0) + 1

    graph = {
        "schema_version": "1.0",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "query": discovery.get("input"),
        "summary": {
            "paper_nodes": sum(1 for node in nodes if node.get("type") == "paper"),
            "gap_nodes": sum(1 for node in nodes if node.get("type") == "research_gap"),
            "edges": len(edges),
            "analyzed_papers": len(analyzed_ids),
            "edge_types": counts,
        },
        "nodes": nodes,
        "edges": edges,
        "legend": {
            "cites": "Bibliographic citation recorded by OpenAlex",
            "related_to": "OpenAlex related-work association (not necessarily a citation)",
            "research_relationship": "Heuristic content relationship; inspect evidence",
            "identifies_gap": "Explicit limitation/future-work text extracted from a paper",
        },
    }
    output_path = root / "knowledge_graph" / "graph.json"
    write_json(output_path, graph)
    graph["file"] = str(output_path.resolve())
    return graph
