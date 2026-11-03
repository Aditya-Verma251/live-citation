"""Normalized research-profile schema and completeness helpers.

The profile is deliberately descriptive: it records what the local extractor
found, where it found it, and which comparison dimensions have enough data.
It does not infer missing scientific claims.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

PROFILE_SCHEMA_VERSION = "1.0"

PROFILE_FIELDS: tuple[str, ...] = (
    "research_problem",
    "research_objective",
    "research_questions",
    "methodology",
    "method_concepts",
    "datasets",
    "evaluation_metrics",
    "contributions",
    "key_findings",
    "conclusion",
    "limitations",
    "future_work",
    "research_gaps",
)

DIMENSION_FIELDS: dict[str, tuple[str, ...]] = {
    "research_focus": (
        "research_problem",
        "research_objective",
        "research_questions",
        "key_findings",
        "conclusion",
    ),
    "methodology": (
        "methodology",
        "method_concepts",
        "datasets",
        "evaluation_metrics",
    ),
    "research_gaps": (
        "research_gaps",
        "limitations",
        "future_work",
    ),
    "findings": ("key_findings", "conclusion"),
}


def _items(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = " ".join(value.split())
        return [text] if text else []
    if isinstance(value, (list, tuple, set)):
        result: list[str] = []
        for item in value:
            result.extend(_items(item))
        return result
    if isinstance(value, dict):
        for key in ("text", "quote", "value", "name", "description"):
            if value.get(key):
                return _items(value[key])
        return []
    text = str(value).strip()
    return [text] if text else []


def _field_sources(analysis: dict[str, Any], field: str) -> tuple[list[dict[str, Any]], list[str]]:
    evidence = analysis.get("evidence") or []
    matched: list[dict[str, Any]] = []
    sections: list[str] = []
    if not isinstance(evidence, list):
        return matched, sections
    for item in evidence:
        if not isinstance(item, dict) or item.get("field") != field:
            continue
        quote = str(item.get("quote") or "").strip()
        if not quote:
            continue
        matched.append({
            "quote": quote,
            "section": item.get("section"),
            "page_start": item.get("page_start"),
            "page_end": item.get("page_end"),
            "source": item.get("source", "pdf_section"),
            "rule": item.get("rule"),
        })
        label = str(item.get("section") or item.get("source") or "Unknown source")
        if label not in sections:
            sections.append(label)
    return matched, sections


def _field_status(values: list[str], evidence: list[dict[str, Any]]) -> str:
    if not values:
        return "missing"
    meaningful = [value for value in values if len(value.split()) >= 5 or len(value) >= 35]
    if meaningful and evidence:
        return "available"
    return "partial"


def _confidence(evidence: list[dict[str, Any]], values: list[str]) -> str:
    if not values:
        return "none"
    if not evidence:
        return "low"
    sources = {str(item.get("source") or "") for item in evidence}
    sections = {str(item.get("section") or "").casefold() for item in evidence}
    if "pdf_section" in sources and sections & {
        "methodology", "methods", "materials and methods", "results",
        "conclusion", "conclusions", "limitations", "future work",
    }:
        return "high"
    if "pdf_section" in sources or "pdf_abstract" in sources:
        return "medium"
    return "low"


def build_research_profile(
    analysis: dict[str, Any],
    parsed: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a stable, provenance-aware profile from legacy flat fields."""
    parsed = parsed or {}
    fields: dict[str, dict[str, Any]] = {}
    available_count = 0
    field_status_counts: Counter[str] = Counter()

    for field in PROFILE_FIELDS:
        values = _items(analysis.get(field))
        evidence, sections = _field_sources(analysis, field)
        status = _field_status(values, evidence)
        # A conclusion-like synthesis taken from Discussion/Results is useful,
        # but is not equivalent to a formally headed Conclusion section.
        if field == "conclusion" and analysis.get("conclusion_source") == "discussion_fallback" and values:
            status = "partial"
        if status == "available":
            available_count += 1
        field_status_counts[status] += 1
        confidence = _confidence(evidence, values)
        if field == "conclusion" and analysis.get("conclusion_source") == "discussion_fallback":
            confidence = "medium"
        fields[field] = {
            "value": values,
            "status": status,
            "confidence": confidence,
            "source_sections": sections,
            "evidence": evidence[:12],
            "value_count": len(values),
        }

    dimensions: dict[str, dict[str, Any]] = {}
    for dimension, names in DIMENSION_FIELDS.items():
        ready_fields = [name for name in names if fields[name]["status"] == "available"]
        partial_fields = [name for name in names if fields[name]["status"] == "partial"]
        missing_fields = [name for name in names if fields[name]["status"] == "missing"]
        ratio = len(ready_fields) / len(names) if names else 0.0

        # A dimension is usable when at least one meaningful primary field is
        # supported by evidence. This is a coverage indicator, not a quality claim.
        if dimension == "research_focus":
            ready = bool(set(ready_fields) & {"research_objective", "key_findings", "conclusion"})
        elif dimension == "methodology":
            ready = "methodology" in ready_fields or "method_concepts" in ready_fields
        elif dimension == "research_gaps":
            ready = bool(set(ready_fields) & {"research_gaps", "limitations", "future_work"})
        else:
            ready = bool(ready_fields)

        dimensions[dimension] = {
            "ready": ready,
            "coverage": round(ratio, 3),
            "available_fields": ready_fields,
            "partial_fields": partial_fields,
            "missing_fields": missing_fields,
        }

    total_fields = len(PROFILE_FIELDS)
    coverage = available_count / total_fields if total_fields else 0.0
    percent = round(coverage * 100)
    quality_band = "high" if percent >= 75 else "moderate" if percent >= 45 else "sparse"

    document_quality = parsed.get("document_quality") or {}
    warnings = list(parsed.get("warnings") or [])
    if not parsed.get("full_text"):
        warnings.append("The parser did not return full-text content.")

    return {
        "schema_version": PROFILE_SCHEMA_VERSION,
        "fields": fields,
        "dimensions": dimensions,
        "completeness": {
            "available_fields": available_count,
            "partial_fields": field_status_counts["partial"],
            "missing_fields": field_status_counts["missing"],
            "total_fields": total_fields,
            "coverage": round(coverage, 3),
            "percent": percent,
            "quality_band": quality_band,
            "missing_field_names": [
                name for name, item in fields.items() if item["status"] == "missing"
            ],
        },
        "document": {
            "parser": parsed.get("parser"),
            "page_count": parsed.get("page_count"),
            "section_count": len(parsed.get("sections") or []),
            "text_characters": len(str(parsed.get("full_text") or "")),
            "quality": document_quality,
            "warnings": warnings,
        },
        "notes": [
            "Profile fields are extracted from source text using deterministic rules; they are not AI-interpreted claims.",
            "Evidence quotes and page references identify where extracted information came from when available.",
            "Missing means the extractor did not identify sufficient evidence; it does not mean the paper contains no such information.",
            "Dimension readiness indicates whether enough extracted information exists to attempt that comparison, not whether a relationship exists.",
        ],
    }


