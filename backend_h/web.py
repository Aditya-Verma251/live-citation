"""Local read-only dashboard for research projects (MVP 5)."""
from __future__ import annotations

import argparse
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from typing import Any

from analyzer.storage import read_json


class DashboardHandler(BaseHTTPRequestHandler):
    output_root: Path
    static_root: Path

    def _send(self, status: int, payload: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def _json(self, status: int, value: Any) -> None:
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self._send(status, payload, "application/json; charset=utf-8")

    def _read_optional(self, path: Path, default: Any) -> Any:
        try:
            return read_json(path)
        except (FileNotFoundError, ValueError, OSError):
            return default

    def _project_dirs(self) -> list[Path]:
        if not self.output_root.exists():
            return []
        return sorted(
            [path for path in self.output_root.iterdir() if path.is_dir() and (path / "discovery.json").exists()],
            key=lambda path: path.name,
            reverse=True,
        )

    def _get_projects(self) -> None:
        projects = []
        for directory in self._project_dirs():
            summary = self._read_optional(directory / "research_summary.json", {})
            analysis = summary.get("analysis") or self._read_optional(directory / "analysis" / "analysis_summary.json", {})
            relationships = summary.get("relationships") or {}
            projects.append({
                "id": directory.name,
                "query": summary.get("query") or (self._read_optional(directory / "discovery.json", {}).get("input")) or directory.name,
                "created_at": summary.get("created_at") or directory.name,
                "paper_count": (summary.get("discovery") or {}).get("paper_count"),
                "analyzed_count": analysis.get("analyzed_count", 0),
                "skipped_count": analysis.get("skipped_count", 0),
                "relationship_count": relationships.get("inferred_relationship_count", 0),
            })
        self._json(200, {"projects": projects, "output_root": str(self.output_root)})

    def _get_project(self, project_id: str) -> None:
        # Only allow a direct child directory name under the configured output root.
        if not project_id or project_id in {".", ".."} or "/" in project_id or "\\" in project_id:
            self._json(400, {"error": "Invalid project identifier."})
            return
        directory = (self.output_root / project_id).resolve()
        if directory.parent != self.output_root.resolve() or not directory.is_dir():
            self._json(404, {"error": "Project not found."})
            return
        discovery = self._read_optional(directory / "discovery.json", {})
        summary = self._read_optional(directory / "research_summary.json", {})
        analysis_summary = self._read_optional(directory / "analysis" / "analysis_summary.json", {})
        relationships = self._read_optional(directory / "relationships" / "relationships.json", {})
        graph = self._read_optional(directory / "knowledge_graph" / "graph.json", {})

        analyses: dict[str, Any] = {}
        analyses_dir = directory / "analysis" / "analyses"
        if analyses_dir.exists():
            for path in sorted(analyses_dir.glob("*.json")):
                artifact = self._read_optional(path, None)
                if not isinstance(artifact, dict):
                    continue
                paper = artifact.get("paper") or {}
                paper_id = str(paper.get("id") or path.stem)
                analyses[paper_id] = {
                    "paper": paper,
                    "analysis": artifact.get("analysis") or {},
                    "pdf_path": artifact.get("pdf_path"),
                    "parser": artifact.get("parser"),
                }

        self._json(200, {
            "project_id": project_id,
            "project_dir": str(directory),
            "research_summary": summary,
            "discovery": discovery,
            "analysis_summary": analysis_summary,
            "relationships": relationships,
            "graph": graph,
            "analyses": analyses,
        })

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler interface
        parsed = urlparse(self.path)
        if parsed.path == "/api/projects":
            self._get_projects()
            return
        if parsed.path.startswith("/api/project/"):
            project_id = unquote(parsed.path[len("/api/project/"):])
            self._get_project(project_id)
            return

        relative = "index.html" if parsed.path in {"", "/"} else parsed.path.lstrip("/")
        candidate = (self.static_root / relative).resolve()
        if candidate.parent != self.static_root.resolve() and self.static_root.resolve() not in candidate.parents:
            self._json(403, {"error": "Forbidden."})
            return
        if not candidate.is_file():
            self._json(404, {"error": "Not found."})
            return
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in {"application/javascript", "application/json"}:
            content_type += "; charset=utf-8"
        self._send(200, candidate.read_bytes(), content_type)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[dashboard] {self.address_string()} - {fmt % args}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the local research-project dashboard.")
    parser.add_argument("--output-root", default="output", help="Folder containing timestamped project folders.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address; use 127.0.0.1 for local-only access.")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    DashboardHandler.output_root = Path(args.output_root).resolve()
    DashboardHandler.static_root = Path(__file__).resolve().parent / "static"
    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"Research dashboard: http://{args.host}:{args.port}")
    print(f"Reading projects from: {DashboardHandler.output_root}")
    print("Press Ctrl+C to stop. This server is read-only and intended for local use.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDashboard stopped.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
