import json
import tempfile
import unittest
import threading
from pathlib import Path
from urllib.request import urlopen
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from analyzer.storage import write_json
from analyzer.pipeline import run_pipeline
from relationships.analyzer import analyze_project
from knowledge_graph.builder import build_knowledge_graph
from web import DashboardHandler


class RelationshipAnalyzerTests(unittest.TestCase):
    def _make_project(self, root: Path, count: int = 2):
        (root / "analysis" / "analyses").mkdir(parents=True)
        all_papers = [
            {"id": "W100", "title": "RISC-V Matrix Accelerator", "year": 2022, "abstract": "RISC-V matrix acceleration and energy efficiency."},
            {"id": "W200", "title": "Efficient RISC-V Matrix Processing", "year": 2024, "abstract": "Matrix processing and power efficiency on RISC-V."},
        ]
        papers = all_papers[:count]
        discovery = {
            "input": "RISC-V matrix accelerator",
            "papers": papers,
            "edges": [{"source": "W200", "target": "W100", "type": "cites"}],
        }
        write_json(root / "discovery.json", discovery)
        artifact_data = [
            {
                "paper": all_papers[0],
                "analysis": {
                    "research_problem": ["RISC-V matrix multiplication has high energy cost."],
                    "research_objective": ["We evaluate a RISC-V matrix accelerator."],
                    "methodology": ["RTL simulation using Verilator and FPGA prototyping."],
                    "datasets": ["Matrix multiplication workloads and benchmark traces."],
                    "key_findings": ["The accelerator improves matrix multiplication throughput."],
                    "conclusion": "The RISC-V accelerator improves throughput for matrix workloads.",
                    "limitations": ["Further work should investigate power efficiency for large matrix multiplication workloads."],
                    "future_work": [],
                    "research_gaps": ["Further work should investigate power efficiency for large matrix multiplication workloads."],
                    "evidence": [
                        {"field": "methodology", "quote": "RTL simulation using Verilator and FPGA prototyping were performed for matrix workloads.", "section": "Methods", "page_start": 3, "page_end": 4},
                        {"field": "research_gaps", "quote": "Further work should investigate power efficiency for large matrix multiplication workloads.", "section": "Limitations", "page_start": 8, "page_end": 8},
                    ],
                },
            },
            {
                "paper": all_papers[1],
                "analysis": {
                    "research_problem": ["RISC-V matrix processing requires better power efficiency."],
                    "research_objective": ["We investigate power efficient matrix processing on RISC-V."],
                    "methodology": ["RTL simulation using Verilator and FPGA prototyping."],
                    "datasets": ["Matrix multiplication workloads and benchmark traces."],
                    "key_findings": ["The design improves matrix processing throughput and power efficiency."],
                    "conclusion": "The RISC-V design improves power efficiency for matrix workloads.",
                    "limitations": [],
                    "future_work": [],
                    "research_gaps": [],
                    "evidence": [
                        {"field": "methodology", "quote": "RTL simulation using Verilator and FPGA prototyping were performed for matrix workloads.", "section": "Methods", "page_start": 2, "page_end": 3},
                        {"field": "key_findings", "quote": "The design improves matrix processing throughput and power efficiency.", "section": "Results", "page_start": 7, "page_end": 7},
                    ],
                },
            },
        ]
        for item in artifact_data[:count]:
            paper_id = item["paper"]["id"]
            write_json(root / "analysis" / "analyses" / f"{paper_id}.json", item)
        return discovery

    def test_pairwise_relationships_include_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            discovery = self._make_project(root, 2)
            result = analyze_project(root, discovery)
            self.assertEqual(result["analyzed_paper_count"], 2)
            self.assertEqual(result["pairwise_comparison_count"], 1)
            relation_types = {edge["type"] for edge in result["inferred_edges"]}
            self.assertIn("similar_methodology", relation_types)
            self.assertTrue(all(edge["requires_human_review"] for edge in result["inferred_edges"]))
            self.assertTrue((root / "relationships" / "relationships.json").exists())

    def test_single_paper_still_extracts_gap_but_no_pairwise_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            discovery = self._make_project(root, 1)
            result = analyze_project(root, discovery)
            self.assertEqual(result["analyzed_paper_count"], 1)
            self.assertEqual(result["pairwise_comparison_count"], 0)
            self.assertGreaterEqual(len(result["gaps"]), 1)
            self.assertEqual(result["inferred_edges"], [])




    def test_retrieval_failures_are_counted_separately_from_skips(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "discovery.json"
            write_json(source, {
                "input": "status accounting",
                "papers": [
                    {"id": "W403", "title": "Forbidden PDF candidate", "doi": "10.1000/403"},
                    {"id": "WNA", "title": "No OA PDF", "doi": "10.1000/closed"},
                ],
            })
            with patch("analyzer.pipeline.download_pdf", side_effect=[
                {"status": "failed", "message": "HTTP Error 403: Forbidden"},
                {"status": "skipped", "message": "No open-access PDF candidate."},
            ]):
                summary = run_pipeline(source, max_papers=2, out_dir=root / "analysis", pdf_dir=root / "pdfs")
            self.assertEqual(summary["failed_count"], 1)
            self.assertEqual(summary["skipped_count"], 1)
            self.assertEqual([item["status"] for item in summary["papers"]], ["failed", "skipped"])

    def test_full_coordinator_generates_relationships_and_graph(self):
        from app import run_research_pipeline

        fake_discovery = {
            "input": "RISC-V test",
            "input_mode": "keyword",
            "paper_count": 1,
            "edge_count": 0,
            "seed_paper_ids": ["W900"],
            "papers": [{"id": "W900", "title": "RISC-V test paper", "year": 2024, "doi": "10.1234/test", "is_open_access": True, "pdf_url": "https://example.org/test.pdf", "abstract": "RISC-V accelerator research."}],
            "edges": [],
        }

        class FakeDiscovery:
            def discover(self, *args, **kwargs):
                return fake_discovery

        def fake_run_pipeline(discovery_json, **kwargs):
            analysis_root = Path(kwargs["out_dir"])
            analysis_root.mkdir(parents=True, exist_ok=True)
            artifact = {
                "paper": fake_discovery["papers"][0],
                "analysis": {
                    "research_problem": ["RISC-V accelerator latency remains a challenge."],
                    "research_objective": ["We evaluate RISC-V accelerator design."],
                    "methodology": ["FPGA prototyping and RTL simulation."],
                    "datasets": [],
                    "key_findings": ["The design improves accelerator latency."],
                    "conclusion": "The design improves accelerator latency.",
                    "limitations": ["Future work should study thermal limits of accelerator hardware."],
                    "future_work": [],
                    "research_gaps": ["Future work should study thermal limits of accelerator hardware."],
                    "evidence": [{"field": "research_gaps", "quote": "Future work should study thermal limits of accelerator hardware.", "section": "Future Work", "page_start": 5, "page_end": 5}],
                },
            }
            write_json(analysis_root / "analyses" / "W900.json", artifact)
            return {
                "analyzed_count": 1,
                "skipped_count": 0,
                "failed_count": 0,
                "papers": [{"paper_id": "W900", "status": "analyzed"}],
            }

        with tempfile.TemporaryDirectory() as tmp:
            with patch("app.PaperDiscovery", return_value=FakeDiscovery()), patch("app.run_pipeline", side_effect=fake_run_pipeline):
                result = run_research_pipeline("RISC-V test", output_root=tmp, analyze_limit=1)
            project = Path(result["project_dir"])
            self.assertTrue((project / "relationships" / "relationships.json").exists())
            self.assertTrue((project / "knowledge_graph" / "graph.json").exists())
            self.assertEqual(result["relationships"]["analyzed_paper_count"], 1)
            self.assertEqual(result["knowledge_graph"]["paper_nodes"], 1)
            self.assertTrue((project / "research_summary.json").exists())

    def test_dashboard_api_lists_and_loads_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "demo_project"
            project.mkdir()
            write_json(project / "discovery.json", {"input": "demo", "papers": [], "edges": []})
            write_json(project / "research_summary.json", {"query": "demo", "analysis": {"analyzed_count": 0}})
            DashboardHandler.output_root = root
            DashboardHandler.static_root = root / "static"
            (root / "static").mkdir()
            (root / "static" / "index.html").write_text("dashboard", encoding="utf-8")
            server = ThreadingHTTPServer(("127.0.0.1", 0), DashboardHandler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base = f"http://127.0.0.1:{server.server_address[1]}"
                projects = json.loads(urlopen(base + "/api/projects", timeout=3).read())
                self.assertEqual(projects["projects"][0]["id"], "demo_project")
                details = json.loads(urlopen(base + "/api/project/demo_project", timeout=3).read())
                self.assertEqual(details["discovery"]["input"], "demo")
                html = urlopen(base + "/", timeout=3).read().decode()
                self.assertEqual(html, "dashboard")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)

    def test_graph_keeps_citations_and_adds_gap_nodes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            discovery = self._make_project(root, 2)
            relationships = analyze_project(root, discovery)
            summary = {
                "analyzed_count": 2,
                "papers": [
                    {"paper_id": "W100", "status": "analyzed"},
                    {"paper_id": "W200", "status": "analyzed"},
                ],
            }
            graph = build_knowledge_graph(root, discovery, summary, relationships)
            self.assertEqual(graph["summary"]["paper_nodes"], 2)
            self.assertGreaterEqual(graph["summary"]["gap_nodes"], 1)
            kinds = {edge["kind"] for edge in graph["edges"]}
            self.assertIn("bibliographic", kinds)
            self.assertIn("extracted_evidence", kinds)
            self.assertTrue((root / "knowledge_graph" / "graph.json").exists())


if __name__ == "__main__":
    unittest.main()
