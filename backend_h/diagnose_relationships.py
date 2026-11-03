#!/usr/bin/env python3
"""Diagnose why a research project has zero identified relationships.

Run from the backend project root:
    python diagnose_relationships.py
    python diagnose_relationships.py --project output/<project_id>
    python diagnose_relationships.py --test-model
    python diagnose_relationships.py --test-openai

The script never prints the API key and does not submit a paid chat completion.
--test-openai makes an authenticated GET /v1/models request only.
--test-model loads the configured embedding model and scores two sample pairs;
this may download the model on first use.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def text_length(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, str):
        return len(value.strip())
    if isinstance(value, (list, tuple)):
        return sum(text_length(item) for item in value)
    if isinstance(value, dict):
        return sum(text_length(item) for item in value.values())
    return len(str(value).strip())


def newest_project(output_dir: Path) -> Path | None:
    candidates = []
    if not output_dir.is_dir():
        return None
    for folder in output_dir.iterdir():
        rel_file = folder / "relationships" / "relationships.json"
        if not (folder.is_dir() and rel_file.is_file()):
            continue
        # Prefer the timestamp embedded in generated project IDs. This also
        # works when a ZIP extraction gives every file the same mtime.
        match = re.search(r"(\d{8}T\d{6}Z)$", folder.name)
        timestamp_key = match.group(1) if match else ""
        summary = read_json(folder / "research_summary.json")
        created_at = str(summary.get("created_at") or "")
        try:
            mtime = rel_file.stat().st_mtime
        except OSError:
            mtime = 0
        candidates.append(((timestamp_key, created_at, mtime, folder.name), folder))
    return max(candidates, default=(None, None), key=lambda item: item[0])[1]


def print_section(title: str) -> None:
    print("\n" + "=" * 76)
    print(title)
    print("=" * 76)


def check_openai(api_key: str) -> tuple[bool, str]:
    request = urllib.request.Request(
        "https://api.openai.com/v1/models",
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.loads(response.read().decode("utf-8"))
            count = len(data.get("data", []))
            return True, f"Authenticated successfully; model listing returned {count} entries."
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        return False, f"HTTP {exc.code}: {body}"
    except Exception as exc:  # network/DNS/TLS errors
        return False, f"{type(exc).__name__}: {exc}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", help="Project folder, e.g. output/my_project")
    parser.add_argument("--output", default="output", help="Output directory (default: output)")
    parser.add_argument("--frontend-request", default="../frontend/src/services/researchApi.ts")
    parser.add_argument("--test-model", action="store_true", help="Actually load and test the embedding model")
    parser.add_argument("--test-openai", action="store_true", help="Validate API key with GET /v1/models; no chat completion")
    args = parser.parse_args()

    backend_root = Path.cwd().resolve()
    # Ensure imports resolve from the project root even when this script is
    # invoked by an absolute path.
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))
    print_section("RUNTIME / PROJECT LOCATION")
    print(f"Working directory: {backend_root}")
    print(f"Python executable: {sys.executable}")
    print(f"Python version: {sys.version.split()[0]}")

    # Import app modules from the backend root so we can report which copy is used.
    try:
        from analyzer import config
        from relationships import analyzer as relationship_analyzer
    except Exception as exc:
        print(f"FAIL: Could not import backend modules: {type(exc).__name__}: {exc}")
        return 2

    config_file = Path(config.__file__).resolve()
    project_root = Path(getattr(config, "PROJECT_ROOT", config_file.parents[1])).resolve()
    root_env = project_root / ".env"
    analyzer_env = project_root / "analyzer" / ".env"

    print_section("CONFIGURATION / API KEY")
    print(f"analyzer.config loaded from: {config_file}")
    print(f"relationships.analyzer loaded from: {Path(relationship_analyzer.__file__).resolve()}")
    print(f"Config PROJECT_ROOT: {project_root}")
    print(f"Expected .env: {root_env} (exists={root_env.is_file()})")
    print(f"analyzer/.env: {analyzer_env} (exists={analyzer_env.is_file()})")
    api_key = str(getattr(config, "OPENAI_API_KEY", "") or "").strip()
    print(f"OPENAI_API_KEY loaded: {bool(api_key)} (key value hidden)")
    print(f"OPENAI_MODEL: {getattr(config, 'OPENAI_MODEL', '<missing>')}")
    print(f"RELATIONSHIP_MODEL: {getattr(config, 'RELATIONSHIP_MODEL', '<missing>')}")
    print(f"EMBEDDING_MODEL: {getattr(config, 'EMBEDDING_MODEL', '<missing>')}")

    if not api_key:
        print("DIAGNOSIS: The running backend process does not see an OpenAI API key.")
        if analyzer_env.is_file() and not root_env.is_file():
            print("  Likely cause: key is in analyzer/.env, while config expects backend-root .env.")
        print("  Fix: put OPENAI_API_KEY in the .env beside api.py/app.py, then restart the backend.")

    print_section("DEPENDENCIES")
    has_st = importlib.util.find_spec("sentence_transformers") is not None
    print(f"sentence_transformers import available: {has_st}")
    print(f"Root requirements.txt exists: {(backend_root / 'requirements.txt').is_file()}")
    root_req = backend_root / "requirements.txt"
    analyzer_req = backend_root / "analyzer" / "requirements.txt"
    for req in (root_req, analyzer_req):
        if req.is_file():
            content = req.read_text(encoding="utf-8", errors="replace").lower()
            print(f"{req.relative_to(backend_root)} contains sentence-transformers: {'sentence-transformers' in content}")
    if not has_st:
        print("DIAGNOSIS: Semantic comparison cannot run in this Python environment.")
        print("  Fix: python -m pip install 'sentence-transformers>=3.0.0'")

    print_section("FRONTEND REQUEST CONFIGURATION")
    frontend_file = (backend_root / args.frontend_request).resolve()
    if frontend_file.is_file():
        source = frontend_file.read_text(encoding="utf-8", errors="replace")
        match = re.search(r"extractor\s*:\s*['\"](rules|openai)['\"]", source)
        print(f"Frontend request file: {frontend_file}")
        print(f"Extractor value found: {match.group(1) if match else 'not found'}")
        if match and match.group(1) != "openai":
            print("DIAGNOSIS: Frontend is explicitly requesting rules-based extraction.")
    else:
        print(f"Frontend request file not found at {frontend_file}; set --frontend-request to its path.")

    output_dir = Path(args.output).resolve()
    project = Path(args.project).resolve() if args.project else newest_project(output_dir)
    print_section("LATEST PROJECT / RUN OUTPUT")
    print(f"Output directory: {output_dir}")
    if project is None or not project.is_dir():
        print("No project found. Run a new research job first or pass --project.")
        return 1
    print(f"Selected project: {project}")

    analysis_summary = read_json(project / "analysis" / "analysis_summary.json")
    relationships = read_json(project / "relationships" / "relationships.json")
    graph = read_json(project / "knowledge_graph" / "graph.json")

    extractor = analysis_summary.get("extractor_requested", "<missing>")
    analyzed = analysis_summary.get("analyzed_count", relationships.get("analyzed_paper_count", 0))
    processed = analysis_summary.get("processed_count", "<missing>")
    skipped = analysis_summary.get("skipped_count", "<missing>")
    failed = analysis_summary.get("failed_count", "<missing>")
    print(f"Extractor requested by this run: {extractor}")
    print(f"Processed / analyzed / skipped / failed: {processed} / {analyzed} / {skipped} / {failed}")
    if extractor != "openai":
        print("DIAGNOSIS: This project was NOT extracted with OpenAI, regardless of the current frontend setting.")
        print("  Likely cause: an old frontend/backend process, a different API server, or this is an old project.")

    method = relationships.get("method", "<missing>")
    print(f"Relationship method in saved output: {method}")
    print(f"Relationship schema_version: {relationships.get('schema_version', '<missing>')}")
    for key in (
        "analyzed_paper_count", "pairwise_comparison_count",
        "candidate_relationship_count", "verification_call_count",
        "verification_accepted_count", "verification_unavailable_count",
        "verification_error_count", "semantic_error_count",
        "inferred_relationship_count",
    ):
        if key in relationships:
            print(f"{key}: {relationships[key]}")
        else:
            print(f"{key}: <not recorded by this run>")

    semantic_comparisons = [c for c in relationships.get("comparisons", []) if isinstance(c, dict)]
    has_semantic_scores = any(isinstance(c.get("semantic_similarity"), dict) for c in semantic_comparisons)
    has_old_method = "Rule-based lexical overlap" in str(method)
    if has_old_method or not has_semantic_scores:
        print("DIAGNOSIS: This saved project was generated by the older lexical relationship analyzer.")
        print("  It is not evidence that the new semantic analyzer failed; rerun using the currently patched backend.")

    if relationships.get("semantic_error_count"):
        print("Semantic errors:")
        for c in semantic_comparisons:
            if c.get("comparison_status") == "semantic_error":
                print(f"  {c.get('paper_a')} vs {c.get('paper_b')}: {c.get('error')}")

    if relationships.get("verification_errors"):
        print("Verification errors:")
        for item in relationships["verification_errors"][:10]:
            print(f"  {item.get('paper_a')} vs {item.get('paper_b')}: {item.get('error')}")

    analyses_dir = project / "analysis" / "analyses"
    print_section("EXTRACTED CONTENT COVERAGE")
    field_names = (
        "research_problem", "research_objective", "research_questions",
        "methodology", "datasets", "key_findings", "conclusion",
        "limitations", "future_work", "research_gaps",
    )
    artifacts = sorted(analyses_dir.glob("*.json")) if analyses_dir.is_dir() else []
    print(f"Analysis artifacts found: {len(artifacts)}")
    aggregate = {field: 0 for field in field_names}
    for artifact_path in artifacts:
        artifact = read_json(artifact_path)
        analysis = artifact.get("analysis") or {}
        lengths = {field: text_length(analysis.get(field)) for field in field_names}
        for field, length in lengths.items():
            aggregate[field] += int(length > 0)
        nonempty = [field for field, length in lengths.items() if length > 0]
        print(f"{artifact_path.name}: non-empty fields = {', '.join(nonempty) if nonempty else '<none>'}")
    if artifacts:
        print("Papers with non-empty field:")
        for field, count in aggregate.items():
            print(f"  {field}: {count}/{len(artifacts)}")

    print_section("GRAPH OUTPUT")
    graph_edges = graph.get("edges") or []
    graph_nodes = graph.get("nodes") or []
    edge_types: dict[str, int] = {}
    for edge in graph_edges:
        if isinstance(edge, dict):
            edge_type = str(edge.get("type") or edge.get("label") or "<unknown>")
            edge_types[edge_type] = edge_types.get(edge_type, 0) + 1
    print(f"Graph nodes: {len(graph_nodes)}")
    print(f"Graph edges: {len(graph_edges)}")
    print(f"Graph edge types: {edge_types}")
    print(f"Inferred edges in relationships.json: {len(relationships.get('inferred_edges') or [])}")

    if args.test_openai:
        print_section("OPENAI AUTH CHECK (GET /v1/models; no chat completion)")
        if not api_key:
            print("Skipped: no key loaded by analyzer.config.")
        else:
            ok, message = check_openai(api_key)
            print(("PASS: " if ok else "FAIL: ") + message)

    if args.test_model:
        print_section("EMBEDDING MODEL SMOKE TEST")
        if not has_st:
            print("FAIL: sentence_transformers is not installed in this Python environment.")
        else:
            try:
                from relationships.semantic import semantic_similarity
                related = semantic_similarity(
                    "A retrieval augmented generation system retrieves external documents to reduce hallucinations in language models.",
                    "External knowledge retrieval can improve factual grounding and reduce unsupported answers from large language models.",
                )
                unrelated = semantic_similarity(
                    "A retrieval augmented generation system retrieves external documents to reduce hallucinations in language models.",
                    "A study of coastal erosion measures changes in shorelines after storms.",
                )
                print(f"Related-example similarity: {related:.4f}")
                print(f"Unrelated-example similarity: {unrelated:.4f}")
                if related <= unrelated:
                    print("WARNING: the sample scores do not separate these examples as expected; inspect model/configuration.")
                else:
                    print("PASS: embedding model loads and gives a higher score to the related example.")
            except Exception as exc:
                print(f"FAIL: {type(exc).__name__}: {exc}")

    print_section("NEXT DIAGNOSTIC INTERPRETATION")
    if extractor != "openai":
        print("1. Fix request/server mismatch first: the inspected run used rules, not OpenAI extraction.")
    if not api_key:
        print("2. Fix .env loading: backend process does not see OPENAI_API_KEY.")
    if not has_st:
        print("3. Install sentence-transformers into this exact Python environment.")
    if has_old_method or not has_semantic_scores:
        print("4. Restart the correct backend process and create a NEW project; old JSON is not recomputed automatically.")
    if relationships.get("semantic_error_count", 0):
        print("5. Resolve semantic_error entries; candidate generation never completed for those pairs.")
    elif relationships.get("candidate_relationship_count", 0) == 0 and has_semantic_scores:
        print("5. The semantic engine ran, but no dimension crossed its candidate threshold. Inspect scores and extraction coverage.")
    elif relationships.get("candidate_relationship_count", 0) > 0 and relationships.get("inferred_relationship_count", 0) == 0:
        print("5. Candidates existed but no edge survived verification. Inspect verification_errors and per-pair verification_status.")
    elif relationships.get("inferred_relationship_count", 0) > 0:
        print("5. Backend generated inferred edges. If the UI still shows zero, inspect frontend API mapping/rendering.")

    print("\nDiagnostic finished. The API key value was never printed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
