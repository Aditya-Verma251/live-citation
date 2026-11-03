from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from analyzer.downloader import get_pdf_candidates
from analyzer.extractor import RuleBasedExtractor
from analyzer.parsers import parse_pdf, parse_tei_xml
from analyzer.pipeline import analyze_local_pdf, run_pipeline
from analyzer.storage import read_json, write_json

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_PDF = ROOT / "samples" / "sample_paper_for_parser_test.pdf"


class ParserTests(unittest.TestCase):
    def test_pymupdf_extracts_sections_from_sample_pdf(self):
        parsed = parse_pdf(SAMPLE_PDF, backend="pymupdf")
        self.assertEqual(parsed["parser"], "pymupdf")
        self.assertGreaterEqual(parsed["page_count"], 1)
        headings = [section["heading"] for section in parsed["sections"]]
        self.assertTrue(any("Methodology" in heading for heading in headings))
        self.assertTrue(any("Future Work" in heading for heading in headings))
        self.assertIn("cache-aware", parsed["full_text"].lower())

    def test_tei_parser_extracts_header_abstract_and_body(self):
        tei = b'''<?xml version="1.0" encoding="UTF-8"?>
        <TEI xmlns="http://www.tei-c.org/ns/1.0">
          <teiHeader><fileDesc><titleStmt><title>Example TEI Paper</title></titleStmt></fileDesc></teiHeader>
          <text><front><div type="abstract"><head>Abstract</head><p>We study a test problem and report one useful result for parsing.</p></div></front>
          <body><div><head>1 Introduction</head><p>This introduction describes a research challenge and an objective for this example paper.</p></div>
          <div><head>2 Methods</head><p>We evaluate a generated dataset using a simple reproducible method.</p></div></body></text>
        </TEI>'''
        parsed = parse_tei_xml(tei)
        self.assertEqual(parsed["parser"], "grobid")
        self.assertEqual(parsed["title"], "Example TEI Paper")
        self.assertTrue(parsed["abstract"])
        self.assertEqual(len(parsed["sections"]), 2)


