"""Offline regression tests for paper identifier resolution and discovery."""
from __future__ import annotations

import io
import unittest
from unittest.mock import patch

from discovery.clients import ArxivClient, OpenAlexClient
from discovery.discovery import PaperDiscovery, normalize_paper, paper_key, reconstruct_abstract
from discovery.identifiers import (
    normalize_arxiv_id,
    normalize_doi_input,
    normalize_openalex_id,
    normalize_pmid,
    parse_research_input,
    title_match_score,
)


def work(work_id, title, year=2024, doi=None, refs=None, related=None, cited_by=4):
    return {
        "id": f"https://openalex.org/{work_id}",
        "doi": f"https://doi.org/{doi}" if doi else None,
        "title": title,
        "publication_year": year,
        "publication_date": f"{year}-01-01",
        "type": "article",
        "cited_by_count": cited_by,
        "authorships": [{"author": {"display_name": "Test Author"}}],
        "primary_location": {"landing_page_url": f"https://example.org/{work_id}", "source": {"display_name": "Test Journal"}},
        "best_oa_location": {"pdf_url": f"https://example.org/{work_id}.pdf"},
        "open_access": {"is_oa": True},
        "referenced_works": [f"https://openalex.org/{x}" for x in (refs or [])],
        "related_works": [f"https://openalex.org/{x}" for x in (related or [])],
        "abstract_inverted_index": {"A": [0], "small": [1], "abstract.": [2]},
    }


class FakeArxivClient:
    def __init__(self, record=None):
        self.record = record
        self.looked_up = []

    def lookup_arxiv(self, arxiv_id):
        self.looked_up.append(arxiv_id)
        return dict(self.record) if self.record else None


class FakeOpenAlexClient:
    def __init__(self):
        self.seed = work("W1", "RISC-V Processor Design", refs=["W2"], related=["W3"])
        self.reference = work("W2", "An Earlier Processor Design", year=2020)
        self.related = work("W3", "Related Instruction Set Study", year=2022)
        self.citing = work("W4", "A Later Evaluation of RISC-V", year=2025)
        self.search_results = [self.seed]
        self.doi_results = [work("W1", "RISC-V Processor Design", doi="10.1000/test")]
        self.pmid_results = [work("W5", "PubMed matched paper", doi="10.1000/pmid")]
        self.openalex_result = work("W123456789", "OpenAlex identifier paper", doi="10.1000/openalex")
        self.lookups = []

    def search_works(self, query, per_page=5):
        self.lookups.append(("search", query, per_page))
        return list(self.search_results)

    def lookup_doi(self, doi):
        self.lookups.append(("doi", doi))
        return list(self.doi_results)

    def lookup_pmid(self, pmid):
        self.lookups.append(("pmid", pmid))
        return list(self.pmid_results)

    def get_work_by_id(self, work_id):
        self.lookups.append(("openalex", work_id))
        return self.openalex_result if work_id == "W123456789" else None

    def get_works_by_ids(self, work_ids):
        all_works = {"W2": self.reference, "W3": self.related}
        return [all_works[x.rstrip("/").split("/")[-1]] for x in work_ids if x.rstrip("/").split("/")[-1] in all_works]

    def get_citing_works(self, work_id, per_page=5):
        return [self.citing]


