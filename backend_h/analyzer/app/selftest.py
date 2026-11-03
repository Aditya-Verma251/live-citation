"""Offline end-to-end smoke test using a local HTTP server and bundled PDF fixture."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .pipeline import run_pipeline


class _QuietPDFHandler(BaseHTTPRequestHandler):
    pdf_bytes: bytes = b""

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API name
        if self.path != "/sample.pdf":
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(len(self.pdf_bytes)))
        self.end_headers()
        self.wfile.write(self.pdf_bytes)

    def log_message(self, _format: str, *_args: Any) -> None:
        return


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    sample_pdf = root / "samples" / "sample_paper_for_parser_test.pdf"
    pdf_bytes = sample_pdf.read_bytes()

    handler = type("SamplePDFHandler", (_QuietPDFHandler,), {"pdf_bytes": pdf_bytes})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        sample_url = f"http://127.0.0.1:{server.server_port}/sample.pdf"
        output_dir = root / "output" / "selftest"
        discovery_path = output_dir / "sample_discovery.json"
        discovery_path.parent.mkdir(parents=True, exist_ok=True)
        discovery_path.write_text(
            json.dumps(
                {
                    "provider": "local-selftest-fixture",
                    "input": "synthetic RISC-V scheduling paper",
                    "papers": [
                        {
                            "id": "SAMPLE-PAPER-001",
                            "title": "A Small Test of Cache-Aware RISC-V Scheduling",
                            "year": 2025,
                            "doi": None,
                            "is_open_access": True,
                            "pdf_url": sample_url,
                        }
                    ],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        result = run_pipeline(
            discovery_path,
            max_papers=1,
            parser_backend="pymupdf",
            extractor="rules",
            out_dir=output_dir / "results",
            pdf_dir=output_dir / "pdfs",
        )

        item = result["papers"][0]
        if item["status"] != "analyzed":
            raise RuntimeError(f"Expected an analyzed paper, got {item['status']}: {item.get('error') or item.get('retrieval')}")
        analysis_path = Path(item["analysis_path"])
        parsed_path = Path(item["parsed_path"])
        artifact = json.loads(analysis_path.read_text(encoding="utf-8"))
        analysis = artifact["analysis"]
        assert result["analyzed_count"] == 1
        assert item["retrieval"]["status"] == "downloaded"
        assert analysis["methodology"], "Expected methodology sentences from the sample paper"
        assert analysis["key_findings"], "Expected key findings from the sample paper"
        assert analysis["conclusion"], "Expected an explicit conclusion from the sample paper"
        assert analysis["research_gaps"], "Expected candidate gaps from explicit limitations/future-work text"
        assert analysis["evidence"], "Expected extracted evidence snippets"
        assert parsed_path.exists()

        print("SELF-TEST PASSED")
        print("PDF retrieval : downloaded from local test server (no external internet)")
        print(f"Parser        : {item['parser']}")
        print(f"Pages         : {item['page_count']}")
        print(f"Evidence      : {len(analysis['evidence'])} snippets")
        print(f"Parsed JSON   : {parsed_path}")
        print(f"Analysis JSON : {analysis_path}")
        print(f"Summary JSON  : {result['summary_path']}")
        return 0
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())