class ExtractionTests(unittest.TestCase):
    def test_rule_extractor_does_not_label_abstract_as_conclusion(self):
        parsed = {
            "abstract": "This paper studies a sample problem and reports a measurable improvement in the evaluation.",
            "sections": [
                {"heading": "Introduction", "text": "This work investigates a challenging problem and presents a new approach."},
                {"heading": "Methods", "text": "We implement a method and evaluate it on a generated dataset."},
            ],
            "full_text": "Abstract and sections only.",
        }
        result = RuleBasedExtractor().extract({"id": "ABSTRACT-ONLY"}, parsed)
        self.assertEqual(result["conclusion"], "")


    def test_rule_extractor_finds_explicit_gaps_inside_conclusion(self):
        parsed = {
            "abstract": "A study of citation recommendation and graph learning.",
            "sections": [
                {
                    "heading": "Conclusion",
                    "text": (
                        "Our graph learning approach improves citation ranking accuracy. "
                        "However, multilingual citation datasets remain underexplored, "
                        "and future work should evaluate the approach on low-resource languages."
                    ),
                    "page_start": 7,
                    "page_end": 7,
                }
            ],
            "full_text": "Conclusion text.",
        }
        result = RuleBasedExtractor().extract({"id": "GAP-TEST"}, parsed)
        self.assertTrue(result["research_gaps"])
        self.assertTrue(any("underexplored" in item.lower() for item in result["research_gaps"]))
        self.assertTrue(any(
            item.get("field") == "research_gaps" and "underexplored" in item.get("quote", "").lower()
            for item in result["evidence"]
        ))

    def test_rule_extractor_returns_expected_fields_and_evidence(self):
        parsed = parse_pdf(SAMPLE_PDF, backend="pymupdf")
        paper = {"id": "SAMPLE-001", "title": "Synthetic paper", "year": 2025}
        result = RuleBasedExtractor().extract(paper, parsed)
        self.assertTrue(result["methodology"])
        self.assertTrue(result["datasets"])
        self.assertTrue(result["key_findings"])
        self.assertTrue(result["conclusion"])
        self.assertTrue(result["limitations"])
        self.assertTrue(result["future_work"])
        self.assertTrue(result["research_gaps"])
        self.assertTrue(result["evidence"])
        self.assertTrue(all(item.get("quote") for item in result["evidence"]))

    def test_batch_pipeline_saves_parsed_analysis_and_summary(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            discovery_path = root / "discovery.json"
            discovery_path.write_text(json.dumps({
                "provider": "OpenAlex",
                "input": "test topic",
                "papers": [{"id": "W-PIPELINE-TEST", "title": "Synthetic Pipeline Paper", "year": 2025}],
            }), encoding="utf-8")

            fake_retrieval = {
                "status": "downloaded",
                "pdf_path": str(SAMPLE_PDF),
                "bytes": SAMPLE_PDF.stat().st_size,
                "source": "test fixture",
                "message": "Bundled test PDF supplied by the test harness.",
            }
            with patch("analyzer.pipeline.download_pdf", return_value=fake_retrieval):
                result = run_pipeline(
                    discovery_path,
                    max_papers=1,
                    parser_backend="pymupdf",
                    extractor="rules",
                    out_dir=root / "result",
                    pdf_dir=root / "pdfs",
                )

            self.assertEqual(result["analyzed_count"], 1)
            self.assertEqual(result["failed_count"], 0)
            self.assertTrue((root / "result" / "parsed" / "W-PIPELINE-TEST.json").exists())
            self.assertTrue((root / "result" / "analyses" / "W-PIPELINE-TEST.json").exists())
            saved_summary = json.loads((root / "result" / "analysis_summary.json").read_text(encoding="utf-8"))
            self.assertEqual(saved_summary["analyzed_count"], 1)
            self.assertIn("summary_path", saved_summary)

    def test_local_pipeline_saves_json_artifacts(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            result = analyze_local_pdf(
                SAMPLE_PDF,
                paper={"id": "SAMPLE-PIPELINE", "title": "Synthetic Paper"},
                out_dir=temporary_dir,
                parser_backend="pymupdf",
                extractor="rules",
            )
            analysis_path = Path(result["analysis_path"])
            parsed_path = Path(result["parsed_path"])
            self.assertTrue(analysis_path.exists())
            self.assertTrue(parsed_path.exists())
            saved = read_json(analysis_path)
            self.assertEqual(saved["analysis"]["extractor"], "rules")


class DownloadPolicyTests(unittest.TestCase):
    def test_missing_email_explains_unpaywall_was_not_queried(self):
        paper = {"id": "W1", "doi": "10.1234/example", "is_open_access": False}
        with patch("analyzer.downloader.config.UNPAYWALL_EMAIL", ""):
            candidates, reason = get_pdf_candidates(paper)
        self.assertEqual(candidates, [])
        self.assertIn("Unpaywall was not queried", reason)
        self.assertIn("create a .env", reason)

    def test_closed_openalex_record_still_queries_unpaywall(self):
        paper = {"id": "W2", "doi": "10.1234/example", "is_open_access": False}
        fake_response = {
            "is_oa": True,
            "best_oa_location": {
                "url_for_pdf": "https://repo.example.org/best.pdf",
                "license": "cc-by",
                "version": "acceptedVersion",
                "host_type": "repository",
            },
            "oa_locations": [],
        }
        with patch("analyzer.downloader.config.UNPAYWALL_EMAIL", "tester@example.org"), \
             patch("analyzer.downloader._get_json", return_value=fake_response) as request:
            candidates, reason = get_pdf_candidates(paper)
        request.assert_called_once()
        self.assertIsNone(reason)
        self.assertEqual(candidates[0]["url"], "https://repo.example.org/best.pdf")
        self.assertEqual(candidates[0]["source"], "Unpaywall best_oa_location")

    def test_uses_other_unpaywall_location_when_best_has_no_pdf(self):
        paper = {"id": "W3", "doi": "10.1234/example", "is_open_access": False}
        fake_response = {
            "is_oa": True,
            "best_oa_location": {"url_for_pdf": None, "url_for_landing_page": "https://publisher.example.org/page"},
            "oa_locations": [
                {"url_for_pdf": "https://repo.example.org/accepted.pdf", "license": "cc-by-nc", "version": "acceptedVersion", "host_type": "repository"}
            ],
        }
        with patch("analyzer.downloader.config.UNPAYWALL_EMAIL", "tester@example.org"), \
             patch("analyzer.downloader._get_json", return_value=fake_response):
            candidates, reason = get_pdf_candidates(paper)
        self.assertIsNone(reason)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["url"], "https://repo.example.org/accepted.pdf")
        self.assertEqual(candidates[0]["source"], "Unpaywall oa_locations")

    def test_unpaywall_no_oa_copy_is_reported_distinctly(self):
        paper = {"id": "W4", "doi": "10.1234/example", "is_open_access": False}
        with patch("analyzer.downloader.config.UNPAYWALL_EMAIL", "tester@example.org"), \
             patch("analyzer.downloader._get_json", return_value={"is_oa": False, "oa_status": "closed"}):
            candidates, reason = get_pdf_candidates(paper)
        self.assertEqual(candidates, [])
        self.assertIn("Unpaywall was queried", reason)
        self.assertIn("oa_status=closed", reason)

    def test_uses_openalex_best_oa_pdf_url(self):
        paper = {
            "id": "W5",
            "pdf_url": "https://example.org/paper.pdf",
            "is_open_access": True,
        }
        with patch("analyzer.downloader.config.UNPAYWALL_EMAIL", ""):
            candidates, reason = get_pdf_candidates(paper)
        self.assertIsNone(reason)
        self.assertEqual(candidates[0]["source"], "OpenAlex best_oa_location")


class StorageTests(unittest.TestCase):
    def test_json_round_trip(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            path = Path(temporary_dir) / "nested" / "result.json"
            write_json(path, {"papers": [{"id": "W1"}]})
            self.assertEqual(read_json(path), {"papers": [{"id": "W1"}]})


if __name__ == "__main__":
    unittest.main()
