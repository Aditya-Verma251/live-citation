from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pymupdf

from analyzer.extractor import RuleBasedExtractor
from analyzer.parsers import _heading_base, _is_styled_heading, _section_number, parse_pdf, parse_tei_xml
from analyzer.pipeline import analyze_local_pdf, run_pipeline
from analyzer.research_profile import build_research_profile, summarize_profile_collection
from analyzer.storage import read_json


def make_test_pdf(path: Path) -> Path:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    y = 55

    def heading(text: str) -> None:
        nonlocal y
        page.insert_text((50, y), text, fontname="hebo", fontsize=15)
        y += 25

    def paragraph(text: str, height: float = 55) -> None:
        nonlocal y
        page.insert_textbox(
            pymupdf.Rect(50, y, 545, y + height),
            text,
            fontname="helv",
            fontsize=10,
            lineheight=1.25,
        )
        y += height + 10

    heading("1 Introduction")
    paragraph(
        "This study investigates the challenge of retrieving relevant evidence from large document collections. "
        "Our objective is to improve multi-hop information retrieval for complex questions."
    )
    heading("2 Methodology")
    paragraph(
        "We employ a dense passage retrieval model and a two-stage reranking architecture. "
        "The experiments use the Natural Questions dataset and TriviaQA corpus. "
        "We evaluate performance using accuracy, recall, and F1 score."
    )
    heading("3 Results")
    paragraph(
        "The results show that the proposed method improves retrieval recall over the baseline. "
        "Our findings indicate that reranking improves evidence selection for multi-hop questions."
    )
    heading("4 Discussion")
    paragraph(
        "However, multi-hop evidence aggregation remains underexplored in low-resource domains. "
        "The system also does not address conflicting evidence across documents."
    )
    heading("5 Conclusion")
    paragraph(
        "Overall, the two-stage retrieval approach improves evidence retrieval on the evaluated datasets. "
        "These findings suggest that reranking is useful for complex information needs."
    )
    heading("6 Limitations")
    paragraph(
        "This study is limited to English-language datasets and does not evaluate multilingual retrieval."
    )
    heading("7 Future Work")
    paragraph(
        "Future work should investigate multilingual retrieval and evidence aggregation across languages."
    )
    heading("References")
    paragraph("A. Author. Example reference. 2024.")
    document.save(path)
    document.close()
    return path