class IdentifierParsingTests(unittest.TestCase):
    def test_doi_plain_prefix_and_resolver_url(self):
        self.assertEqual(normalize_doi_input("doi:10.1000/ABC."), "10.1000/ABC")
        self.assertEqual(normalize_doi_input("https://doi.org/10.1000/abc"), "10.1000/abc")
        parsed = parse_research_input("https://dx.doi.org/10.1000/abc")
        self.assertEqual((parsed.kind, parsed.value), ("doi", "10.1000/abc"))

    def test_arxiv_new_and_legacy_ids(self):
        self.assertEqual(normalize_arxiv_id("arXiv:2301.12345v2"), "2301.12345v2")
        self.assertEqual(normalize_arxiv_id("hep-th/9901001"), "hep-th/9901001")
        self.assertEqual(parse_research_input("https://arxiv.org/abs/2301.12345v2").kind, "arxiv")
        self.assertEqual(parse_research_input("https://arxiv.org/pdf/hep-th/9901001.pdf").value, "hep-th/9901001")

    def test_openalex_short_and_url(self):
        self.assertEqual(normalize_openalex_id("w123456789"), "W123456789")
        self.assertEqual(normalize_openalex_id("https://openalex.org/works/W123456789"), "W123456789")
        self.assertEqual(normalize_openalex_id("https://api.openalex.org/works/W123456789"), "W123456789")
        self.assertEqual(parse_research_input("openalex:W123456789").value, "W123456789")
        self.assertEqual(parse_research_input("https://openalex.org/W123456789").kind, "openalex")

    def test_pubmed_prefix_and_url(self):
        self.assertEqual(normalize_pmid("PMID: 12345678"), "12345678")
        parsed = parse_research_input("https://pubmed.ncbi.nlm.nih.gov/12345678/")
        self.assertEqual((parsed.kind, parsed.value), ("pmid", "12345678"))

    def test_generic_unrecognized_url_is_not_sent_as_keyword(self):
        with self.assertRaisesRegex(ValueError, "not a recognized"):
            parse_research_input("https://publisher.example.com/article/12345")

    def test_title_match_score_rewards_exact_title(self):
        self.assertEqual(title_match_score("Attention Is All You Need", "Attention Is All You Need"), 1.0)
        self.assertGreater(title_match_score("Attention Is All You Need", "Attention is all you need."), 0.95)


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeOpenAlexClient()

    def test_keyword_discovers_seeds_and_graph_neighbours(self):
        result = PaperDiscovery(self.client).discover(
            "RISC-V", mode="keyword", seed_limit=1, per_neighborhood=1, max_papers=10
        )
        self.assertEqual(result["paper_count"], 4)
        self.assertEqual(result["edge_count"], 3)
        self.assertEqual({edge["type"] for edge in result["edges"]}, {"cites", "related_to"})
        self.assertEqual(result["input_mode"], "keyword")

    def test_doi_auto_detection_and_canonical_identifier(self):
        result = PaperDiscovery(self.client).discover(
            "https://doi.org/10.1000/test", mode="title", per_neighborhood=0, max_papers=1
        )
        self.assertEqual(result["input_mode"], "doi")
        self.assertEqual(result["paper_count"], 1)
        self.assertEqual(result["input_resolution"]["status"], "resolved")
        self.assertEqual(result["papers"][0]["identifier_type"], "doi")
        self.assertEqual(result["papers"][0]["identifier_value"], "10.1000/test")

    def test_paper_title_mode_selects_title_match_not_keyword_seed_limit(self):
        exact = work("W9", "Attention Is All You Need", year=2017)
        unrelated = work("W10", "An Attention Study in Medical Imaging", year=2020)
        self.client.search_results = [unrelated, exact]
        result = PaperDiscovery(self.client).discover(
            "Attention Is All You Need", mode="title", seed_limit=2, per_neighborhood=0, max_papers=5
        )
        self.assertEqual(result["paper_count"], 1)
        self.assertEqual(result["papers"][0]["id"], "W9")
        self.assertEqual(result["input_resolution"]["match_score"], 1.0)
        self.assertEqual(result["input_resolution"]["resolved_paper"]["title"], "Attention Is All You Need")

    def test_title_mode_rejects_ambiguous_near_duplicate_candidates(self):
        self.client.search_results = [
            work("W123456701", "A Study of Retrieval Augmented Generation for Question Answering"),
            work("W123456702", "A Study of Retrieval-Augmented Generation in Question Answering"),
        ]
        with self.assertRaisesRegex(ValueError, "multiple similarly matching papers"):
            PaperDiscovery(self.client).discover(
                "Study Retrieval Augmented Generation Question Answering",
                mode="title",
            )

    def test_title_mode_does_not_silently_select_unrelated_top_result(self):
        self.client.search_results = [work("W9", "Unrelated Biomedical Imaging Paper")]
        with self.assertRaisesRegex(ValueError, "Could not uniquely identify"):
            PaperDiscovery(self.client).discover("Attention Is All You Need", mode="title")

    def test_title_mode_rejects_duplicate_exact_titles_with_different_ids(self):
        self.client.search_results = [
            work("W123456701", "A Paper With a Duplicate Title"),
            work("W123456702", "A Paper With a Duplicate Title"),
        ]
        with self.assertRaisesRegex(ValueError, "multiple similarly matching papers"):
            PaperDiscovery(self.client).discover("A Paper With a Duplicate Title", mode="title")

    def test_explicit_keyword_mode_does_not_parse_a_url_as_a_paper_reference(self):
        query = "https://example.org/research about retrieval"
        self.client.search_results = [self.client.seed]
        result = PaperDiscovery(self.client).discover(
            query, mode="keyword", seed_limit=1, per_neighborhood=0
        )
        self.assertEqual(result["input_mode"], "keyword")
        self.assertEqual(self.client.lookups[0], ("search", query, 1))

    def test_openalex_id_resolves_single_work(self):
        result = PaperDiscovery(self.client).discover("https://openalex.org/W123456789", mode="title", per_neighborhood=0)
        self.assertEqual(result["input_mode"], "openalex")
        self.assertEqual(result["papers"][0]["id"], "W123456789")

    def test_pmid_resolves_single_work(self):
        result = PaperDiscovery(self.client).discover("PMID:12345678", mode="title", per_neighborhood=0)
        self.assertEqual(result["input_mode"], "pmid")
        self.assertEqual(result["papers"][0]["id"], "W5")

    def test_resolved_paper_canonical_id_is_short_openalex_id(self):
        self.client.pmid_results[0]["ids"] = {
            "pmid": "https://pubmed.ncbi.nlm.nih.gov/12345678/"
        }
        result = PaperDiscovery(self.client).discover("PMID:12345678", per_neighborhood=0)
        resolved = result["input_resolution"]["resolved_paper"]
        self.assertEqual(resolved["id"], "W5")
        self.assertEqual(resolved["canonical_id"], "W5")
        self.assertEqual(resolved["identifiers"]["pmid"], "12345678")

    def test_arxiv_id_keeps_direct_open_access_record_if_openalex_has_no_match(self):
        arxiv = {
            "id": "arxiv_2301.12345v2",
            "openalex_id": None,
            "arxiv_id": "2301.12345v2",
            "title": "A Local arXiv Paper",
            "publication_year": 2023,
            "year": 2023,
            "authors": ["A Researcher"],
            "abstract": "This paper describes a research method in detail.",
            "pdf_url": "https://arxiv.org/pdf/2301.12345v2",
            "landing_page_url": "https://arxiv.org/abs/2301.12345v2",
            "is_open_access": True,
            "referenced_work_ids": [],
            "related_work_ids": [],
        }
        self.client.search_results = [work("W90", "Unrelated work")]
        result = PaperDiscovery(self.client, FakeArxivClient(arxiv)).discover("2301.12345v2", mode="title", per_neighborhood=0)
        self.assertEqual(result["input_mode"], "arxiv")
        self.assertEqual(result["paper_count"], 1)
        paper = result["papers"][0]
        self.assertEqual(paper["id"], "arxiv_2301.12345v2")
        self.assertEqual(paper["arxiv_id"], "2301.12345v2")
        self.assertTrue(paper["pdf_url"].startswith("https://arxiv.org/pdf/"))
        self.assertEqual(paper["identifier_type"], "arxiv")

    def test_arxiv_record_enriches_with_openalex_when_title_matches(self):
        arxiv = {
            "id": "arxiv_2301.12345",
            "openalex_id": None,
            "arxiv_id": "2301.12345",
            "title": "RISC-V Processor Design",
            "publication_year": 2024,
            "year": 2024,
            "authors": ["A Researcher"],
            "abstract": "An arxiv abstract.",
            "pdf_url": "https://arxiv.org/pdf/2301.12345",
            "landing_page_url": "https://arxiv.org/abs/2301.12345",
            "is_open_access": True,
            "referenced_work_ids": [],
            "related_work_ids": [],
        }
        result = PaperDiscovery(self.client, FakeArxivClient(arxiv)).discover("2301.12345", mode="title", per_neighborhood=0)
        self.assertEqual(result["papers"][0]["id"], "W1")
        self.assertEqual(result["papers"][0]["arxiv_id"], "2301.12345")
        self.assertEqual(result["papers"][0]["identifier_type"], "arxiv")

    def test_auto_plain_text_remains_keyword(self):
        result = PaperDiscovery(self.client).discover("RISC-V", mode="auto", seed_limit=1, per_neighborhood=0)
        self.assertEqual(result["input_mode"], "keyword")

    def test_abstract_reconstruction(self):
        self.assertEqual(reconstruct_abstract({"world": [1], "Hello": [0]}), "Hello world")

    def test_normalized_openalex_paper_exposes_all_identifiers(self):
        raw = work("W123456789", "Identifier metadata test", doi="10.1000/example")
        raw["ids"] = {
            "openalex": "https://openalex.org/W123456789",
            "doi": "https://doi.org/10.1000/example",
            "pmid": "https://pubmed.ncbi.nlm.nih.gov/12345678/",
        }
        paper = normalize_paper(raw, "test")
        self.assertEqual(paper["id"], "W123456789")
        self.assertEqual(paper["identifiers"]["openalex"], "W123456789")
        self.assertEqual(paper["identifiers"]["pmid"], "12345678")
        self.assertEqual(paper["identifiers"]["doi"], "10.1000/example")

    def test_pmid_is_used_as_a_deduplication_key_and_alias(self):
        from discovery.discovery import _aliases_for_paper
        paper = {
            "id": "W123456789",
            "openalex_id": "https://openalex.org/W123456789",
            "pmid": "12345678",
            "identifiers": {"pmid": "https://pubmed.ncbi.nlm.nih.gov/12345678/"},
            "title": "A PMID-linked paper",
        }
        self.assertEqual(paper_key(paper), "pmid:12345678")
        self.assertIn("12345678", _aliases_for_paper(paper))

    def test_records_with_shared_pmid_merge_even_if_openalex_ids_differ(self):
        first = work("W123456701", "Record one", doi="10.1000/shared")
        first["ids"] = {"pmid": "https://pubmed.ncbi.nlm.nih.gov/12345678/"}
        second = work("W123456702", "Record two")
        second["ids"] = {"pmid": "12345678"}
        self.client.search_results = [first, second]
        result = PaperDiscovery(self.client).discover(
            "shared identifier test", mode="keyword", seed_limit=2, per_neighborhood=0
        )
        self.assertEqual(result["paper_count"], 1)
        self.assertEqual(result["papers"][0]["pmid"], "12345678")
        self.assertEqual(result["papers"][0]["identifiers"]["pmid"], "12345678")

    def test_normalize_direct_arxiv_record(self):
        raw = {
            "id": "arxiv_2301.12345",
            "arxiv_id": "2301.12345",
            "title": "A Paper",
            "authors": ["Author One"],
            "abstract": "A useful abstract",
            "pdf_url": "https://arxiv.org/pdf/2301.12345",
            "is_open_access": True,
        }
        paper = normalize_paper(raw, "test")
        self.assertEqual(paper["id"], "arxiv_2301.12345")
        self.assertEqual(paper["authors"], ["Author One"])
        self.assertEqual(paper["abstract"], "A useful abstract")

    def test_arxiv_versions_deduplicate_as_one_work(self):
        one = {"arxiv_id": "2301.12345v1", "title": "Same", "year": 2023}
        two = {"arxiv_id": "2301.12345v2", "title": "Same", "year": 2023}
        self.assertEqual(paper_key(one), paper_key(two))


