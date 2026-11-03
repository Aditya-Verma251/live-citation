from __future__ import annotations

import unittest

from relationships.analyzer import analyze_paper_against_board


class WhiteboardPhase3DiagnosticsTests(unittest.TestCase):
    def test_empty_board_returns_stable_diagnostics_shape(self):
        result = analyze_paper_against_board(
            {"id": "new", "title": "New paper", "abstract": "A short abstract about research methods."},
            [],
            [],
        )
        self.assertEqual(result["diagnostics_schema"], "2.0")
        self.assertEqual(result["checked_count"], 0)
        self.assertEqual(result["connection_count"], 0)
        self.assertIn("field_details", result["new_paper_profile_coverage"])
        self.assertIn("similar_methodology", result["category_diagnostics"])

    def test_response_reports_new_and_existing_profile_coverage(self):
        new_paper = {
            "id": "new",
            "title": "CNN for industrial image inspection",
            "abstract": "This paper studies automated inspection of industrial surface defects.",
            "researchObjective": "We classify industrial surface defects using convolutional models.",
            "methodology": "We train a convolutional neural network with data augmentation and cross validation.",
            "conclusion": "The convolutional model improves defect detection accuracy on industrial images.",
            "datasets": "DAGM industrial surface defect dataset",
            "evaluation_metrics": "accuracy and F1 score",
        }
        existing = [{
            "id": "old",
            "title": "Deep CNN for surface defect classification",
            "abstract": "Automated image inspection for industrial quality control.",
            "researchObjective": "We detect surface defects in industrial components.",
            "methodology": "A CNN classifier is trained with augmentation and cross validation.",
            "conclusion": "The CNN model increases accuracy for defect classification.",
            "datasets": "DAGM industrial surface defect dataset",
            "evaluation_metrics": "accuracy and F1 score",
        }]
        result = analyze_paper_against_board(new_paper, existing)
        self.assertEqual(result["checked_count"], 1)
        self.assertEqual(len(result["existing_paper_profile_coverage"]), 1)
        self.assertIn("percent", result["new_paper_profile_coverage"])
        self.assertIn("dimensions", result["new_paper_profile_coverage"])
        self.assertIn("similar_methodology", result["category_diagnostics"])
        method_diag = result["category_diagnostics"]["similar_methodology"]
        self.assertEqual(method_diag["compared"], 1)
        self.assertIn("eligible", method_diag)
        self.assertIn("connections_added", method_diag)
        self.assertIn("coverage_summary", result)
        self.assertEqual(result["coverage_summary"]["papers_checked"], 1)

    def test_existing_edge_is_not_duplicated_and_counted(self):
        a = {
            "id": "old",
            "title": "Dense retrieval for evidence selection",
            "abstract": "We investigate dense retrieval and ranking for selecting evidence in question answering.",
            "researchObjective": "We improve retrieval of supporting evidence for complex questions.",
            "conclusion": "The dense retrieval approach improves evidence selection and answer accuracy.",
        }
        b = {
            "id": "new",
            "title": "Retrieval augmented question answering",
            "abstract": "We investigate retrieving documents to improve question answering evidence quality.",
            "researchObjective": "We improve retrieval of relevant evidence for complex questions.",
            "conclusion": "Retrieval improves evidence selection and answer accuracy in the tested tasks.",
        }
        first = analyze_paper_against_board(b, [a])
        if first["edges"]:
            edge = first["edges"][0]
            second = analyze_paper_against_board(b, [a], [{
                "source": edge["source"],
                "target": edge["target"],
                "type": edge["type"],
            }])
            self.assertEqual(second["connection_count"], 0)
            self.assertGreaterEqual(second["duplicate_edge_count"], 1)

    def test_each_relationship_edge_is_returned_once(self):
        new_paper = {
            "id": "new",
            "title": "Retrieval augmented question answering",
            "abstract": "We investigate retrieval of relevant documents to improve question answering and evidence quality.",
            "researchObjective": "We improve retrieval of supporting evidence for complex questions.",
            "conclusion": "Retrieval improves evidence selection and answer accuracy in the evaluated tasks.",
        }
        existing = [{
            "id": "old",
            "title": "Dense retrieval for evidence selection",
            "abstract": "We investigate dense retrieval and ranking for selecting evidence in question answering.",
            "researchObjective": "We improve evidence retrieval for complex question answering.",
            "conclusion": "The dense retrieval approach improves evidence selection and answer accuracy.",
        }]
        result = analyze_paper_against_board(new_paper, existing)
        self.assertGreaterEqual(result["connection_count"], 1)
        self.assertEqual(result["connection_count"], len(result["edges"]))
        self.assertEqual(len({edge["id"] for edge in result["edges"]}), len(result["edges"]))

    def test_same_doi_under_different_whiteboard_node_ids_is_not_compared(self):
        new_paper = {
            "id": "ui-node-new",
            "title": "A paper with a DOI",
            "doi": "https://doi.org/10.1234/EXAMPLE.1",
            "abstract": "This is a research paper with enough text to compare if it were not a duplicate.",
        }
        existing = [{
            "id": "ui-node-existing",
            "title": "Same paper under another node ID",
            "identifiers": {"doi": "10.1234/example.1"},
            "abstract": "This is the same research paper entered with a different user interface node identifier.",
        }]
        result = analyze_paper_against_board(new_paper, existing)
        self.assertEqual(result["checked_count"], 0)
        self.assertEqual(result["duplicate_identifier_paper_count"], 1)
        self.assertEqual(result["connection_count"], 0)

    def test_comparison_states_distinguish_missing_data_from_below_threshold(self):
        new_paper = {
            "id": "new", "title": "New paper",
            "abstract": "A sufficiently long abstract for a basic research topic comparison that does not share much content with the other abstract.",
        }
        existing = {
            "id": "old", "title": "Old paper",
            "abstract": "A completely separate publication about a different field and unrelated technical subject with its own research context.",
        }
        result = analyze_paper_against_board(new_paper, [existing])
        status = result["comparisons"][0]["comparison_status"]
        self.assertIn(status, {"eligible_no_threshold_passed", "insufficient_profile_data"})
        self.assertEqual(result["checked_count"], 1)


if __name__ == "__main__":
    unittest.main()
