from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from knowledge_graph.builder import build_knowledge_graph
from relationships.analyzer import analyze_project


def write_paper(root: Path, paper_id: str, title: str, abstract: str, analysis: dict) -> None:
    path = root / "analysis" / "analyses" / f"{paper_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "paper": {
            "id": paper_id,
            "title": title,
            "abstract": abstract,
            "year": 2024,
        },
        "analysis": analysis,
    }, ensure_ascii=False, indent=2), encoding="utf-8")


class OfflineRelationshipAnalyzerTests(unittest.TestCase):
    def test_similar_conclusions_and_shared_gaps_create_edges(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_paper(
                root, "W1", "Graph neural networks for citation recommendation",
                "Citation recommendation using graph neural networks.",
                {
                    "research_objective": ["We develop a graph neural network for scholarly citation recommendation."],
                    "key_findings": ["The model improves citation recommendation precision and recall on scholarly datasets."],
                    "conclusion": "Our graph neural model improves precision and recall for academic citation recommendation.",
                    "methodology": ["We train graph neural network representations from citation graph nodes."],
                    "research_gaps": ["Future work should evaluate graph neural network models on multilingual scholarly citation datasets."],
                    "limitations": ["The current evaluation uses only English citation data."],
                    "future_work": ["Future research should test multilingual and low-resource scholarly collections."],
                    "evidence": [],
                },
            )
            write_paper(
                root, "W2", "Citation recommendation with graph representation learning",
                "A graph representation learning system for scholarly citation recommendation.",
                {
                    "research_objective": ["We design a graph learning approach for recommending scientific references."],
                    "key_findings": ["The approach increases precision and recall in scholarly reference recommendation."],
                    "conclusion": "Graph representation learning enhances precision and recall for scientific citation recommendation.",
                    "methodology": ["Our system learns graph neural network representations from citation network nodes."],
                    "research_gaps": ["The approach remains limited for multilingual scholarly citation datasets and low-resource collections."],
                    "limitations": ["Only English publications were considered in the experiments."],
                    "future_work": ["We plan to assess the system on multilingual scholarly collections."],
                    "evidence": [],
                },
            )

            result = analyze_project(root)
            types = {edge["type"] for edge in result["inferred_edges"]}

            self.assertEqual(result["analyzed_paper_count"], 2)
            self.assertEqual(result["pairwise_comparison_count"], 1)
            self.assertIn("similar_research_focus", types)
            self.assertIn("similar_methodology", types)
            self.assertIn("shared_research_gap", types)
            self.assertFalse(result["external_ai_required"])
            self.assertEqual(result["verification_call_count"], 0)
            self.assertEqual(result["semantic_error_count"], 0)

    def test_gap_addressing_edge_is_directional(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_paper(
                root, "GAP_OWNER", "Limitations in multilingual citation recommendation",
                "Citation recommendation in scholarly systems.",
                {
                    "research_gaps": ["Future work should evaluate graph neural network models on multilingual scholarly citation datasets and low-resource languages."],
                    "limitations": [], "future_work": [],
                    "conclusion": "The current experiments focus on English scholarly citations.",
                    "research_objective": [], "methodology": [], "datasets": [],
                    "key_findings": [], "evidence": [],
                },
            )
            write_paper(
                root, "POSSIBLE_RESPONSE", "Multilingual graph neural citation recommendation",
                "A multilingual scholarly citation recommendation model.",
                {
                    "research_gaps": [], "limitations": [], "future_work": [],
                    "conclusion": "Our graph neural network model is evaluated on multilingual scholarly citation datasets and supports low-resource languages.",
                    "research_objective": ["We build a multilingual graph neural citation recommendation system."],
                    "methodology": ["We train a graph neural network on multilingual scholarly citation datasets."],
                    "datasets": [], "key_findings": [], "evidence": [],
                },
            )

            result = analyze_project(root)
            gap_edges = [e for e in result["inferred_edges"] if e["type"] == "potentially_addresses_gap"]
            self.assertTrue(gap_edges, result["comparisons"])
            self.assertEqual(gap_edges[0]["source"], "GAP_OWNER")
            self.assertEqual(gap_edges[0]["target"], "POSSIBLE_RESPONSE")

    def test_explicit_opposite_conclusion_language_can_flag_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_paper(
                root, "POS", "Graph neural networks for citation ranking",
                "Graph neural networks for scholarly citation ranking.",
                {
                    "research_objective": ["We evaluate graph neural networks for citation ranking."],
                    "conclusion": "The graph neural network improves citation ranking accuracy and precision.",
                    "key_findings": ["The graph neural network improves citation ranking accuracy."],
                    "research_gaps": [], "limitations": [], "future_work": [],
                    "methodology": [], "datasets": [], "evidence": [],
                },
            )
            write_paper(
                root, "NEG", "Evaluation of graph neural networks for citation ranking",
                "Graph neural networks for scholarly citation ranking.",
                {
                    "research_objective": ["We evaluate graph neural networks for citation ranking."],
                    "conclusion": "The graph neural network did not improve citation ranking accuracy or precision.",
                    "key_findings": ["The graph neural network did not improve citation ranking accuracy."],
                    "research_gaps": [], "limitations": [], "future_work": [],
                    "methodology": [], "datasets": [], "evidence": [],
                },
            )

            result = analyze_project(root)
            types = {edge["type"] for edge in result["inferred_edges"]}
            self.assertIn("potentially_conflicting_findings", types)

    def test_one_paper_has_no_pairwise_comparisons(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_paper(
                root, "ONLY", "One paper", "An abstract with some research terms.",
                {"conclusion": "A conclusion about a useful result.", "evidence": []},
            )
            result = analyze_project(root)
            self.assertEqual(result["analyzed_paper_count"], 1)
            self.assertEqual(result["pairwise_comparison_count"], 0)
            self.assertEqual(result["inferred_relationship_count"], 0)

    def test_output_edges_are_accepted_by_existing_graph_builder(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paper_a = {"id": "A", "title": "Graph neural citation prediction", "abstract": "Graph neural models predict citations."}
            paper_b = {"id": "B", "title": "Graph learning for citation prediction", "abstract": "Graph learning models predict scholarly citations."}
            analysis_a = {
                "research_objective": ["We develop graph neural models for citation prediction."],
                "conclusion": "Graph neural models improve citation prediction accuracy.",
                "key_findings": ["The model improves citation prediction accuracy."],
                "research_gaps": ["Future work should evaluate graph models on multilingual citation datasets."],
                "limitations": [], "future_work": [], "methodology": ["Graph neural network training on citation graphs."],
                "datasets": [], "evidence": [],
            }
            analysis_b = {
                "research_objective": ["We develop graph learning models for scholarly citation prediction."],
                "conclusion": "Graph learning improves scholarly citation prediction accuracy.",
                "key_findings": ["The approach improves citation prediction accuracy."],
                "research_gaps": ["Evaluation on multilingual citation datasets is future work."],
                "limitations": [], "future_work": [], "methodology": ["Graph neural network training on citation graph data."],
                "datasets": [], "evidence": [],
            }
            write_paper(root, "A", paper_a["title"], paper_a["abstract"], analysis_a)
            write_paper(root, "B", paper_b["title"], paper_b["abstract"], analysis_b)
            relationships = analyze_project(root)
            discovery = {"input": "test", "papers": [paper_a, paper_b], "edges": []}
            analysis_summary = {"papers": [{"paper_id": "A", "status": "analyzed"}, {"paper_id": "B", "status": "analyzed"}]}
            graph = build_knowledge_graph(root, discovery, analysis_summary, relationships)

            inferred_graph_edges = [e for e in graph["edges"] if e.get("kind") == "inferred_research"]
            self.assertTrue(inferred_graph_edges)
            self.assertTrue(all(e["source"].startswith("paper:") for e in inferred_graph_edges))
            self.assertTrue(all(e["target"].startswith("paper:") for e in inferred_graph_edges))


    def test_focus_match_is_led_by_conclusions_not_matching_titles_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shared_title = "A Survey of Advanced Research Methods"
            write_paper(
                root, "TITLE_A", shared_title,
                "A survey of advanced research methods.",
                {
                    "conclusion": "The proposed cardiac intervention reduced hospitalization among older adults.",
                    "key_findings": ["Cardiac treatment reduced hospitalization in older patients."],
                    "research_objective": [], "research_gaps": [],
                    "limitations": [], "future_work": [], "methodology": [], "datasets": [],
                },
            )
            write_paper(
                root, "TITLE_B", shared_title,
                "A survey of advanced research methods.",
                {
                    "conclusion": "The proposed compiler optimization reduced memory usage in embedded processors.",
                    "key_findings": ["Compiler optimization reduced memory usage in embedded devices."],
                    "research_objective": [], "research_gaps": [],
                    "limitations": [], "future_work": [], "methodology": [], "datasets": [],
                },
            )
            result = analyze_project(root)
            focus_edges = [
                edge for edge in result["inferred_edges"]
                if edge["type"] == "similar_research_focus"
            ]
            self.assertEqual(focus_edges, [])

    def test_phrase_aliases_match_common_acronyms(self):
        from relationships.analyzer import _word_tokens

        self.assertEqual(
            _word_tokens("machine learning for prediction"),
            _word_tokens("ML for prediction"),
        )
        self.assertEqual(
            _word_tokens("graph neural networks"),
            _word_tokens("GNN"),
        )

    def test_focus_match_is_led_by_conclusions_not_matching_titles_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shared_title = "A Survey of Advanced Research Methods"
            write_paper(
                root, "TITLE_A", shared_title,
                "A survey of advanced research methods.",
                {
                    "conclusion": "The proposed cardiac intervention reduced hospitalization among older adults.",
                    "key_findings": ["Cardiac treatment reduced hospitalization in older patients."],
                    "research_objective": [], "research_gaps": [],
                    "limitations": [], "future_work": [], "methodology": [], "datasets": [],
                },
            )
            write_paper(
                root, "TITLE_B", shared_title,
                "A survey of advanced research methods.",
                {
                    "conclusion": "The proposed compiler optimization reduced memory usage in embedded processors.",
                    "key_findings": ["Compiler optimization reduced memory usage in embedded devices."],
                    "research_objective": [], "research_gaps": [],
                    "limitations": [], "future_work": [], "methodology": [], "datasets": [],
                },
            )
            result = analyze_project(root)
            focus_edges = [
                edge for edge in result["inferred_edges"]
                if edge["type"] == "similar_research_focus"
            ]
            self.assertEqual(focus_edges, [])

    def test_phrase_aliases_match_common_acronyms(self):
        from relationships.analyzer import _word_tokens

        self.assertEqual(
            _word_tokens("machine learning for prediction"),
            _word_tokens("ML for prediction"),
        )
        self.assertEqual(
            _word_tokens("graph neural networks"),
            _word_tokens("GNN"),
        )


if __name__ == "__main__":
    unittest.main()