class OpenAlexClientRequestTests(unittest.TestCase):
    def test_citing_works_uses_explicit_descending_sort_syntax(self):
        class CapturingClient(OpenAlexClient):
            def __init__(self):
                super().__init__(base_url="https://example.invalid", api_key="")
                self.request_params = None

            def _get_json(self, path, params=None):
                self.request_params = (path, params)
                return {"results": []}

        client = CapturingClient()
        client.get_citing_works("https://openalex.org/W123", per_page=2)
        self.assertEqual(client.request_params[0], "/works")
        self.assertEqual(client.request_params[1]["filter"], "cites:W123")
        self.assertEqual(client.request_params[1]["sort"], "publication_date:desc")
        self.assertEqual(client.request_params[1]["per_page"], 2)

    def test_openalex_identifier_routes_to_single_work_endpoint(self):
        class CapturingClient(OpenAlexClient):
            def __init__(self):
                super().__init__(base_url="https://example.invalid", api_key="")
                self.path = None

            def _get_json(self, path, params=None):
                self.path = path
                return {"id": "https://openalex.org/W123456789", "title": "Test"}

        client = CapturingClient()
        result = client.get_work_by_id("W123456789")
        self.assertEqual(client.path, "/works/W123456789")
        self.assertEqual(result["title"], "Test")

    def test_pmid_uses_openalex_supported_external_id_endpoint(self):
        class CapturingClient(OpenAlexClient):
            def __init__(self):
                super().__init__(base_url="https://example.invalid", api_key="")
                self.path = None

            def _get_json(self, path, params=None):
                self.path = path
                return {"id": "https://openalex.org/W123", "title": "Test"}

        client = CapturingClient()
        client.lookup_pmid("12345678")
        self.assertEqual(client.path, "/works/pmid:12345678")