class ParserProfilePhase1Tests(unittest.TestCase):
    def test_parser_detects_styled_sections_and_stops_before_references(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = make_test_pdf(Path(tmp) / "profile-test.pdf")
            parsed = parse_pdf(path, backend="pymupdf")

        headings = [section["heading"] for section in parsed["sections"]]
        self.assertTrue(any("Methodology" in heading for heading in headings), headings)
        self.assertTrue(any("Conclusion" in heading for heading in headings), headings)
        self.assertFalse(any("References" in heading for heading in headings), headings)
        self.assertGreater(parsed["document_quality"]["text_characters"], 500)
        self.assertTrue(all("page_start" in section and "page_end" in section for section in parsed["sections"]))

    def test_parser_rejects_numbered_prose_and_accepts_real_numbered_heading(self):
        body_line = {
            "text": "12 years of age. Eleven percent of respondents completed the survey.",
            "font_size": 12.0,
            "bold": False,
            "bold_ratio": 0.0,
            "block_line_count": 1,
            "line_height": 13.0,
            "gap_before": 14.0,
        }
        heading_line = {
            "text": "3.1 Methods and Research Design",
            "font_size": 10.0,
            "bold": False,
            "bold_ratio": 0.0,
            "block_line_count": 1,
            "line_height": 11.0,
            "gap_before": 6.0,
        }
        self.assertFalse(_is_styled_heading(body_line, 10.0))
        self.assertTrue(_is_styled_heading(heading_line, 10.0))
        self.assertEqual(_section_number("3.1. Methods"), "3.1")
        self.assertEqual(_heading_base("3.1. Methods"), "Methods")
        # Roman numerals require punctuation so a technical acronym is not
        # mistaken for a numbered heading.
        self.assertIsNone(_section_number("CRT-Db/-P"))

    def test_parser_skips_table_of_contents_and_resumes_at_body(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "toc-test.pdf"
            document = pymupdf.open()
            page = document.new_page(width=595, height=842)
            page.insert_text((60, 70), "Table of contents", fontname="hebo", fontsize=18)
            page.insert_text((60, 120), "1. Preamble ................................................ 2", fontname="helv", fontsize=10)
            page.insert_text((60, 145), "2. Introduction ........................................... 3", fontname="helv", fontsize=10)
            page2 = document.new_page(width=595, height=842)
            page2.insert_text((60, 80), "1. Preamble", fontname="hebo", fontsize=18)
            page2.insert_textbox(
                pymupdf.Rect(60, 120, 530, 240),
                "Guidelines summarize the evidence and help professionals make informed decisions about individual cases.",
                fontname="helv", fontsize=11,
            )
            page2.insert_text((60, 280), "2. Introduction", fontname="hebo", fontsize=18)
            page2.insert_textbox(
                pymupdf.Rect(60, 320, 530, 450),
                "This update reviews new evidence and explains the main changes to clinical recommendations.",
                fontname="helv", fontsize=11,
            )
            document.save(path)
            document.close()
            parsed = parse_pdf(path, backend="pymupdf")
        headings = [section["heading"] for section in parsed["sections"]]
        self.assertIn("1. Preamble", headings)
        self.assertIn("2. Introduction", headings)
        self.assertFalse(any("Table of contents" in heading for heading in headings))
        self.assertFalse(any("...." in section["text"] for section in parsed["sections"]))

    def test_multilingual_section_headings_are_classified(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "indonesian-test.pdf"
            document = pymupdf.open()
            page = document.new_page(width=595, height=842)
            content = [
                ("Abstrak", "Studi ini menginvestigasi tantangan dalam pencarian informasi dan mengusulkan metode untuk meningkatkan hasil."),
                ("1. Pendahuluan", "Penelitian ini bertujuan untuk memahami tantangan utama dalam pengambilan informasi."),
                ("2. Metode Penelitian", "Penelitian ini menggunakan metode eksperimen dan dataset benchmark untuk mengevaluasi kinerja."),
                ("3. Hasil dan Pembahasan", "Hasil menunjukkan bahwa metode yang diusulkan meningkatkan akurasi pada dataset yang diuji."),
                ("4. Kesimpulan", "Secara keseluruhan, hasil penelitian menunjukkan peningkatan akurasi dan kualitas pengambilan informasi."),
                ("Daftar Rujukan", "Penulis. Referensi contoh. 2024."),
            ]
            y = 55
            for heading, paragraph in content:
                page.insert_text((55, y), heading, fontname="hebo", fontsize=13)
                y += 24
                page.insert_textbox(pymupdf.Rect(55, y, 535, y + 58), paragraph, fontname="helv", fontsize=10)
                y += 75
            document.save(path)
            document.close()
            parsed = parse_pdf(path, backend="pymupdf")
            result = RuleBasedExtractor().extract({"id": "ID"}, parsed)
        self.assertTrue(parsed["abstract"])
        self.assertTrue(result["research_objective"])
        self.assertTrue(result["methodology"])
        self.assertTrue(result["key_findings"])
        self.assertTrue(result["conclusion"])
        self.assertTrue(parsed["document_quality"]["stopped_before_references"])

    def test_summary_section_can_supply_context_without_becoming_conclusion(self):
        parsed = {
            "parser": "pymupdf",
            "abstract": "",
            "sections": [
                {"heading": "Summary", "text": "This study investigates a research challenge and aims to improve information retrieval for complex questions.", "page_start": 1, "page_end": 1},
            ],
            "full_text": "This study investigates a research challenge and aims to improve information retrieval for complex questions.",
        }
        result = RuleBasedExtractor().extract({"id": "P_SUMMARY"}, parsed)
        self.assertEqual(result["extraction_metadata"]["abstract_source"], "pdf_summary")
        self.assertTrue(result["research_objective"])
        self.assertEqual(result["conclusion_source"], "missing")

    def test_labelled_results_fallback_preserves_evidence(self):
        parsed = {
            "parser": "pymupdf",
            "abstract": "",
            "sections": [
                {"heading": "Results", "text": "The test set contained 180 instances and the median score reached 0.83 on the held-out benchmark.", "page_start": 4, "page_end": 4},
            ],
            "full_text": "The test set contained 180 instances and the median score reached 0.83 on the held-out benchmark.",
        }
        result = RuleBasedExtractor().extract({"id": "P_RESULTS"}, parsed)
        self.assertTrue(result["key_findings"])
        finding_evidence = [item for item in result["evidence"] if item["field"] == "key_findings"]
        self.assertTrue(finding_evidence)
        self.assertEqual(finding_evidence[0]["page_start"], 4)

    def test_tei_parser_tracks_page_breaks_and_hierarchy(self):
        tei = b'''<?xml version="1.0" encoding="UTF-8"?>
        <TEI xmlns="http://www.tei-c.org/ns/1.0">
          <teiHeader><fileDesc><titleStmt><title>Profile Test</title></titleStmt></fileDesc></teiHeader>
          <text><front><div type="abstract"><head>Abstract</head><p>We study a research challenge and report a useful result for a retrieval task.</p></div></front>
          <body><pb n="1"/><div><head>1 Introduction</head>
            <p>This introduction describes a research problem and the main objective of the study.</p>
            <div><head>1.1 Motivation</head><p>This subsection explains why the research problem matters to practitioners.</p></div>
          </div><pb n="2"/><div><head>2 Methods</head><p>We use a reproducible retrieval method on a benchmark dataset.</p></div></body></text>
        </TEI>'''
        parsed = parse_tei_xml(tei)
        self.assertEqual(parsed["title"], "Profile Test")
        self.assertEqual(parsed["page_count"], 2)
        self.assertTrue(any(section.get("heading_level") == 2 for section in parsed["sections"]))
        self.assertEqual(parsed["document_quality"]["section_count"], len(parsed["sections"]))

    def test_extractor_populates_independent_profile_fields_with_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = make_test_pdf(Path(tmp) / "profile-test.pdf")
            parsed = parse_pdf(path, backend="pymupdf")

        result = RuleBasedExtractor().extract(
            {"id": "P1", "title": "Multi-hop information retrieval"},
            parsed,
        )
        self.assertTrue(result["research_objective"])
        self.assertTrue(result["methodology"])
        self.assertTrue(result["method_concepts"] or result["methodology"])
        self.assertTrue(result["datasets"])
        self.assertTrue(result["evaluation_metrics"])
        self.assertTrue(result["key_findings"])
        self.assertTrue(result["conclusion"])
        self.assertTrue(result["limitations"])
        self.assertTrue(result["future_work"])
        self.assertTrue(result["research_gaps"])
        self.assertIn("research_profile", result)
        self.assertTrue(result["evidence"])
        for field in ("methodology", "datasets", "key_findings", "conclusion", "limitations", "future_work"):
            self.assertTrue(
                any(item.get("field") == field and item.get("quote") for item in result["evidence"]),
                field,
            )

    def test_abstract_is_not_misrepresented_as_a_formal_conclusion(self):
        parsed = {
            "parser": "pymupdf",
            "abstract": "This study proposes a new retrieval method and reports better results on a benchmark task.",
            "sections": [
                {"heading": "Introduction", "text": "This work investigates an important retrieval challenge and aims to address it."},
                {"heading": "Methodology", "text": "We use a retrieval model and evaluate it on a benchmark dataset."},
            ],
            "full_text": "Short test document.",
            "document_quality": {"text_characters": 20, "section_count": 2},
        }
        result = RuleBasedExtractor().extract({"id": "P2"}, parsed)
        self.assertEqual(result["conclusion"], "")
        self.assertEqual(result["conclusion_source"], "missing")
        self.assertEqual(result["research_profile"]["fields"]["conclusion"]["status"], "missing")

    def test_discussion_conclusion_signals_are_labeled_as_fallback(self):
        parsed = {
            "parser": "pymupdf",
            "abstract": "",
            "sections": [
                {"heading": "Discussion", "text": "Overall, the results indicate that the retrieval method improves evidence selection across the benchmark tasks."},
            ],
            "full_text": "Overall, the results indicate that the retrieval method improves evidence selection across the benchmark tasks.",
        }
        result = RuleBasedExtractor().extract({"id": "P3"}, parsed)
        self.assertTrue(result["conclusion"])
        self.assertEqual(result["conclusion_source"], "discussion_fallback")
        self.assertEqual(result["research_profile"]["fields"]["conclusion"]["status"], "partial")

    def test_missing_fields_are_reported_as_missing_not_fabricated(self):
        profile = build_research_profile(
            {
                "research_objective": ["We investigate retrieval quality for long documents."],
                "evidence": [{
                    "field": "research_objective",
                    "quote": "We investigate retrieval quality for long documents.",
                    "section": "Introduction",
                    "source": "pdf_section",
                }],
            },
            {"parser": "pymupdf", "sections": [], "full_text": ""},
        )
        self.assertEqual(profile["fields"]["methodology"]["status"], "missing")
        self.assertEqual(profile["fields"]["research_gaps"]["status"], "missing")
        self.assertEqual(profile["dimensions"]["methodology"]["ready"], False)
        self.assertEqual(profile["dimensions"]["research_gaps"]["ready"], False)

    def test_profile_collection_summary_reports_field_and_dimension_coverage(self):
        one = build_research_profile(
            {
                "conclusion": "The findings indicate that the proposed approach improved retrieval accuracy.",
                "evidence": [{"field": "conclusion", "quote": "The findings indicate that the proposed approach improved retrieval accuracy.", "section": "Conclusion", "source": "pdf_section"}],
            },
            {"parser": "pymupdf", "sections": [], "full_text": "sample"},
        )
        summary = summarize_profile_collection([one])
        self.assertEqual(summary["profiled_paper_count"], 1)
        self.assertIn("methodology", summary["field_coverage"])
        self.assertIn("research_gaps", summary["dimension_readiness"])

    def test_local_pipeline_persists_profile_in_artifact_and_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf = make_test_pdf(root / "local-paper.pdf")
            result = analyze_local_pdf(
                pdf,
                paper={"id": "P_LOCAL", "title": "Local test paper"},
                out_dir=root / "analysis",
                parser_backend="pymupdf",
                extractor="rules",
            )
            saved = read_json(Path(result["analysis_path"]))
            self.assertIn("research_profile", saved["analysis"])
            self.assertIn("completeness", saved["analysis"]["research_profile"])
            self.assertIn("research_profile_completeness", saved)

    def test_batch_pipeline_adds_profile_coverage_to_analysis_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf = make_test_pdf(root / "batch-paper.pdf")
            discovery_path = root / "discovery.json"
            discovery_path.write_text(json.dumps({
                "provider": "test",
                "input": "test",
                "papers": [{"id": "P_BATCH", "title": "Batch profile paper"}],
            }), encoding="utf-8")
            fake_retrieval = {
                "status": "downloaded",
                "pdf_path": str(pdf),
                "bytes": pdf.stat().st_size,
                "source": "test fixture",
                "message": "test PDF",
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
            self.assertIn("research_profile_summary", result)
            paper_item = result["papers"][0]
            self.assertIn("research_profile_completeness", paper_item)
            self.assertIn("comparison_readiness", paper_item)


class ApiProfileResponseTests(unittest.TestCase):
    def test_project_papers_endpoint_exposes_profile_for_whiteboard(self):
        import api

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "sample-project"
            (project / "analysis" / "analyses").mkdir(parents=True)
            (project / "analysis").mkdir(exist_ok=True)
            (project / "discovery.json").write_text(json.dumps({
                "papers": [{"id": "P_API", "title": "API profile paper", "abstract": "A sample abstract."}]
            }), encoding="utf-8")
            profile = build_research_profile(
                {
                    "research_objective": ["We investigate a sample retrieval problem using a documented benchmark."],
                    "evidence": [{
                        "field": "research_objective",
                        "quote": "We investigate a sample retrieval problem using a documented benchmark.",
                        "section": "Introduction",
                        "source": "pdf_section",
                    }],
                },
                {"parser": "pymupdf", "sections": [], "full_text": "sample"},
            )
            artifact = {
                "paper": {"id": "P_API", "title": "API profile paper"},
                "analysis": {"research_objective": ["We investigate a sample retrieval problem using a documented benchmark."], "research_profile": profile},
                "research_profile_completeness": summarize_profile_collection([profile]),
            }
            (project / "analysis" / "analyses" / "P_API.json").write_text(json.dumps(artifact), encoding="utf-8")
            (project / "analysis" / "analysis_summary.json").write_text(json.dumps({
                "papers": [{"paper_id": "P_API", "status": "analyzed", "research_profile_completeness": {
                    "percent": 8, "quality_band": "sparse", "dimensions": {"research_focus": {"ready": True}}
                }, "comparison_readiness": {"research_focus": True}}]
            }), encoding="utf-8")

            previous_output_dir = api.OUTPUT_DIR
            api.OUTPUT_DIR = root
            try:
                result = api.get_papers("sample-project")
            finally:
                api.OUTPUT_DIR = previous_output_dir

            paper = result["papers"][0]
            self.assertIn("analysis", paper)
            self.assertIn("research_profile", paper)
            self.assertEqual(paper["research_profile"]["schema_version"], "1.0")
            self.assertTrue(paper["comparison_readiness"]["research_focus"])

    def test_summary_view_includes_profile_collection_summary(self):
        import api

        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "sample-project"
            project.mkdir()
            summary = {
                "query": "profile test",
                "analysis": {
                    "processed_count": 1,
                    "analyzed_count": 1,
                    "research_profile_summary": {"profiled_paper_count": 1, "average_completeness_percent": 55.0},
                },
            }
            (project / "research_summary.json").write_text(json.dumps(summary), encoding="utf-8")
            result = api._summary_view(project)
            self.assertEqual(result["analysis"]["research_profile_summary"]["profiled_paper_count"], 1)


class ProfileRebuildTests(unittest.TestCase):
    def test_rebuild_profiles_uses_saved_parse_and_creates_backup(self):
        from rebuild_research_profiles import rebuild_project

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            parsed_dir = root / "analysis" / "parsed"
            analyses_dir = root / "analysis" / "analyses"
            parsed_dir.mkdir(parents=True)
            analyses_dir.mkdir(parents=True)
            pdf = make_test_pdf(Path(tmp) / "source.pdf")
            parsed = parse_pdf(pdf, backend="pymupdf")
            (parsed_dir / "P_REBUILD.json").write_text(json.dumps(parsed), encoding="utf-8")
            artifact = {
                "paper": {"id": "P_REBUILD", "title": "Profile rebuild test"},
                "parsed_document_path": str(parsed_dir / "P_REBUILD.json"),
                "analysis": {"extractor": "old"},
            }
            (analyses_dir / "P_REBUILD.json").write_text(json.dumps(artifact), encoding="utf-8")
            (root / "discovery.json").write_text(json.dumps({"papers": []}), encoding="utf-8")
            (root / "analysis" / "analysis_summary.json").write_text(json.dumps({
                "papers": [{"paper_id": "P_REBUILD", "status": "analyzed"}]
            }), encoding="utf-8")
            (root / "research_summary.json").write_text(json.dumps({"analysis": {}}), encoding="utf-8")

            dry = rebuild_project(root, dry_run=True)
            self.assertEqual(dry["updated_artifacts"], 1)
            self.assertFalse((root / ".phase1_profile_backups").exists())

            rebuilt = rebuild_project(root, dry_run=False)
            self.assertEqual(rebuilt["updated_artifacts"], 1)
            saved = json.loads((analyses_dir / "P_REBUILD.json").read_text(encoding="utf-8"))
            self.assertIn("research_profile", saved["analysis"])
            self.assertTrue(Path(rebuilt["backup_directory"]).is_dir())
            project_summary = json.loads((root / "research_summary.json").read_text(encoding="utf-8"))
            self.assertIn("research_profile_summary", project_summary["analysis"])


if __name__ == "__main__":
    unittest.main()
