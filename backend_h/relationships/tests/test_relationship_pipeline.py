from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from relationships.analyzer import analyze_project


def _write_paper(root: Path, paper_id: str, title: str, conclusion: str, objective: str) -> None:
    path = root / "analysis" / "analyses" / f"{paper_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "paper": {
            "id": paper_id,
            "title": title,
            "abstract": "Research on graph neural networks and scholarly citation prediction.",
            "year": 2024,
        },
        "analysis": {
            "research_problem": "Accurate scholarly citation prediction is challenging.",
            "research_objective": [objective],
            "methodology": ["We train graph neural network representations on citation networks."],
            "datasets": ["Open scholarly citation dataset"],
            "key_findings": [conclusion],
            "conclusion": conclusion,
            "research_gaps": ["Future work should evaluate multilingual scholarly citation prediction."],
            "limitations": ["Evaluation is currently limited to English scholarly documents."],
            "future_work": ["Future studies should test multilingual citation collections."],
            "evidence": [],
        },
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class OfflineRelationshipPipelineTests(unittest.TestCase):
    def test_relationship_pipeline_runs_without_openai_verifier(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _write_paper(
                root, "W123456789", "Graph neural networks for citation prediction",
                "Graph neural networks improve scholarly citation prediction accuracy.",
                "We develop graph neural network models for citation prediction.",
            )
            _write_paper(
                root, "W987654321", "Graph learning for scholarly citation ranking",
                "Graph learning improves citation ranking accuracy for scholarly records.",
                "We design graph learning models for scholarly citation ranking.",
            )

            result = analyze_project(root)

            self.assertEqual(result["analyzed_paper_count"], 2)
            self.assertEqual(result["pairwise_comparison_count"], 1)
            self.assertFalse(result["external_ai_required"])
            self.assertEqual(result["verification_call_count"], 0)
            self.assertEqual(result["verification_error_count"], 0)
            self.assertIn("category_statistics", result)
            self.assertTrue((root / "relationships" / "relationships.json").is_file())

    def test_single_analysis_has_no_pairwise_identifier_comparison(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _write_paper(
                root, "W123456789", "One paper",
                "A conclusion about a single research result.",
                "We examine one research problem.",
            )
            result = analyze_project(root)
            self.assertEqual(result["analyzed_paper_count"], 1)
            self.assertEqual(result["pairwise_comparison_count"], 0)
            self.assertEqual(result["inferred_relationship_count"], 0)


if __name__ == "__main__":
    unittest.main()
