"""Offline, evidence-oriented extraction of comparable research-paper fields.

The extractor keeps the historical flat fields used by the relationship engine
and adds a normalized ``research_profile`` with provenance and completeness.
No LLM, network request, embedding model, or third-party NLP package is used.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from typing import Any, Iterable

from .research_profile import build_research_profile

RULESET_VERSION = "research-profile-rules-v3"

_ABBREVIATIONS = (
    "e.g.", "i.e.", "et al.", "fig.", "eq.", "ref.", "refs.", "no.",
    "vs.", "approx.", "dr.", "prof.", "inc.", "al.", "cf.", "etc.",
)


def _clean(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip(" \t\r\n•▪◦")


def _sentences(text: str, *, minimum_chars: int = 28) -> list[str]:
    """Split research prose conservatively, preserving common abbreviations."""
    value = str(text or "").replace("\u00a0", " ")
    value = value.replace("\xad", "")
    value = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", value)  # PDF line-wrap hyphens
    value = re.sub(r"[ \t]+", " ", value)

    placeholders: dict[str, str] = {}
    for index, abbreviation in enumerate(_ABBREVIATIONS):
        token = f"@@ABBR{index}@@"
        pattern = re.compile(re.escape(abbreviation), re.IGNORECASE)
        value = pattern.sub(lambda _match, t=token: t, value)
        placeholders[token] = abbreviation

    # Split on sentence endings, line breaks, or bullet boundaries. Decimal
    # points and protected abbreviations do not trigger sentence boundaries.
    pieces = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(\[])|\n+|\s+[•▪◦]\s*", value)
    output: list[str] = []
    for piece in pieces:
        sentence = _clean(piece)
        for token, abbreviation in placeholders.items():
            sentence = sentence.replace(token, abbreviation)
        sentence = re.sub(r"^[\-–—*]+\s*", "", sentence)
        if len(sentence) < minimum_chars:
            continue
        if len(sentence.split()) < 5:
            continue
        output.append(sentence)
    return output


def _heading_text(heading: str) -> str:
    value = re.sub(r"^\s*(?:(?:\d+(?:\.\d+)*|[IVX]+)[.)]?\s+)", "", heading or "")
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = re.sub(r"\s+", " ", value).strip().lower()
    value = re.sub(r"[^a-z0-9 ]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def _heading_category(heading: str) -> str:
    value = _heading_text(heading)
    if not value:
        return "other"
    if value in {"abstract", "summary", "abstrak", "resumen", "resumo"}:
        return "abstract"
    if any(term in value for term in ("reference", "bibliography", "acknowledgement", "acknowledgment", "daftar pustaka")):
        return "back_matter"
    if any(term in value for term in (
        "future work", "future direction", "future research", "open problem", "open issue",
        "research agenda", "trabajo futuro", "trabalhos futuros", "penelitian selanjutnya",
        "arah penelitian", "saran", "lineas futuras", "trabajo futuro",
    )):
        return "future"
    if any(term in value for term in (
        "limitation", "threats to validity", "validity threat", "study constraints",
        "limitaciones", "limitacoes", "keterbatasan",
    )):
        return "limitations"
    if any(term in value for term in (
        "conclusion", "concluding remarks", "concluding discussion", "summary and outlook",
        "conclusiones", "conclusao", "kesimpulan", "penutup",
    )):
        return "conclusion"
    if any(term in value for term in ("hasil dan pembahasan", "results and discussion", "resultados y discusion")):
        return "results_discussion"
    if any(term in value for term in ("discussion", "interpretation", "discusion", "discussao", "pembahasan", "diskusi")):
        return "discussion"
    if any(term in value for term in (
        "result", "experiment", "evaluation", "benchmark", "performance analysis", "ablation", "findings",
        "hasil", "resultado", "resultados",
    )):
        return "results"
    if any(term in value for term in ("dataset", "data set", "data collection", "corpus", "benchmark data")):
        return "datasets"
    if any(term in value for term in ("contribution", "our contributions", "main contributions", "kontribusi")):
        return "contributions"
    if any(term in value for term in (
        "method", "methodology", "approach", "materials", "implementation",
        "system design", "architecture", "proposed framework", "research design",
        "experimental setup", "model design", "algorithm", "metodologia", "metode",
        "materiales y metodos", "materiais e metodos", "bahan dan metode",
    )):
        return "methods"
    if any(term in value for term in ("related work", "literature review", "previous work", "tinjauan pustaka", "kajian pustaka", "penelitian terdahulu")):
        return "related_work"
    if any(term in value for term in (
        "introduction", "background", "motivation", "problem statement", "research objectives",
        "introduccion", "introducao", "pendahuluan", "preamble",
    )):
        return "intro"
    return "other"


def _dedupe(items: Iterable[str], limit: int = 8) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for raw in items:
        item = _clean(raw)
        key = re.sub(r"\W+", " ", item.casefold()).strip()
        if not item or not key or key in seen:
            continue
        seen.add(key)
        output.append(item)
        if len(output) >= limit:
            break
    return output


# These patterns target statements, not isolated topic words. Keeping the
# patterns separate by field prevents a shared topic word from populating every
# research-profile category.
_PATTERNS: dict[str, re.Pattern[str]] = {
    "research_problem": re.compile(
        r"\b(problem|challenge|challenging|bottleneck|difficulty|difficulties|"
        r"shortcoming|limitation|limited ability|lack of|gap in|poor scalability|tantangan|"
        r"remains unclear|remain unresolved|not adequately addressed|issue with|"
        r"belum teratasi|belum diteliti|masih menjadi tantangan|keterbatasan|kurangnya bukti|"
        r"falta de evidencia|no se ha abordado|ainda nao foi abordado)\b", re.I,
    ),
    "research_objective": re.compile(
        r"\b(this paper|this study|this work|we (?:aim|seek|intend|investigate|study|examine|evaluate|assess|explore|develop|design|propose|present|introduce|compare)|"
        r"our (?:objective|goal|aim|work|study|approach)|the objective of|the aim of|"
        r"aims? to|seeks? to|is designed to|was designed to|we address|"
        r"penelitian ini bertujuan|studi ini bertujuan|tujuan penelitian|bertujuan untuk|"
        r"este estudio tiene como objetivo|este trabajo tiene como objetivo|"
        r"este estudo tem como objetivo|o objetivo deste estudo)\b", re.I,
    ),
    "research_questions": re.compile(
        r"\b(research question|we ask whether|we investigate whether|question addressed|"
        r"this study asks|the study examines whether)\b", re.I,
    ),
    "methodology": re.compile(
        r"\b(we (?:use|used|employ|employed|apply|applied|adopt|adopted|implement|implemented|train|trained|conduct|conducted)|"
        r"using|based on|is based on|was based on|algorithm|architecture|framework|model|"
        r"regression|classification|simulation|survey|case study|experiment|ablation|"
        r"cross.validation|qualitative|quantitative|statistical analysis|dataset|"
        r"menggunakan|digunakan|menerapkan|diimplementasikan|metode penelitian|"
        r"se utilizo|se aplico|utilizamos|foi utilizado)\b", re.I,
    ),
    "datasets": re.compile(
        r"\b(dataset|data set|corpus|benchmark|benchmark suite|workload|trace|"
        r"image ?net|coco dataset|mnist|cifar|squad|glue benchmark|natural questions|triviaqa)\b", re.I,
    ),
    "key_findings": re.compile(
        r"\b(our results? (?:show|demonstrate|indicate)|results? (?:show|indicate|demonstrate|suggest)|"
        r"we (?:find|found|observe|observed)|findings? (?:show|suggest|indicate)|"
        r"demonstrat(?:e|es|ed|ing)|outperform(?:s|ed|ing)?|improv(?:e|es|ed|ement)|"
        r"hasil menunjukkan|temuan menunjukkan|hasil penelitian menunjukkan|"
        r"reduc(?:e|es|ed|tion)|increas(?:e|es|ed)|achiev(?:e|es|ed)|"
        r"higher|lower|significant(?:ly)?|no significant|we obtain|we achieve)\b", re.I,
    ),
    "conclusion": re.compile(
        r"\b(in conclusion|to conclude|overall|we conclude|these findings suggest|"
        r"these results indicate|the results demonstrate|this study demonstrates|"
        r"our study shows|our work shows|taken together|the evidence suggests)\b", re.I,
    ),
    "limitations": re.compile(
        r"\b(limitations?|limited to|constrained by|does not address|do not address|"
        r"does not consider|do not consider|cannot (?:handle|address|capture|measure)|"
        r"not designed to|not evaluated|not tested|beyond the scope|outside the scope|"
        r"we did not|this study did not|only evaluated|only tested|lack of|insufficient|"
        r"tidak membahas|tidak mengevaluasi|belum mengeksplorasi|terbatas pada|"
        r"limitado a|no se evaluo|nao avaliou)\b", re.I,
    ),
    "future_work": re.compile(
        r"\b(future work|future research|future stud(?:y|ies)|future direction|"
        r"further research|further investigation|further study|should be investigated|"
        r"should be explored|should be evaluated|remains to be addressed|"
        r"remain to be explored|we plan to|will investigate|next step|"
        r"penelitian selanjutnya|penelitian masa depan|perlu diteliti|perlu dikaji|"
        r"estudios futuros|investigaciones futuras|trabalhos futuros|estudos futuros)\b", re.I,
    ),
    "research_gaps": re.compile(
        r"\b(unresolved|underexplored|under.explored|not yet understood|not well understood|"
        r"remains unclear|remain unclear|remains an open|open question|open problem|"
        r"research gap|gap remains|lack of evidence|insufficient evidence|"
        r"not adequately studied|has not been studied|have not been studied|"
        r"not been addressed|has not been addressed|beyond the scope|remains a challenge|"
        r"future work should|future research should|belum teratasi|belum diteliti|"
        r"masih menjadi tantangan|belum ada penelitian|perlu penelitian lebih lanjut|"
        r"falta de estudios|no se ha investigado|ainda pouco explorado)\b", re.I,
    ),
    "contributions": re.compile(
        r"\b(we contribute|our contributions|main contributions|we propose|we present|"
        r"we introduce|we develop|we design|this work presents|this paper proposes|"
        r"the main contribution)\b", re.I,
    ),
}

_METRIC_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("accuracy", re.compile(r"\baccuracy\b", re.I)),
    ("precision", re.compile(r"\bprecision\b", re.I)),
    ("recall", re.compile(r"\brecall\b", re.I)),
    ("f1", re.compile(r"\b(?:f.?1|f1.score)\b", re.I)),
    ("auc", re.compile(r"\b(?:roc.?auc|auc)\b", re.I)),
    ("bleu", re.compile(r"\bbleu\b", re.I)),
    ("rouge", re.compile(r"\brouge(?:.\d+)?\b", re.I)),
    ("ndcg", re.compile(r"\bndcg\b", re.I)),
    ("map", re.compile(r"\bmean average precision|\bmap\b", re.I)),
    ("mae", re.compile(r"\bmae\b|mean absolute error", re.I)),
    ("mse", re.compile(r"\bmse\b|mean squared error", re.I)),
    ("rmse", re.compile(r"\brmse\b|root mean squared error", re.I)),
    ("latency", re.compile(r"\blatency\b", re.I)),
    ("throughput", re.compile(r"\bthroughput\b", re.I)),
    ("runtime", re.compile(r"\bruntime\b|execution time|execution time", re.I)),
    ("speedup", re.compile(r"\bspeed.?up\b", re.I)),
    ("energy_consumption", re.compile(r"\benergy consumption\b|energy usage|power consumption", re.I)),
    ("cache_miss_rate", re.compile(r"\bcache[- ]miss rate\b|\bmiss rate\b", re.I)),
    ("memory_stalls", re.compile(r"\bmemory stalls?\b|\bstall count\b", re.I)),
    ("hit_rate", re.compile(r"\bhit rate\b|\bhit ratio\b", re.I)),
    ("error_rate", re.compile(r"\berror rate\b|\bfailure rate\b", re.I)),
    ("resource_usage", re.compile(r"\bresource usage\b|memory usage|cpu utilization", re.I)),
    ("scalability", re.compile(r"\bscalability\b|scale with", re.I)),
    ("sample_size", re.compile(r"\bsample size\b|\bparticipants\b|\bsubjects\b", re.I)),
    ("statistical_significance", re.compile(r"\bp.value\b|\bconfidence interval\b|\bstatistically significant\b", re.I)),
)

_METHOD_CONCEPTS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("machine_learning", re.compile(r"\bmachine learning\b|\bml\b", re.I)),
    ("deep_learning", re.compile(r"\bdeep learning\b", re.I)),
    ("transformer", re.compile(r"\btransformers?\b|\bself.attention\b", re.I)),
    ("convolutional_neural_network", re.compile(r"\bcnn\b|convolutional neural network", re.I)),
    ("recurrent_neural_network", re.compile(r"\brnn\b|recurrent neural network", re.I)),
    ("graph_neural_network", re.compile(r"\bgnn\b|graph neural network", re.I)),
    ("support_vector_machine", re.compile(r"\bsvm\b|support vector machine", re.I)),
    ("random_forest", re.compile(r"random forest", re.I)),
    ("reinforcement_learning", re.compile(r"\breinforcement learning\b|\brl\b", re.I)),
    ("regression", re.compile(r"\bregression\b", re.I)),
    ("classification", re.compile(r"\bclassification\b|classifier", re.I)),
    ("clustering", re.compile(r"\bclustering\b|\bcluster analysis\b", re.I)),
    ("simulation", re.compile(r"\bsimulation\b|\bsimulated\b", re.I)),
    ("survey", re.compile(r"\bsurvey\b|questionnaire", re.I)),
    ("case_study", re.compile(r"\bcase study\b|case studies", re.I)),
    ("systematic_review", re.compile(r"systematic literature review|systematic review", re.I)),
    ("meta_analysis", re.compile(r"meta.analysis", re.I)),
    ("qualitative_analysis", re.compile(r"\bqualitative\b|thematic analysis|content analysis", re.I)),
    ("quantitative_analysis", re.compile(r"\bquantitative\b|statistical analysis", re.I)),
    ("vector_search", re.compile(r"vector (?:search|retrieval)|nearest.neighbor search", re.I)),
    ("dense_retrieval", re.compile(r"dense retrieval|dense passage retrieval", re.I)),
    ("sparse_retrieval", re.compile(r"sparse retrieval|bm25|tf.idf", re.I)),
    ("heuristic", re.compile(r"\bheuristic\b", re.I)),
    ("round_robin_scheduling", re.compile(r"round.robin scheduling", re.I)),
    ("cache_aware_scheduling", re.compile(r"cache.aware scheduling", re.I)),
    ("federated_learning", re.compile(r"federated learning", re.I)),
    ("transfer_learning", re.compile(r"transfer learning", re.I)),
    ("fine_tuning", re.compile(r"fine.tun(?:e|ing|ed)", re.I)),
    ("knowledge_distillation", re.compile(r"knowledge distillation", re.I)),
)


class RuleBasedExtractor:
    """Extract a structured research profile from parsed scholarly content.

    Extracted strings are source sentences, not generated summaries. When a
    field is not explicitly supported by the text it remains empty and is
    marked missing/partial in ``research_profile``.
    """

    def extract(self, paper: dict[str, Any], parsed: dict[str, Any]) -> dict[str, Any]:
        sections = [section for section in (parsed.get("sections") or []) if isinstance(section, dict)]
        categorized: dict[str, list[dict[str, Any]]] = {}
        for section in sections:
            category = _heading_category(section.get("heading", ""))
            if category == "back_matter":
                continue
            if category == "results_discussion":
                categorized.setdefault("results", []).append(section)
                categorized.setdefault("discussion", []).append(section)
            else:
                categorized.setdefault(category, []).append(section)

        pdf_abstract = _clean(parsed.get("abstract"))
        metadata_abstract = _clean(paper.get("abstract"))
        summary_section = next(
            (
                section for section in categorized.get("abstract", [])
                if _heading_text(section.get("heading", "")) == "summary"
                and _clean(section.get("text"))
            ),
            None,
        )
        abstract = pdf_abstract or metadata_abstract or _clean((summary_section or {}).get("text"))
        if pdf_abstract:
            abstract_source = "pdf_abstract"
            abstract_section = {
                "heading": "Abstract", "page_start": None,
                "page_end": None, "source": abstract_source,
            }
        elif metadata_abstract:
            abstract_source = "bibliographic_abstract"
            abstract_section = {
                "heading": "Bibliographic abstract", "page_start": None,
                "page_end": None, "source": abstract_source,
            }
        elif summary_section:
            abstract_source = "pdf_summary"
            abstract_section = {
                **summary_section,
                "source": "pdf_section",
            }
        else:
            abstract_source = "missing"
            abstract_section = {
                "heading": "Abstract", "page_start": None,
                "page_end": None, "source": abstract_source,
            }

        evidence: list[dict[str, Any]] = []

        def add_evidence(field: str, sentence: str, section: dict[str, Any], rule: str) -> None:
            source = section.get("source") or "pdf_section"
            entry = {
                "field": field,
                "quote": sentence,
                "section": section.get("heading") or "Unknown section",
                "page_start": section.get("page_start"),
                "page_end": section.get("page_end"),
                "source": source,
                "rule": rule,
            }
            key = (field, re.sub(r"\W+", " ", sentence.casefold()).strip())
            if not any(
                item.get("field") == key[0]
                and re.sub(r"\W+", " ", str(item.get("quote", "")).casefold()).strip() == key[1]
                for item in evidence
            ):
                evidence.append(entry)

        def source_pairs(categories: Iterable[str]) -> list[tuple[str, dict[str, Any]]]:
            pairs: list[tuple[str, dict[str, Any]]] = []
            for category in categories:
                for section in categorized.get(category, []):
                    text = _clean(section.get("text"))
                    if text:
                        pairs.append((text, section))
            return pairs

        def select(
            field: str,
            sources: list[tuple[str, dict[str, Any]]],
            pattern: re.Pattern[str],
            *,
            limit: int = 6,
            rule: str | None = None,
        ) -> list[str]:
            found: list[str] = []
            for text, section in sources:
                for sentence in _sentences(text):
                    if pattern.search(sentence):
                        found.append(sentence)
                        add_evidence(field, sentence, section, rule or f"pattern:{field}")
            return _dedupe(found, limit)

        abstract_sources = [(abstract, abstract_section)] if abstract else []
        intro_sources = abstract_sources + source_pairs(("intro",))
        discussion_sources = source_pairs(("discussion",))
        result_sources = source_pairs(("results",))
        conclusion_sources = source_pairs(("conclusion",))
        limitation_sources = source_pairs(("limitations",))
        future_sources = source_pairs(("future",))
        method_sources = source_pairs(("methods",))
        dataset_sources = source_pairs(("datasets", "methods", "results"))
        contribution_sources = source_pairs(("contributions", "intro", "methods"))

        if abstract and not any(_heading_category(s.get("heading", "")) == "abstract" for s in sections):
            # Keep abstract metadata distinct from a body section.
            categorized.setdefault("abstract", [])

        research_problem = select(
            "research_problem", intro_sources, _PATTERNS["research_problem"], limit=6
        )
        research_objective = select(
            "research_objective", intro_sources, _PATTERNS["research_objective"], limit=6
        )
        research_questions = select(
            "research_questions", intro_sources, _PATTERNS["research_questions"], limit=4
        )

        # Methodology: prefer actual Methods/Approach sections. If a paper has
        # no recognizable heading, only use explicit method statements from
        # the abstract/introduction; never treat the entire paper as a method.
        methodology: list[str] = []
        method_rule = "explicit_method_sentence"
        if method_sources:
            candidates = [
                sentence
                for text, _section in method_sources
                for sentence in _sentences(text)
                if len(sentence.split()) >= 7
            ]
            # Prefer sentences with a procedural/method signal, then fill from
            # the labelled methods section if necessary.
            signalled = [s for s in candidates if _PATTERNS["methodology"].search(s)]
            methodology = _dedupe(signalled + candidates, 12)
            method_rule = "labelled_method_section"
            for text, section in method_sources:
                for sentence in _sentences(text):
                    if sentence in methodology:
                        add_evidence("methodology", sentence, section, method_rule)
        else:
            method_fallback_sources = abstract_sources + source_pairs(("intro",))
            methodology = select(
                "methodology", method_fallback_sources, _PATTERNS["methodology"],
                limit=8, rule="explicit_method_signal_outside_method_section",
            )

        method_text = " ".join(methodology)
        method_concepts: list[str] = []
        method_search_sources = method_sources or (abstract_sources + source_pairs(("intro",)))
        method_search_text = " ".join(
            [method_text] + [text for text, _section in method_search_sources]
        )
        for concept, pattern in _METHOD_CONCEPTS:
            if pattern.search(method_search_text):
                method_concepts.append(concept)
                matching_source = next(
                    (
                        (section, sentence)
                        for text, section in method_search_sources
                        for sentence in _sentences(text)
                        if pattern.search(sentence)
                    ),
                    None,
                )
                if matching_source:
                    source_section, matching_sentence = matching_source
                    add_evidence(
                        "method_concepts", matching_sentence, source_section,
                        f"method_concept:{concept}",
                    )

        datasets = select(
            "datasets", dataset_sources + abstract_sources, _PATTERNS["datasets"], limit=8
        )

        evaluation_metric_sentences: list[str] = []
        all_eval_sources = result_sources + discussion_sources + method_sources + abstract_sources
        for text, section in all_eval_sources:
            for sentence in _sentences(text):
                if any(pattern.search(sentence) for _name, pattern in _METRIC_PATTERNS):
                    evaluation_metric_sentences.append(sentence)
                    add_evidence("evaluation_metrics", sentence, section, "evaluation_metric_mention")
        evaluation_metrics = sorted({
            name for name, pattern in _METRIC_PATTERNS
            if any(pattern.search(sentence) for sentence in evaluation_metric_sentences)
        })

        result_and_discussion = result_sources + discussion_sources + conclusion_sources
        if not result_and_discussion and abstract:
            result_and_discussion = abstract_sources
        key_findings = select(
            "key_findings", result_and_discussion, _PATTERNS["key_findings"], limit=8
        )
        # In a formally headed Results/Findings section, substantive sentences
        # are valid findings evidence even if the authors do not use a fixed
        # phrase such as "the results show". Preserve their section provenance.
        if not key_findings and result_sources:
            labelled_findings = [
                sentence
                for text, _section in result_sources
                for sentence in _sentences(text)
                if len(sentence.split()) >= 7
            ]
            key_findings = _dedupe(labelled_findings, 8)
            for text, section in result_sources:
                for sentence in _sentences(text):
                    if sentence in key_findings:
                        add_evidence("key_findings", sentence, section, "labelled_results_section_fallback")

        conclusion = ""
        conclusion_source = "missing"
        if conclusion_sources:
            conclusion_sentences = [
                sentence for text, _section in conclusion_sources for sentence in _sentences(text)
            ]
            # Preserve the conclusion section prose, but cap size and deduplicate.
            conclusion = _clean(" ".join(conclusion_sentences))[:8000]
            conclusion_source = "conclusion_section"
            for text, section in conclusion_sources:
                for sentence in _sentences(text):
                    add_evidence("conclusion", sentence, section, "labelled_conclusion_section")
        else:
            # Discussion fallback: only select explicit synthesis/conclusion
            # statements. It is labelled partial in the profile provenance.
            fallback_pattern = re.compile(
                r"\b(overall|in conclusion|to conclude|we conclude|these findings suggest|"
                r"these results indicate|the results demonstrate|taken together|"
                r"the evidence suggests|our findings indicate|we found that|we find that|"
                r"our results highlight|our results show|our findings show|"
                r"we demonstrate that|this work demonstrates|this study demonstrates|"
                r"the study demonstrates|the main finding|the key finding|"
                r"secara keseluruhan|kesimpulannya|hasil penelitian menunjukkan|"
                r"en conclusion|en general|em conclusao|de modo geral)\b", re.I,
            )
            fallback = select(
                "conclusion", discussion_sources + result_sources, fallback_pattern,
                limit=5, rule="discussion_or_results_conclusion_signal",
            )
            if not fallback and (discussion_sources or result_sources):
                synthesis_pattern = re.compile(
                    r"\b(therefore|thus|consequently|in practice|overall|in this work|"
                    r"the results suggest|the findings suggest|the results indicate)\b", re.I,
                )
                fallback = select(
                    "conclusion", discussion_sources + result_sources, synthesis_pattern,
                    limit=4, rule="discussion_or_results_synthesis_fallback",
                )
            if fallback:
                conclusion = _clean(" ".join(fallback))[:3500]
                conclusion_source = "discussion_fallback"

        # Limitations and future-work statements may appear in named sections
        # or in Discussion/Conclusion paragraphs. The field evidence preserves
        # the true section/page where the statement was found.
        limitation_signal_sources = limitation_sources + discussion_sources + conclusion_sources + result_sources
        limitations = select(
            "limitations", limitation_signal_sources, _PATTERNS["limitations"], limit=8
        )
        # If a section is explicitly headed Limitations, its substantive
        # sentences are useful even when the authors do not repeat the word.
        if limitation_sources:
            labelled_limitations = [
                sentence for text, _section in limitation_sources
                for sentence in _sentences(text)
                if len(sentence.split()) >= 7
            ]
            limitations = _dedupe(limitations + labelled_limitations, 10)
            for text, section in limitation_sources:
                for sentence in _sentences(text):
                    if sentence in limitations:
                        add_evidence("limitations", sentence, section, "labelled_limitations_section")

        future_signal_sources = future_sources + discussion_sources + conclusion_sources + intro_sources
        future_work = select(
            "future_work", future_signal_sources, _PATTERNS["future_work"], limit=8
        )
        # A named Future Work section can contain detailed proposals without
        # repeating a fixed phrase in every sentence.
        if future_sources:
            labelled_future = [
                sentence for text, _section in future_sources
                for sentence in _sentences(text)
                if len(sentence.split()) >= 7
            ]
            future_work = _dedupe(future_work + labelled_future, 10)
            for text, section in future_sources:
                for sentence in _sentences(text):
                    if sentence in future_work:
                        add_evidence("future_work", sentence, section, "labelled_future_work_section")

        research_gap_sources = (
            intro_sources + limitation_sources + future_sources
            + discussion_sources + conclusion_sources + result_sources
        )
        explicit_gap_candidates = select(
            "research_gaps", research_gap_sources, _PATTERNS["research_gaps"], limit=10
        )
        research_gaps = _dedupe(
            limitations + future_work + explicit_gap_candidates, 14
        )
        # Add research_gaps evidence aliases for explicit source sentences so
        # older consumers can find them under the canonical field as well.
        for gap in research_gaps:
            if not any(item.get("field") == "research_gaps" and item.get("quote") == gap for item in evidence):
                source_item = next(
                    (
                        (section, sentence)
                        for text, section in research_gap_sources
                        for sentence in _sentences(text)
                        if sentence == gap
                    ),
                    None,
                )
                if source_item:
                    section, sentence = source_item
                    add_evidence("research_gaps", sentence, section, "explicit_gap_or_limitation_candidate")

        contributions = select(
            "contributions", contribution_sources, _PATTERNS["contributions"], limit=8
        )

        # Deduplicate evidence by (field, quote), preserve order, and cap to
        # prevent the JSON artifact from growing without bound.
        deduped_evidence: list[dict[str, Any]] = []
        seen_evidence: set[tuple[str, str]] = set()
        for item in evidence:
            key = (
                str(item.get("field") or ""),
                re.sub(r"\W+", " ", str(item.get("quote") or "").casefold()).strip(),
            )
            if key in seen_evidence:
                continue
            seen_evidence.add(key)
            deduped_evidence.append(item)
            if len(deduped_evidence) >= 120:
                break

        analysis: dict[str, Any] = {
            "extractor": "rules",
            "extractor_version": RULESET_VERSION,
            "research_problem": research_problem,
            "research_objective": research_objective,
            "research_questions": research_questions,
            "methodology": methodology,
            "method_concepts": method_concepts,
            "datasets": datasets,
            "evaluation_metrics": evaluation_metrics,
            "evaluation_metric_evidence": _dedupe(evaluation_metric_sentences, 8),
            "contributions": contributions,
            "key_findings": key_findings,
            "conclusion": conclusion,
            "conclusion_source": conclusion_source,
            "limitations": limitations,
            "future_work": future_work,
            "research_gaps": research_gaps,
            "evidence": deduped_evidence,
            "extraction_metadata": {
                "ruleset_version": RULESET_VERSION,
                "section_categories": {
                    key: len(value) for key, value in categorized.items()
                },
                "abstract_source": abstract_source if abstract else "missing",
                "conclusion_source": conclusion_source,
                "evidence_count": len(deduped_evidence),
                "source_character_count": len(str(parsed.get("full_text") or "")),
            },
            "quality_notes": [
                "Offline rule-based extraction; no LLM or external NLP model is used.",
                "Extracted values are source sentences or explicitly detected technical terms, not generated summaries.",
                "Research gaps are candidates from explicit unresolved-problem, limitation and future-work statements; human review is required.",
                "A discussion fallback is labelled separately and is not represented as a formally headed conclusion.",
                "Missing means the local rules did not find enough evidence; it does not prove the paper omits the information.",
            ],
        }
        analysis["research_profile"] = build_research_profile(analysis, parsed)
        return analysis