class ArxivClientTests(unittest.TestCase):
    def test_legacy_arxiv_atom_id_preserves_archive_prefix(self):
        xml = b'''<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/hep-th/9901001v2</id>
            <published>1999-01-10T12:00:00Z</published>
            <title> Legacy Archive Paper </title>
            <summary> A legacy paper abstract. </summary>
            <author><name>Author One</name></author>
          </entry>
        </feed>'''
        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return xml
        with patch("discovery.clients.urllib.request.urlopen", return_value=FakeResponse()):
            record = ArxivClient().lookup_arxiv("hep-th/9901001v2")
        self.assertEqual(record["arxiv_id"], "hep-th/9901001v2")
        self.assertTrue(record["pdf_url"].endswith("hep-th/9901001v2"))

    def test_arxiv_atom_metadata_is_normalized(self):
        xml = b'''<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
          <entry>
            <id>http://arxiv.org/abs/2301.12345v2</id>
            <published>2023-01-10T12:00:00Z</published>
            <title> A Local Paper </title>
            <summary> An abstract with useful details. </summary>
            <author><name>Author One</name></author>
            <arxiv:doi>10.1000/example</arxiv:doi>
            <arxiv:journal_ref>Example Journal</arxiv:journal_ref>
          </entry>
        </feed>'''

        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return xml

        with patch("discovery.clients.urllib.request.urlopen", return_value=FakeResponse()):
            record = ArxivClient().lookup_arxiv("2301.12345v2")
        self.assertEqual(record["title"], "A Local Paper")
        self.assertEqual(record["year"], 2023)
        self.assertEqual(record["doi"], "10.1000/example")
        self.assertEqual(record["authors"], ["Author One"])
        self.assertEqual(record["arxiv_id"], "2301.12345v2")
        self.assertTrue(record["pdf_url"].endswith("2301.12345v2"))


if __name__ == "__main__":
    unittest.main()
