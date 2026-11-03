from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from relationships.analyzer import analyze_project, analyze_paper_against_board
from relationships.taxonomy import extract_concepts


def write_paper(root: Path, paper_id: str, title: str, abstract: str, analysis: dict) -> None:
    path = root / "analysis" / "analyses" / f"{paper_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "paper": {"id": paper_id, "title": title, "abstract": abstract},
        "analysis": analysis,
    }, ensure_ascii=False), encoding="utf-8")


class IndependentRelationshipCategoryTests(unittest.TestCase):
    def test_methodology_is_independent_from_research_focus(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_paper(root, "A", "Cardiac risk prediction", "Predicting cardiac risk in clinical practice.", {
                "research_objective": ["We investigate cardiac risk in older adults."],
                "conclusion": "The intervention reduced hospital readmission among older adults.",
                "methodology": ["We train a convolutional neural network and support vector machine classifier."],
                "research_gaps": [], "limitations": [], "future_work": [],
            })
            write_paper(root, "B", "Image quality classification", "Classifying defects in industrial images.", {
                "research_objective": ["We identify surface defects in manufactured components."],
                "conclusion": "The inspection system detected manufacturing defects under different lighting conditions.",
                "methodology": ["We evaluate a CNN and SVM classifier for image quality classification."],
                "research_gaps": [], "limitations": [], "future_work": [],
            })
            result = analyze_project(root)
            decisions = result["comparisons"][0]["category_decisions"]
            types = {edge["type"] for edge in result["inferred_edges"]}
            self.assertIn("similar_methodology", types, decisions)
            self.assertNotIn("similar_research_focus", types, decisions)
            self.assertTrue(decisions["similar_methodology"]["passed"])
            self.assertFalse(decisions["similar_research_focus"]["passed"])

    def test_shared_dataset_alone_does_not_create_methodology_edge(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_paper(root, "A", "Clinical prediction", "Clinical prediction study.", {
                "research_objective": ["We predict patient outcomes after surgery."],
                "conclusion": "The prediction score was associated with patient outcomes.",
                "methodology": ["We conduct a prospective cohort study with multivariable survival analysis."],
                "datasets": ["MIMIC-IV dataset"],
            })
            write_paper(root, "B", "Image classification", "Image classification study.", {
                "research_objective": ["We classify medical images for diagnostic support."],
                "conclusion": "The image classifier distinguished the diagnostic categories.",
                "methodology": ["We train a convolutional neural network with data augmentation."],
                "datasets": ["MIMIC-IV dataset"],
            })
            result = analyze_project(root)
            decisions = result["comparisons"][0]["category_decisions"]
            self.assertFalse(decisions["similar_methodology"]["passed"], decisions)
            self.assertNotIn("similar_methodology", {edge["type"] for edge in result["inferred_edges"]})

    def test_shared_gap_compares_only_explicit_gap_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_paper(root, "A", "Cardiac monitoring", "Cardiac monitoring abstract.", {
                "research_objective": ["We study cardiac monitoring in intensive care units."],
                "conclusion": "The monitoring device improved alert detection in clinical wards.",
                "research_gaps": ["Current systems cannot reliably combine evidence from multiple clinical records."],
            })
            write_paper(root, "B", "Wireless sensor security", "Wireless sensor security abstract.", {
                "research_objective": ["We investigate authentication for low-power wireless sensors."],
                "conclusion": "The protocol reduced unauthorized access in sensor networks.",
                "limitations": ["Combining evidence across multiple clinical records remains unresolved in deployed systems."],
            })
            result = analyze_project(root)
            decisions = result["comparisons"][0]["category_decisions"]
            types = {edge["type"] for edge in result["inferred_edges"]}
            self.assertIn("shared_research_gap", types, decisions)
            self.assertNotIn("similar_research_focus", types, decisions)

    def test_missing_gap_field_is_reported_as_ineligible_not_zero_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_paper(root, "A", "Paper A", "A sufficiently long abstract about language retrieval and evidence selection.", {
                "conclusion": "The retrieval method improved evidence selection for complex questions.",
                "research_gaps": ["Current methods cannot reliably combine evidence from multiple documents."],
            })
            write_paper(root, "B", "Paper B", "A sufficiently long abstract about language retrieval and evidence selection.", {
                "conclusion": "The evidence selection approach improved question answering quality.",
            })
            result = analyze_project(root)
            decision = result["comparisons"][0]["category_decisions"]["shared_research_gap"]
            self.assertFalse(decision["eligible"])
            self.assertIn("missing", decision["reasons"][0].lower())

    def test_directional_gap_edge_requires_target_contribution(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_paper(root, "GAP", "Evidence aggregation gap", "Research on document retrieval.", {
                "research_gaps": ["Existing retrieval systems fail to combine evidence distributed across several documents for multi-hop questions."],
                "limitations": [], "future_work": [],
            })
            write_paper(root, "RESP", "Multi-hop retrieval system", "A system for document retrieval.", {
                "research_objective": ["We develop a multi-hop retrieval system to combine evidence across several documents."],
                "methodology": ["We introduce a document aggregation and reranking pipeline for multi-hop retrieval."],
                "contributions": ["We propose a method that combines distributed evidence from multiple documents."],
                "conclusion": ["The proposed pipeline combines evidence across documents for complex questions."],
            })
            result = analyze_project(root)
            edges = [edge for edge in result["inferred_edges"] if edge["type"] == "potentially_addresses_gap"]
            self.assertTrue(edges, result["comparisons"])
            self.assertEqual(edges[0]["source"], "GAP")
            self.assertEqual(edges[0]["target"], "RESP")

    def test_same_metric_with_opposing_directions_can_flag_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_paper(root, "UP", "Classifier performance", "Classification accuracy evaluation.", {
                "conclusion": "The classifier increased accuracy and improved precision on the benchmark.",
                "key_findings": ["Accuracy increased after model optimization."],
            })
            write_paper(root, "DOWN", "Classifier performance", "Classification accuracy evaluation.", {
                "conclusion": "The classifier decreased accuracy and reduced precision on the benchmark.",
                "key_findings": ["Accuracy decreased after model optimization."],
            })
            result = analyze_project(root)
            types = {edge["type"] for edge in result["inferred_edges"]}
            self.assertIn("potentially_conflicting_findings", types, result["comparisons"])
            decision = result["comparisons"][0]["category_decisions"]["potentially_conflicting_findings"]
            self.assertTrue(decision["conflicting_metrics"])

    def test_same_topic_but_different_metrics_does_not_flag_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_paper(root, "A", "Model evaluation", "Model performance evaluation.", {
                "conclusion": "The model improved accuracy on the test dataset.",
                "key_findings": ["Accuracy increased after training."],
            })
            write_paper(root, "B", "Model evaluation", "Model performance evaluation.", {
                "conclusion": "The model increased latency during inference.",
                "key_findings": ["Inference latency increased after model expansion."],
            })
            result = analyze_project(root)
            decision = result["comparisons"][0]["category_decisions"]["potentially_conflicting_findings"]
            self.assertFalse(decision["passed"], decision)

    def test_phase1_nested_research_profile_fields_are_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            profile_a = {
                "fields": {
                    "research_objective": {"value": ["We investigate graph neural networks for citation recommendation."], "status": "available"},
                    "conclusion": {"value": ["Graph neural networks improve citation recommendation precision."], "status": "available"},
                    "methodology": {"value": ["We train a graph neural network on citation graphs."], "status": "available"},
                }
            }
            profile_b = {
                "fields": {
                    "research_objective": {"value": ["We develop graph neural networks for scholarly reference recommendation."], "status": "available"},
                    "conclusion": {"value": ["Graph neural networks improve scholarly citation ranking precision."], "status": "available"},
                    "methodology": {"value": ["We train a GNN on a scholarly citation network."], "status": "available"},
                }
            }
            write_paper(root, "A", "Paper A", "Graph research abstract.", {"research_profile": profile_a})
            write_paper(root, "B", "Paper B", "Graph research abstract.", {"research_profile": profile_b})
            result = analyze_project(root)
            self.assertGreaterEqual(result["field_coverage"]["methods"], 2)
            self.assertIn("similar_methodology", {edge["type"] for edge in result["inferred_edges"]})

    def test_common_method_abbreviations_are_canonicalized(self):
        left = extract_concepts("CNN, SVM and dense passage retrieval", "method")
        right = extract_concepts("convolutional neural network, support vector machine and dense retrieval", "method")
        self.assertEqual(left, right)

    def test_comparison_contains_pass_fail_reason_for_each_category(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_paper(root, "A", "Paper A", "Abstract about multi-document question answering.", {
                "research_objective": ["We improve multi-document question answering."],
                "conclusion": "The retrieval approach improves answer accuracy.",
                "methodology": ["We use dense retrieval and reranking."],
                "research_gaps": ["Future research should improve multi-hop evidence aggregation."],
            })
            write_paper(root, "B", "Paper B", "Abstract about multi-document question answering.", {
                "research_objective": ["We evaluate multi-document question answering."],
                "conclusion": "The retrieval approach improves answer accuracy.",
                "methodology": ["We use dense passage retrieval and reranking."],
                "research_gaps": ["Multi-hop evidence aggregation remains an unresolved problem."],
            })
            result = analyze_project(root)
            decisions = result["comparisons"][0]["category_decisions"]
            expected = {
                "similar_research_focus", "similar_methodology", "shared_research_gap",
                "potentially_addresses_gap_a_to_b", "potentially_addresses_gap_b_to_a",
                "potentially_conflicting_findings",
            }
            self.assertTrue(expected.issubset(decisions.keys()))
            self.assertTrue(all({"eligible", "passed", "score", "threshold", "reasons"}.issubset(value) for value in decisions.values()))
            self.assertIn("category_statistics", result)

    def test_whiteboard_prefers_profile_conclusion_over_key_insights_fallback(self):
        new_paper = {
            "id": "NEW",
            "title": "A new paper",
            "keyFindings": ["A broad key insight about the topic."],
            "research_profile": {"fields": {
                "conclusion": {
                    "value": ["The proposed graph neural network improves ranking accuracy."],
                    "status": "available",
                },
                "methodology": {
                    "value": ["We train a graph neural network."],
                    "status": "available",
                },
            }},
        }
        existing = [{
            "id": "OLD",
            "title": "An existing paper",
            "research_profile": {"fields": {
                "conclusion": {
                    "value": ["The graph neural network improves ranking precision."],
                    "status": "available",
                },
                "methodology": {
                    "value": ["We train a GNN for ranking."],
                    "status": "available",
                },
            }},
        }]
        result = analyze_paper_against_board(new_paper, existing)
        comparison = result["comparisons"][0]
        self.assertGreater(
            comparison["scores"]["categories"]["similar_research_focus"]["score"],
            0,
        )

    def test_whiteboard_nested_profile_is_preserved(self):
        new_paper = {
            "id": "NEW",
            "title": "A new paper",
            "research_profile": {"fields": {
                "methodology": {"value": ["We use a graph neural network."], "status": "available"},
                "conclusion": {"value": ["The graph neural network improves ranking accuracy."], "status": "available"},
            }},
        }
        existing = [{
            "id": "OLD",
            "title": "An existing paper",
            "research_profile": {"fields": {
                "methodology": {"value": ["We use a GNN for ranking."], "status": "available"},
                "conclusion": {"value": ["The GNN improves ranking accuracy."], "status": "available"},
            }},
        }]
        result = analyze_paper_against_board(new_paper, existing)
        self.assertEqual(result["checked_count"], 1)
        self.assertTrue(result["new_paper_profile_coverage"]["methods"])
        self.assertIn("category_diagnostics", result)


if __name__ == "__main__":
    unittest.main()