def summarize_research_profile(profile: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return the compact completeness payload for job/project API responses."""
    if not isinstance(profile, dict):
        return None
    completeness = profile.get("completeness") or {}
    dimensions = profile.get("dimensions") or {}
    return {
        "schema_version": profile.get("schema_version", PROFILE_SCHEMA_VERSION),
        "percent": completeness.get("percent", 0),
        "coverage": completeness.get("coverage", 0.0),
        "quality_band": completeness.get("quality_band", "sparse"),
        "available_fields": completeness.get("available_fields", 0),
        "partial_fields": completeness.get("partial_fields", 0),
        "missing_fields": completeness.get("missing_fields", len(completeness.get("missing_field_names") or [])),
        "missing_field_names": completeness.get("missing_field_names", []),
        "dimensions": {
            key: {
                "ready": bool(value.get("ready")),
                "coverage": value.get("coverage", 0.0),
            }
            for key, value in dimensions.items()
            if isinstance(value, dict)
        },
    }


def summarize_profile_collection(profiles: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate profile completeness across a project without hiding missing data."""
    valid = [profile for profile in profiles if isinstance(profile, dict)]
    field_names = list(PROFILE_FIELDS)
    field_coverage: dict[str, dict[str, int]] = {}
    dimension_ready: dict[str, dict[str, int]] = {}

    for field in field_names:
        statuses = [((profile.get("fields") or {}).get(field) or {}).get("status", "missing") for profile in valid]
        field_coverage[field] = {
            "available": sum(status == "available" for status in statuses),
            "partial": sum(status == "partial" for status in statuses),
            "missing": sum(status == "missing" for status in statuses),
        }

    for dimension in DIMENSION_FIELDS:
        ready_count = sum(
            bool(((profile.get("dimensions") or {}).get(dimension) or {}).get("ready"))
            for profile in valid
        )
        dimension_ready[dimension] = {
            "ready": ready_count,
            "not_ready": len(valid) - ready_count,
        }

    percents = [int(((profile.get("completeness") or {}).get("percent") or 0)) for profile in valid]
    return {
        "schema_version": PROFILE_SCHEMA_VERSION,
        "profiled_paper_count": len(valid),
        "average_completeness_percent": round(sum(percents) / len(percents), 1) if percents else 0.0,
        "papers_with_sparse_profiles": sum(
            (profile.get("completeness") or {}).get("quality_band") == "sparse"
            for profile in valid
        ),
        "field_coverage": field_coverage,
        "dimension_readiness": dimension_ready,
    }
