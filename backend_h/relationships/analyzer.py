"""Offline, explainable paper-to-paper relationship scoring.

The relationship engine deliberately uses no LLM, API, embedding model or
third-party NLP package. It compares structured paper-analysis fields with a
project-wide TF-IDF lexical scorer plus overlap and phrase matching.

Input:
    <project>/analysis/analyses/*.json

Output:
    <project>/relationships/relationships.json

The output keeps the existing ``gaps``, ``comparisons``, ``inferred_edges``
and ``analyzed_papers`` fields so the knowledge-graph builder and frontend
can continue to consume it.

Scores are heuristic similarity scores, not probabilities or proof. All
inferred relationships require human review.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from analyzer import config
from analyzer.storage import write_json
from relationships.taxonomy import (
    extract_concepts, extract_outcome_metrics, normalize_domain_phrases,
    taxonomy_similarity, LOWER_IS_BETTER,
)

logger = logging.getLogger(__name__)

RELATIONSHIP_TYPES = {
    "similar_research_focus",
    "similar_methodology",
    "shared_research_gap",
    "potentially_addresses_gap",
    "potentially_conflicting_findings",
}

# Generic research-writing terms are removed so that shared academic boilerplate
# does not dominate the score. Technical vocabulary is intentionally retained.
_STOP_WORDS = set("""
a an and are as at be been being but by can could did do does doing for from had
has have having how i if in into is it its may might more most must no nor not of
off on once only or other our out over own same shall should so some such than
that the their them then there these they this those through to too under until
up use used using uses very was we were what when where which while who whom
why will with would you your
article articles paper papers study studies work works research researcher
researchers approach approaches method methods methodology result results
finding findings conclusion conclusions demonstrate demonstrates shown shows
showed present presents proposed propose introduces introduced developed
utilized utilize uses based novel new various several different significant
respectively therefore furthermore moreover also overall propos future further
limitation limitations remain remains remaining unresolved challenge challenges
need needs needed require requires required potential potentially area areas
""".split())

_TOKEN_RE = re.compile(r"[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+)*(?:\+\+|#)?", re.I)
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\[])|[\r\n]+")

# Common academic abbreviations are expanded to one canonical feature. This
# is deliberately small and conservative; it is not a semantic synonym model.
_ALIASES = {
    "ml": "machine_learning",
    "llm": "large_language_model",
    "llms": "large_language_model",
    "rag": "retrieval_augmented_generation",
    "gnn": "graph_neural_network",
    "gnns": "graph_neural_network",
    "gcn": "graph_convolutional_network",
    "gcns": "graph_convolutional_network",
    "nlp": "natural_language_processing",
    "cnn": "convolutional_neural_network",
    "cnns": "convolutional_neural_network",
    "rnn": "recurrent_neural_network",
    "rnns": "recurrent_neural_network",
}

# Normalize frequent multi-word research concepts and their abbreviations to
# the same lexical feature. This remains deterministic phrase matching, not
# a semantic embedding or synonym model.
_PHRASE_ALIASES = (
    (re.compile(r"\blarge[- ]language models?\b", re.I), "llm"),
    (re.compile(r"\bretrieval[- ]augmented generation\b", re.I), "rag"),
    (re.compile(r"\bmachine learning\b", re.I), "ml"),
    (re.compile(r"\bgraph neural networks?\b", re.I), "gnn"),
    (re.compile(r"\bgraph convolutional networks?\b", re.I), "gcn"),
    (re.compile(r"\bnatural language processing\b", re.I), "nlp"),
    (re.compile(r"\bconvolutional neural networks?\b", re.I), "cnn"),
    (re.compile(r"\brecurrent neural networks?\b", re.I), "rnn"),
)

_POSITIVE_PATTERNS = (
    re.compile(r"\b(improv\w*|outperform\w*|enhanc\w*|increas\w*|higher|better|effectiv\w*|benefit\w*|superior|gain\w*)\b", re.I),
)
_NEGATIVE_PATTERNS = (
    re.compile(r"\b(no improvement|did not improve|does not improve|do not improve|not improve|ineffectiv\w*|underperform\w*|wors\w*|no benefit|not significant|insignificant|failed to|fails to|without improvement|negative impact|no effect|no positive effect)\b", re.I),
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_text(value: Any) -> str:
    """Convert strings/lists/evidence objects into useful plain text."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (list, tuple, set)):
        return " ".join(part for part in (_as_text(x) for x in value) if part)
    if isinstance(value, dict):
        preferred = [value.get(k) for k in ("text", "quote", "claim", "description", "value")]
        selected = [x for x in preferred if x not in (None, "")]
        return " ".join(_as_text(x) for x in (selected or list(value.values())))
    return str(value)


def _as_items(value: Any) -> list[Any]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _stem(token: str) -> str:
    """A conservative suffix normalizer; avoids an additional NLP dependency."""
    if token in _ALIASES:
        return _ALIASES[token]
    if len(token) <= 4 or "_" in token:
        return token
    if token.endswith("ies") and len(token) > 5:
        return token[:-3] + "y"
    if token.endswith("ing") and len(token) > 6:
        base = token[:-3]
        if len(base) > 2 and base[-1] == base[-2]:
            base = base[:-1]
        return base
    if token.endswith("ed") and len(token) > 5:
        return token[:-2]
    if token.endswith("es") and len(token) > 5:
        return token[:-2]
    if token.endswith("s") and len(token) > 4 and not token.endswith("ss"):
        return token[:-1]
    return token


def _word_tokens(text: Any) -> list[str]:
    normalized = unicodedata.normalize("NFKC", _as_text(text)).casefold()
    normalized = normalize_domain_phrases(normalized)
    for pattern, replacement in _PHRASE_ALIASES:
        normalized = pattern.sub(replacement, normalized)
    raw = _TOKEN_RE.findall(normalized)
    tokens: list[str] = []
    for item in raw:
        token = _stem(item.strip(".-"))
        if not token or token in _STOP_WORDS or token.isdigit() or len(token) < 2:
            continue
        tokens.append(token)
    return tokens


def _features(text: Any) -> Counter[str]:
    """Create unigram and adjacent-bigram features from a text field."""
    words = _word_tokens(text)
    counts: Counter[str] = Counter(words)
    # Bigrams help distinguish domain phrases (e.g. graph neural, neural network)
    # while receiving a lower weight than individual terms in the final score.
    for left, right in zip(words, words[1:]):
        if left != right:
            counts[f"{left}::{right}"] += 1
    return counts


def _unigrams(text: Any) -> set[str]:
    return set(_word_tokens(text))


def _metric(left: set[str], right: set[str]) -> dict[str, Any]:
    common = sorted(left & right)
    union = left | right
    jaccard = len(common) / len(union) if union else 0.0
    overlap = len(common) / min(len(left), len(right)) if left and right else 0.0
    return {
        "jaccard": round(jaccard, 4),
        "overlap": round(overlap, 4),
        "shared_terms": common[:30],
        "shared_term_count": len(common),
    }


def _profile_value(analysis: dict[str, Any], field: str) -> Any:
    """Read Phase 1 normalized profile values, falling back to legacy flat fields."""
    value = analysis.get(field)
    if value not in (None, "", [], {}):
        return value
    profile = analysis.get("research_profile") or analysis.get("researchProfile") or {}
    fields = profile.get("fields") if isinstance(profile, dict) else {}
    item = fields.get(field) if isinstance(fields, dict) else None
    if isinstance(item, dict):
        value = item.get("value")
        if value not in (None, "", [], {}):
            return value
        evidence = item.get("evidence") or []
        if evidence:
            return [entry.get("quote", "") for entry in evidence if isinstance(entry, dict)]
    return ""


def _join_fields(analysis: dict[str, Any], *fields: str) -> str:
    return " ".join(
        text for text in (_as_text(_profile_value(analysis, field)) for field in fields)
        if text.strip()
    ).strip()


def _analysis_text_bundle(analysis: dict[str, Any], paper: dict[str, Any]) -> dict[str, str]:
    """Build independent, provenance-aware comparison dimensions.

    Phase 1's ``research_profile.fields`` is preferred when present; flat legacy
    fields remain supported for existing projects and whiteboard nodes.
    """
    problem = _join_fields(analysis, "research_problem")
    objective = _join_fields(analysis, "research_objective", "research_questions")
    conclusion = _join_fields(analysis, "conclusion", "key_findings")
    methods = _join_fields(analysis, "methodology", "method_concepts")
    datasets = _join_fields(analysis, "datasets")
    evaluation_metrics = _join_fields(analysis, "evaluation_metrics")
    contributions = _join_fields(analysis, "contributions")
    gaps = _join_fields(analysis, "research_gaps", "limitations", "future_work")
    abstract = _as_text(paper.get("abstract") or paper.get("summary") or paper.get("description"))
    title = _as_text(paper.get("title"))
    publication_context = " ".join(part for part in (title, abstract) if part).strip()
    focus_core = " ".join(part for part in (problem, objective, conclusion) if part).strip()
    contribution_text = " ".join(
        part for part in (objective, contributions, methods, conclusion) if part
    ).strip()
    return {
        # Compatibility fields consumed by the existing JSON/graph contract.
        "focus": focus_core or publication_context,
        "objective": " ".join(part for part in (problem, objective) if part).strip(),
        "publication_context": publication_context,
        "conclusion": conclusion,
        "gaps": gaps,
        "methods": methods,
        "outcomes": conclusion,
        # Independent Phase 2 dimensions.
        "problem": problem,
        "research_objective": objective,
        "focus_core": focus_core,
        "abstract": abstract,
        "title": title,
        "method_concepts": _join_fields(analysis, "method_concepts"),
        "datasets": datasets,
        "evaluation_metrics": evaluation_metrics,
        "contributions": contributions,
        "contribution_text": contribution_text,
    }

def _analysis_bundle(analysis: dict[str, Any], paper: dict[str, Any]) -> dict[str, set[str]]:
    text_bundle = _analysis_text_bundle(analysis, paper)
    return {key: _unigrams(value) for key, value in text_bundle.items()}


def _build_idf(records: list[dict[str, Any]]) -> tuple[dict[str, float], int]:
    """Build project-wide IDF from independent fields, not title-heavy bundles."""
    documents: list[Counter[str]] = []
    fields = (
        "focus_core", "problem", "research_objective", "conclusion", "gaps",
        "methods", "method_concepts", "datasets", "evaluation_metrics",
        "contributions", "abstract",
    )
    for record in records:
        for field in fields:
            text = record["text_bundle"].get(field, "")
            if text.strip():
                documents.append(_features(text))
    total = max(1, len(documents))
    document_frequency: Counter[str] = Counter()
    for document in documents:
        document_frequency.update(document.keys())
    idf = {
        term: math.log((1 + total) / (1 + frequency)) + 1.0
        for term, frequency in document_frequency.items()
    }
    return idf, total

def _cosine(left: Counter[str], right: Counter[str], idf: dict[str, float]) -> float:
    terms = set(left) | set(right)
    if not terms:
        return 0.0
    def feature_weight(term: str, count: float) -> float:
        phrase_factor = 0.35 if "::" in term else 1.0
        return (1.0 + math.log(count)) * idf.get(term, 1.0) * phrase_factor

    left_weights = {
        term: feature_weight(term, count)
        for term, count in left.items() if count > 0
    }
    right_weights = {
        term: feature_weight(term, count)
        for term, count in right.items() if count > 0
    }
    dot = sum(left_weights.get(term, 0.0) * right_weights.get(term, 0.0) for term in terms)
    left_norm = math.sqrt(sum(value * value for value in left_weights.values()))
    right_norm = math.sqrt(sum(value * value for value in right_weights.values()))
    if not left_norm or not right_norm:
        return 0.0
    return max(0.0, min(1.0, dot / (left_norm * right_norm)))


def _base_text_score(left: Any, right: Any, idf: dict[str, float]) -> dict[str, Any]:
    left_words = _unigrams(left)
    right_words = _unigrams(right)
    lexical = _metric(left_words, right_words)
    left_features = _features(left)
    right_features = _features(right)
    cosine = _cosine(left_features, right_features, idf)

    left_bigrams = {x for x in left_features if "::" in x}
    right_bigrams = {x for x in right_features if "::" in x}
    bigram_overlap = (
        len(left_bigrams & right_bigrams) / min(len(left_bigrams), len(right_bigrams))
        if left_bigrams and right_bigrams else 0.0
    )
    score = (
        0.55 * cosine
        + 0.23 * lexical["overlap"]
        + 0.14 * lexical["jaccard"]
        + 0.08 * bigram_overlap
    )
    return {
        "score": round(max(0.0, min(1.0, score)), 4),
        "tfidf_cosine": round(cosine, 4),
        "overlap": lexical["overlap"],
        "jaccard": lexical["jaccard"],
        "bigram_overlap": round(bigram_overlap, 4),
        "shared_terms": lexical["shared_terms"],
        "shared_term_count": lexical["shared_term_count"],
    }


def _text_chunks(text: Any, limit: int = 24) -> list[str]:
    """Split long fields into sentence-sized units to avoid document dilution."""
    cleaned = re.sub(r"\s+", " ", _as_text(text)).strip()
    if not cleaned:
        return []
    chunks = [part.strip() for part in _SENTENCE_RE.split(cleaned) if len(part.strip()) >= 35]
    if not chunks:
        chunks = [cleaned]
    # Some PDFs have long paragraphs without sentence punctuation. Split those
    # into overlapping word windows so local phrase matches are still possible.
    expanded: list[str] = []
    for chunk in chunks:
        words = chunk.split()
        if len(words) <= 110:
            expanded.append(chunk)
        else:
            start = 0
            while start < len(words):
                window = words[start:start + 90]
                if window:
                    expanded.append(" ".join(window))
                if start + 90 >= len(words):
                    break
                start += 70
    return expanded[:limit]


def _score_texts(left: Any, right: Any, idf: dict[str, float]) -> dict[str, Any]:
    """Hybrid score with whole-field and best sentence-to-sentence matches.

    Sentence matching helps when only one conclusion sentence or one gap
    overlaps in otherwise long paper summaries. It remains lexical and local.
    """
    whole = _base_text_score(left, right, idf)
    left_chunks = _text_chunks(left)
    right_chunks = _text_chunks(right)
    best_left: list[dict[str, Any]] = []
    best_right: list[dict[str, Any]] = []
    best_pairs: dict[tuple[str, str], dict[str, Any]] = {}

    # Limit the product to 24 x 24 chunks per field pair.
    for left_chunk in left_chunks:
        left_best: dict[str, Any] | None = None
        for right_chunk in right_chunks:
            pair_score = _base_text_score(left_chunk, right_chunk, idf)
            if pair_score["shared_term_count"] < 2:
                continue
            item = {
                **pair_score,
                "left_sentence": left_chunk[:360],
                "right_sentence": right_chunk[:360],
            }
            key = (item["left_sentence"], item["right_sentence"])
            previous = best_pairs.get(key)
            if previous is None or item["score"] > previous["score"]:
                best_pairs[key] = item
            if left_best is None or item["score"] > left_best["score"]:
                left_best = item
            # The right-side best list is populated below from best_pairs.
        if left_best is not None:
            best_left.append(left_best)

    for right_chunk in right_chunks:
        right_best: dict[str, Any] | None = None
        for left_chunk in left_chunks:
            key = (left_chunk[:360], right_chunk[:360])
            item = best_pairs.get(key)
            if item is not None and (right_best is None or item["score"] > right_best["score"]):
                right_best = item
        if right_best is not None:
            best_right.append(right_best)

    def top_mean(items: list[dict[str, Any]]) -> float:
        values = sorted((item["score"] for item in items), reverse=True)[:3]
        return sum(values) / len(values) if values else 0.0

    local_score = (top_mean(best_left) + top_mean(best_right)) / 2.0
    # Whole-document overlap protects against a single coincidental sentence;
    # local matching makes short shared concepts visible in long conclusions.
    combined = 0.42 * whole["score"] + 0.58 * local_score

    # Include terms from the strongest local matches in the diagnostics while
    # retaining the full-field overlap terms first.
    shared = list(whole["shared_terms"])
    for item in sorted(best_pairs.values(), key=lambda x: x["score"], reverse=True)[:3]:
        for term in item["shared_terms"]:
            if term not in shared:
                shared.append(term)
    return {
        **whole,
        "whole_text_score": whole["score"],
        "sentence_match_score": round(local_score, 4),
        "score": round(max(0.0, min(1.0, combined)), 4),
        "shared_terms": shared[:30],
        "shared_term_count": len(shared),
        "best_sentence_matches": [
            {
                "score": item["score"],
                "shared_terms": item["shared_terms"][:12],
                "left_sentence": item["left_sentence"],
                "right_sentence": item["right_sentence"],
            }
            for item in sorted(best_pairs.values(), key=lambda x: x["score"], reverse=True)[:3]
        ],
    }

def _weighted_score(parts: list[tuple[float, float, bool]]) -> float:
    available = [(score, weight) for score, weight, has_text in parts if has_text]
    if not available:
        return 0.0
    total_weight = sum(weight for _, weight in available)
    return round(sum(score * weight for score, weight in available) / total_weight, 4)


def _threshold(name: str, default: float) -> float:
    try:
        value = float(getattr(config, name, default))
    except (TypeError, ValueError):
        value = default
    return max(0.0, min(1.0, value))


def _has_minimum_evidence(score: dict[str, Any], minimum_shared_terms: int = 2) -> bool:
    return int(score.get("shared_term_count", 0)) >= minimum_shared_terms


def _has_text_pair(left: str, right: str, min_chars: int = 35) -> bool:
    return len((left or "").strip()) >= min_chars and len((right or "").strip()) >= min_chars


def _term_overlap(left: set[str], right: set[str]) -> dict[str, Any]:
    shared = sorted(left & right)
    union = left | right
    return {
        "score": round(len(shared) / min(len(left), len(right)), 4) if left and right else 0.0,
        "jaccard": round(len(shared) / len(union), 4) if union else 0.0,
        "shared_concepts": shared,
        "shared_count": len(shared),
    }


def _weighted_available(parts: list[tuple[str, dict[str, Any], float, bool]]) -> tuple[float, dict[str, Any]]:
    available = [(name, metric, weight) for name, metric, weight, has_text in parts if has_text]
    if not available:
        return 0.0, {"used_components": [], "missing_components": [name for name, _, _, has in parts if not has]}
    total_weight = sum(weight for _, _, weight in available)
    score = sum(float(metric.get("score", 0.0)) * weight for _, metric, weight in available) / total_weight
    return round(score, 4), {
        "used_components": [name for name, _, _ in available],
        "missing_components": [name for name, _, _, has in parts if not has],
        "component_scores": {
            name: {"score": metric.get("score", 0.0), "weight": weight}
            for name, metric, weight in available
        },
    }


def _outcome_signals(text: str) -> dict[str, set[str]]:
    """Extract metric-specific directions; used only for conservative conflict candidates."""
    signals: dict[str, set[str]] = {}
    sentences = _text_chunks(text, limit=48)
    no_effect = re.compile(
        r"\b(no significant|not significant|not statistically significant|no effect|no improvement|did not improve|does not improve|failed to improve|without improvement)\b",
        re.I,
    )
    up = re.compile(r"\b(increas\w*|higher|greater|rise\w*|grew|improv\w*|enhanc\w*|outperform\w*|better)\b", re.I)
    down = re.compile(r"\b(decreas\w*|reduc\w*|lower|drop\w*|fall\w*|declin\w*|worsen\w*|degrad\w*)\b", re.I)
    for sentence in sentences:
        metrics = extract_outcome_metrics(sentence)
        if not metrics:
            continue
        if no_effect.search(sentence):
            direction = "no_change"
        else:
            has_up = bool(up.search(sentence))
            has_down = bool(down.search(sentence))
            if has_up == has_down:
                continue
            direction = "up" if has_up else "down"
            # "Improve" and "worsen" describe benefit, not necessarily a
            # numeric increase. Convert using the metric's usual direction.
            if re.search(r"\b(improv\w*|enhanc\w*|outperform\w*|better|worsen\w*|degrad\w*)\b", sentence, re.I):
                benefit = "harmful" if re.search(r"\b(worsen\w*|degrad\w*)\b", sentence, re.I) else "beneficial"
                lower_is_better = any(metric in LOWER_IS_BETTER for metric in metrics)
                direction = ("down" if lower_is_better else "up") if benefit == "beneficial" else ("up" if lower_is_better else "down")
        for metric in metrics:
            signals.setdefault(metric, set()).add(direction)
    return signals


def _compare_pair(first: dict[str, Any], second: dict[str, Any], idf: dict[str, float]) -> dict[str, Any]:
    """Compute five genuinely separate scores from category-specific inputs."""
    a, b = first["text_bundle"], second["text_bundle"]

    # 1. Research focus: substantive problem/objective/conclusion only.
    focus_core_a, focus_core_b = a["focus_core"], b["focus_core"]
    focus_core_available = _has_text_pair(focus_core_a, focus_core_b)
    focus_objectives = _score_texts(a["objective"], b["objective"], idf)
    focus_conclusions = _score_texts(a["conclusion"], b["conclusion"], idf)
    focus_problem = _score_texts(a["problem"], b["problem"], idf)
    focus_core = _score_texts(focus_core_a, focus_core_b, idf)
    abstract_available = _has_text_pair(a["abstract"], b["abstract"], min_chars=80)
    abstract_score = _score_texts(a["abstract"], b["abstract"], idf)
    focus_score = focus_core["score"] if focus_core_available else (abstract_score["score"] * 0.72 if abstract_available else 0.0)
    focus_basis = "problem_objective_conclusion" if focus_core_available else "abstract_only_fallback" if abstract_available else "insufficient_focus_text"
    focus_terms = focus_core.get("shared_terms", []) if focus_core_available else abstract_score.get("shared_terms", [])

    # 2. Methodology: methodology/method concepts lead. Datasets and metrics
    # are contextual support and cannot independently trigger the category.
    method_text_available = _has_text_pair(a["methods"], b["methods"], min_chars=20)
    method_score = _score_texts(a["methods"], b["methods"], idf)
    method_concepts_a = extract_concepts(" ".join((a["methods"], a["method_concepts"])), "method")
    method_concepts_b = extract_concepts(" ".join((b["methods"], b["method_concepts"])), "method")
    method_taxonomy = taxonomy_similarity(method_concepts_a, method_concepts_b)
    method_lexical_terms = set(method_score.get("shared_terms", []))
    method_shared_evidence = bool(method_taxonomy["shared_concepts"]) or len(method_lexical_terms) >= 3
    method_tax_component = float(method_taxonomy["score"])
    if method_text_available:
        methodology_score = round(0.75 * method_score["score"] + 0.25 * method_tax_component, 4)
    elif method_taxonomy["shared_concepts"]:
        methodology_score = round(0.25 * method_tax_component, 4)
    else:
        methodology_score = 0.0
    dataset_score = _score_texts(a["datasets"], b["datasets"], idf)
    metric_score = _score_texts(a["evaluation_metrics"], b["evaluation_metrics"], idf)
    dataset_taxonomy = taxonomy_similarity(
        extract_concepts(a["datasets"], "dataset"),
        extract_concepts(b["datasets"], "dataset"),
    )
    evaluation_taxonomy = taxonomy_similarity(
        extract_concepts(a["evaluation_metrics"], "metric"),
        extract_concepts(b["evaluation_metrics"], "metric"),
    )

    # 3. Shared research gaps: compare only limitations/future work/gap text.
    gaps_available = _has_text_pair(a["gaps"], b["gaps"], min_chars=25)
    gap_score = _score_texts(a["gaps"], b["gaps"], idf)

    # 4. Gap-addressing is directional and compares an explicit gap with the
    # other paper's contribution/objective/method/findings, not its title.
    gap_a_to_b = _score_texts(a["gaps"], b["contribution_text"], idf)
    gap_b_to_a = _score_texts(b["gaps"], a["contribution_text"], idf)
    contribution_action = re.compile(
        r"\b(propos\w*|introduc\w*|develop\w*|design\w*|present\w*|implement\w*|evaluat\w*|address\w*|mitigat\w*|reduc\w*|overcom\w*|demonstrat\w*|provid\w*|investigat\w*|improv\w*)\b",
        re.I,
    )
    a_gap_source = len(a["gaps"].strip()) >= 25
    b_gap_source = len(b["gaps"].strip()) >= 25
    a_has_contribution = bool(a["contribution_text"].strip()) and bool(contribution_action.search(a["contribution_text"]) or a["methods"].strip())
    b_has_contribution = bool(b["contribution_text"].strip()) and bool(contribution_action.search(b["contribution_text"]) or b["methods"].strip())

    # 5. Conflicts: require the same named outcome metric with opposing
    # directions. Shared topic vocabulary by itself is never enough.
    outcome_a = _outcome_signals(a["outcomes"])
    outcome_b = _outcome_signals(b["outcomes"])
    shared_metrics = sorted(set(outcome_a) & set(outcome_b))
    conflicting_metrics = [
        metric for metric in shared_metrics
        if any(direction_a != direction_b for direction_a in outcome_a[metric] for direction_b in outcome_b[metric])
    ]
    outcome_similarity = _score_texts(a["outcomes"], b["outcomes"], idf)
    conflict_score = round(
        0.70 * outcome_similarity["score"] + 0.30 * (len(conflicting_metrics) / max(1, len(set(outcome_a) | set(outcome_b)))),
        4,
    ) if conflicting_metrics else 0.0

    return {
        # Stable compatibility aliases used by prior edge generation and clients.
        "focus": focus_core,
        "weighted_focus": {
            **focus_core,
            "score": focus_score,
            "basis": focus_basis,
            "shared_terms": focus_terms[:30],
            "shared_term_count": len(focus_terms),
        },
        "objective": focus_objectives,
        "publication_context": abstract_score,
        "conclusion": outcome_similarity,
        "gaps": gap_score,
        "methods": method_score,
        "gap_a_to_b": gap_a_to_b,
        "gap_b_to_a": gap_b_to_a,
        # Independent category scores and their components.
        "categories": {
            "similar_research_focus": {
                "score": focus_score,
                "basis": focus_basis,
                "components": {
                    "problem_objective": focus_objectives["score"],
                    "conclusion_findings": focus_conclusions["score"],
                    "problem": focus_problem["score"],
                    "abstract_fallback": abstract_score["score"] if not focus_core_available else None,
                },
                "shared_terms": focus_terms[:30],
                "shared_term_count": len(focus_terms),
                "eligible_fields": focus_core_available or abstract_available,
            },
            "similar_methodology": {
                "score": methodology_score,
                "components": {
                    "method_text": method_score["score"],
                    "method_taxonomy": method_tax_component,
                    "dataset_text_support": dataset_score["score"],
                    "dataset_taxonomy_support": dataset_taxonomy["score"],
                    "evaluation_metric_support": metric_score["score"],
                    "evaluation_taxonomy_support": evaluation_taxonomy["score"],
                },
                "shared_terms": method_score.get("shared_terms", []),
                "shared_method_concepts": method_taxonomy["shared_concepts"],
                "shared_datasets": dataset_taxonomy["shared_concepts"],
                "shared_evaluation_metrics": evaluation_taxonomy["shared_concepts"],
                "shared_term_count": method_score.get("shared_term_count", 0),
                "eligible_fields": method_text_available,
            },
            "shared_research_gap": {
                "score": gap_score["score"],
                "shared_terms": gap_score.get("shared_terms", []),
                "shared_term_count": gap_score.get("shared_term_count", 0),
                "eligible_fields": gaps_available,
            },
            "potentially_addresses_gap_a_to_b": {
                "score": gap_a_to_b["score"],
                "shared_terms": gap_a_to_b.get("shared_terms", []),
                "shared_term_count": gap_a_to_b.get("shared_term_count", 0),
                "eligible_fields": a_gap_source and b_has_contribution,
                "gap_owner_has_gap": a_gap_source,
                "target_has_contribution": b_has_contribution,
            },
            "potentially_addresses_gap_b_to_a": {
                "score": gap_b_to_a["score"],
                "shared_terms": gap_b_to_a.get("shared_terms", []),
                "shared_term_count": gap_b_to_a.get("shared_term_count", 0),
                "eligible_fields": b_gap_source and a_has_contribution,
                "gap_owner_has_gap": b_gap_source,
                "target_has_contribution": a_has_contribution,
            },
            "potentially_conflicting_findings": {
                "score": conflict_score,
                "shared_metrics": shared_metrics,
                "conflicting_metrics": conflicting_metrics,
                "paper_a_outcome_signals": {key: sorted(value) for key, value in outcome_a.items()},
                "paper_b_outcome_signals": {key: sorted(value) for key, value in outcome_b.items()},
                "eligible_fields": bool(a["outcomes"].strip() and b["outcomes"].strip()),
            },
        },
    }


def _category_diagnostic(name: str, item: dict[str, Any], threshold: float, extra_ok: bool = True, extra_reason: str = "") -> dict[str, Any]:
    eligible = bool(item.get("eligible_fields")) and extra_ok
    score = float(item.get("score", 0.0))
    passed = eligible and score >= threshold
    reasons: list[str] = []
    if not item.get("eligible_fields"):
        reasons.append("Required evidence fields are missing or incomplete for one or both papers.")
    if not extra_ok and extra_reason:
        reasons.append(extra_reason)
    if eligible and score < threshold:
        reasons.append(f"Score {score:.3f} is below threshold {threshold:.3f}.")
    if passed:
        reasons.append("Category-specific evidence and score requirements passed.")
    return {
        "score": round(score, 4),
        "threshold": round(threshold, 4),
        "eligible": eligible,
        "passed": passed,
        "reasons": reasons,
        **{key: value for key, value in item.items() if key not in {"score", "eligible_fields"}},
    }


def _build_candidates(first: dict[str, Any], second: dict[str, Any], metrics: dict[str, Any]) -> list[dict[str, Any]]:
    """Apply separate evidence and scoring gates for each relationship category."""
    categories = metrics["categories"]
    thresholds = {
        "similar_research_focus": _threshold("RELATIONSHIP_FOCUS_THRESHOLD", 0.15),
        "similar_methodology": _threshold("RELATIONSHIP_METHOD_THRESHOLD", 0.20),
        "shared_research_gap": _threshold("RELATIONSHIP_GAP_THRESHOLD", 0.18),
        "potentially_addresses_gap": _threshold("RELATIONSHIP_GAP_ADDRESS_THRESHOLD", 0.17),
        "potentially_conflicting_findings": _threshold("RELATIONSHIP_CONFLICT_THRESHOLD", 0.18),
    }
    diagnostics: dict[str, Any] = {}
    candidates: list[dict[str, Any]] = []

    # Research focus: require substantive core text and shared terms from the
    # actual research problem/objective/conclusion. Abstract-only fallback has
    # a stricter threshold and more shared-term evidence; title alone is never used.
    focus_item = categories["similar_research_focus"]
    focus_abstract_fallback = focus_item.get("basis") == "abstract_only_fallback"
    focus_extra_ok = int(focus_item.get("shared_term_count", 0)) >= (3 if focus_abstract_fallback else 2)
    focus_threshold = max(thresholds["similar_research_focus"], 0.24) if focus_abstract_fallback else thresholds["similar_research_focus"]
    diagnostics["similar_research_focus"] = _category_diagnostic(
        "similar_research_focus", focus_item, focus_threshold, focus_extra_ok,
        "Focus comparison needs at least three shared content terms.",
    )
    if diagnostics["similar_research_focus"]["passed"]:
        candidates.append({
            "type": "similar_research_focus",
            "score": focus_item["score"],
            "direction": "a_to_b",
            "basis": f"independent problem/objective/conclusion comparison ({focus_item.get('basis')})",
        })

    # Methodology: method text must be present in both papers AND there must be
    # either one recognized common method or at least three shared method terms.
    method_item = categories["similar_methodology"]
    method_extra_ok = bool(method_item.get("shared_method_concepts")) or int(method_item.get("shared_term_count", 0)) >= 3
    diagnostics["similar_methodology"] = _category_diagnostic(
        "similar_methodology", method_item, thresholds["similar_methodology"], method_extra_ok,
        "No common recognized method or at least three shared methodology terms were found.",
    )
    if diagnostics["similar_methodology"]["passed"]:
        candidates.append({
            "type": "similar_methodology",
            "score": method_item["score"],
            "direction": "a_to_b",
            "basis": "methodology text plus method-taxonomy overlap; datasets and evaluation metrics are supporting evidence only",
        })

    # Shared gaps: both papers must contain explicit gap/limitation/future-work text.
    gap_item = categories["shared_research_gap"]
    gap_extra_ok = int(gap_item.get("shared_term_count", 0)) >= 2
    diagnostics["shared_research_gap"] = _category_diagnostic(
        "shared_research_gap", gap_item, thresholds["shared_research_gap"], gap_extra_ok,
        "Both papers must state gaps and share at least two substantive terms.",
    )
    if diagnostics["shared_research_gap"]["passed"]:
        candidates.append({
            "type": "shared_research_gap",
            "score": gap_item["score"],
            "direction": "a_to_b",
            "basis": "explicit research gaps, limitations and future-work statements only",
        })

    # Directional gap addressing: the target must describe a contribution,
    # method, objective or result; common topic words alone do not qualify.
    for direction, key in (("a_to_b", "potentially_addresses_gap_a_to_b"), ("b_to_a", "potentially_addresses_gap_b_to_a")):
        item = categories[key]
        extra_ok = int(item.get("shared_term_count", 0)) >= 2
        diagnostic_key = f"potentially_addresses_gap_{direction}"
        diagnostics[diagnostic_key] = _category_diagnostic(
            diagnostic_key, item, thresholds["potentially_addresses_gap"], extra_ok,
            "A directional gap comparison needs at least two shared terms in an explicit contribution context.",
        )
        if diagnostics[diagnostic_key]["passed"]:
            candidates.append({
                "type": "potentially_addresses_gap",
                "score": item["score"],
                "direction": direction,
                "basis": "explicit gap compared with the other paper's objective, contribution, methodology and findings",
            })

    # Conflicts: only same-metric, opposing outcome directions may qualify.
    conflict_item = categories["potentially_conflicting_findings"]
    conflict_extra_ok = bool(conflict_item.get("conflicting_metrics"))
    diagnostics["potentially_conflicting_findings"] = _category_diagnostic(
        "potentially_conflicting_findings", conflict_item,
        thresholds["potentially_conflicting_findings"], conflict_extra_ok,
        "No common measured outcome with opposing directions was found.",
    )
    if diagnostics["potentially_conflicting_findings"]["passed"]:
        candidates.append({
            "type": "potentially_conflicting_findings",
            "score": conflict_item["score"],
            "direction": "a_to_b",
            "basis": "same named evaluation outcome with explicitly opposing result directions",
        })

    metrics["category_decisions"] = diagnostics
    return candidates

def _outcome_polarity(text: str) -> str | None:
    """Legacy helper retained for compatibility; returns a coarse direction."""
    signals = _outcome_signals(text)
    directions = {direction for values in signals.values() for direction in values}
    return next(iter(directions)) if len(directions) == 1 else None

def _edge_id(source: str, target: str, relation: str) -> str:
    raw = f"{source}|{target}|{relation}".encode("utf-8")
    return "rel_" + hashlib.sha1(raw).hexdigest()[:12]


def _sentences(text: str, limit: int = 3) -> list[str]:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        return []
    parts = [part.strip() for part in _SENTENCE_RE.split(cleaned) if len(part.strip()) >= 20]
    return parts[:limit]


def _field_quotes(analysis: dict[str, Any], fields: Iterable[str], limit: int = 3) -> list[dict[str, Any]]:
    wanted = set(fields)
    output: list[dict[str, Any]] = []
    seen: set[str] = set()

    raw_evidence = analysis.get("evidence") or []
    evidence_items = list(raw_evidence) if isinstance(raw_evidence, list) else []
    profile = analysis.get("research_profile") or analysis.get("researchProfile") or {}
    profile_fields = profile.get("fields") if isinstance(profile, dict) else {}
    for field in wanted:
        item = profile_fields.get(field) if isinstance(profile_fields, dict) else None
        if isinstance(item, dict):
            for evidence_record in item.get("evidence") or []:
                if isinstance(evidence_record, dict):
                    evidence_items.append({"field": field, **evidence_record})

    for item in evidence_items:
        if not isinstance(item, dict) or item.get("field") not in wanted:
            continue
        quote = _as_text(item.get("quote"))
        key = quote.casefold()
        if not quote or key in seen:
            continue
        output.append({
            "field": item.get("field"),
            "quote": quote[:700],
            "section": item.get("section"),
            "page_start": item.get("page_start"),
            "page_end": item.get("page_end"),
            "source": item.get("source"),
        })
        seen.add(key)
        if len(output) >= limit:
            return output

    # Older and whiteboard artifacts may hold normalized values in the nested
    # profile but not duplicate them into flat analysis fields.
    for field in sorted(wanted):
        value = _profile_value(analysis, field)
        for sentence in _sentences(_as_text(value), limit=limit):
            key = sentence.casefold()
            if key in seen:
                continue
            output.append({"field": field, "quote": sentence[:700], "section": field})
            seen.add(key)
            if len(output) >= limit:
                return output
    return output

def _relation_fields(relation: str, direction: str) -> tuple[set[str], set[str]]:
    if relation == "similar_methodology":
        fields = {"methodology", "method_concepts", "datasets", "evaluation_metrics"}
        return fields, fields
    if relation == "shared_research_gap":
        fields = {"research_gaps", "limitations", "future_work"}
        return fields, fields
    if relation == "potentially_addresses_gap":
        gap_fields = {"research_gaps", "limitations", "future_work"}
        contribution_fields = {
            "conclusion", "key_findings", "research_objective", "research_problem",
            "contributions", "methodology", "method_concepts", "datasets", "evaluation_metrics",
        }
        return (gap_fields, contribution_fields) if direction == "a_to_b" else (contribution_fields, gap_fields)
    if relation == "potentially_conflicting_findings":
        fields = {"conclusion", "key_findings"}
        return fields, fields
    fields = {
        "research_problem", "research_objective", "research_questions",
        "conclusion", "key_findings", "contributions",
    }
    return fields, fields


def _confidence_label(score: float) -> str:
    # Descriptive score bands, not statistical confidence/probability.
    if score >= 0.55:
        return "high_similarity"
    if score >= 0.35:
        return "moderate_similarity"
    return "possible_similarity"


def _edge_explanation(candidate: dict[str, Any], metrics: dict[str, Any]) -> str:
    basis = candidate.get("basis", "weighted lexical similarity")
    score = float(candidate.get("score", 0.0))
    return (
        f"Offline comparison detected {candidate['type'].replace('_', ' ')} "
        f"(score {score:.3f}) using {basis}. This is a heuristic text match, "
        "not proof of agreement, contradiction or gap resolution."
    )


def _candidate_edge(
    source: str,
    target: str,
    candidate: dict[str, Any],
    first: dict[str, Any],
    second: dict[str, Any],
    metrics: dict[str, Any],
) -> dict[str, Any]:
    relation = str(candidate["type"])
    direction = str(candidate.get("direction", "a_to_b"))
    source_fields, target_fields = _relation_fields(relation, direction)
    evidence = {
        "paper_a": _field_quotes(first["analysis"], source_fields),
        "paper_b": _field_quotes(second["analysis"], target_fields),
        "score_basis": candidate.get("basis"),
    }
    score = float(candidate.get("score", 0.0))
    if relation == "shared_research_gap":
        selected_metric = metrics.get("gaps", {})
    elif relation == "potentially_addresses_gap":
        selected_metric = metrics.get("gap_a_to_b" if direction == "a_to_b" else "gap_b_to_a", {})
    elif relation == "similar_methodology":
        selected_metric = metrics.get("categories", {}).get("similar_methodology", metrics.get("methods", {}))
    elif relation == "potentially_conflicting_findings":
        selected_metric = metrics.get("conclusion", {})
    else:
        selected_metric = metrics.get("weighted_focus", metrics.get("focus", {}))
    return {
        "id": _edge_id(source, target, relation),
        "source": source,
        "target": target,
        "type": relation,
        "kind": "inferred_research",
        "score": round(max(0.0, min(1.0, score)), 4),
        "similarity_score": round(max(0.0, min(1.0, score)), 4),
        "score_method": "offline_independent_category_scoring_v4",
        "category": relation,
        "category_decision": metrics.get("category_decisions", {}).get(relation, metrics.get("category_decisions", {}).get(f"{relation}_{direction}", {})),
        "confidence_label": _confidence_label(score),
        "verification_status": "heuristic_scored",
        "shared_terms": selected_metric.get("shared_terms", []),
        "shared_term_count": selected_metric.get("shared_term_count", 0),
        "explanation": _edge_explanation(candidate, metrics),
        "evidence": evidence,
        "requires_human_review": True,
        "direction": direction,
        "paper_a_id": first["paper_id"],
        "paper_b_id": second["paper_id"],
    }


def _load_analysis_files(project_dir: Path) -> list[dict[str, Any]]:
    directory = project_dir / "analysis" / "analyses"
    records: list[dict[str, Any]] = []
    if not directory.exists():
        return records

    seen_ids: set[str] = set()
    for path in sorted(directory.glob("*.json")):
        try:
            artifact = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Skipping unreadable analysis artifact %s: %s", path, exc)
            continue
        if not isinstance(artifact, dict):
            continue

        paper = artifact.get("paper") or {}
        analysis = artifact.get("analysis") or {}
        if not isinstance(paper, dict) or not isinstance(analysis, dict):
            continue
        paper_id = str(paper.get("id") or paper.get("openalex_id") or artifact.get("paper_id") or path.stem).strip()
        if not paper_id or paper_id in seen_ids:
            continue

        text_bundle = _analysis_text_bundle(analysis, paper)
        # Ignore completely empty artifacts; title/abstract alone are still
        # allowed to support a focus comparison when the PDF extraction fields
        # are sparse.
        if not any(value.strip() for value in text_bundle.values()):
            logger.warning("Skipping analysis artifact with no comparable content: %s", path)
            continue
        seen_ids.add(paper_id)
        records.append({
            "paper_id": paper_id,
            "paper": paper,
            "analysis": analysis,
            "artifact_path": str(path.resolve()),
            "text_bundle": text_bundle,
            "bundle": _analysis_bundle(analysis, paper),
        })
    return records


def _gap_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for record in records:
        analysis = record["analysis"]
        for field in ("research_gaps", "limitations", "future_work"):
            for gap in _as_items(_profile_value(analysis, field)):
                text = re.sub(r"\s+", " ", _as_text(gap)).strip()
                if len(text) < 20:
                    continue
                normalized = re.sub(r"[^a-z0-9]+", " ", text.casefold()).strip()
                key = (record["paper_id"], normalized)
                if key in seen:
                    continue
                seen.add(key)
                evidence_items = _field_quotes(analysis, {field}, limit=1)
                evidence = evidence_items[0] if evidence_items else None
                gap_hash = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]
                gaps.append({
                    "id": f"gap_{gap_hash}",
                    "paper_id": record["paper_id"],
                    "text": text,
                    "evidence": evidence,
                    "source": f"explicit_{field}",
                })
    return gaps

def analyze_project(project_dir: str | Path, discovery: dict[str, Any] | None = None) -> dict[str, Any]:
    """Score paper relationships offline and write relationships.json."""
    root = Path(project_dir)
    records = _load_analysis_files(root)
    idf, idf_document_count = _build_idf(records)

    comparisons: list[dict[str, Any]] = []
    inferred_edges: list[dict[str, Any]] = []
    candidate_relationship_count = 0

    for index, first in enumerate(records):
        for second in records[index + 1:]:
            metrics = _compare_pair(first, second, idf)
            candidates = _build_candidates(first, second, metrics)
            candidate_relationship_count += len(candidates)

            legacy_focus = _metric(first["bundle"]["focus"], second["bundle"]["focus"])
            legacy_methods = _metric(first["bundle"]["methods"], second["bundle"]["methods"])
            legacy_gaps = _metric(first["bundle"]["gaps"], second["bundle"]["gaps"])
            comparisons.append({
                "paper_a": first["paper_id"],
                "paper_b": second["paper_id"],
                "focus_similarity": legacy_focus,
                "method_similarity": legacy_methods,
                "gap_similarity": legacy_gaps,
                "scores": metrics,
                "candidate_types": [candidate["type"] for candidate in candidates],
                "category_decisions": metrics.get("category_decisions", {}),
                "comparison_status": "relationships_found" if candidates else "no_candidate",
            })

            for candidate in candidates:
                direction = candidate.get("direction", "a_to_b")
                if candidate["type"] == "potentially_addresses_gap" and direction == "b_to_a":
                    source_id, target_id = second["paper_id"], first["paper_id"]
                else:
                    source_id, target_id = first["paper_id"], second["paper_id"]
                edge = _candidate_edge(source_id, target_id, candidate, first, second, metrics)
                inferred_edges.append(edge)

    unique_edges: dict[str, dict[str, Any]] = {}
    for edge in inferred_edges:
        unique_edges.setdefault(edge["id"], edge)

    gaps = _gap_records(records)
    per_type: Counter[str] = Counter(edge["type"] for edge in unique_edges.values())
    field_coverage = {
        field: sum(bool(record["text_bundle"].get(field, "").strip()) for record in records)
        for field in ("conclusion", "gaps", "methods", "objective", "datasets", "evaluation_metrics", "contributions")
    }
    category_keys = (
        "similar_research_focus", "similar_methodology", "shared_research_gap",
        "potentially_addresses_gap_a_to_b", "potentially_addresses_gap_b_to_a",
        "potentially_conflicting_findings",
    )
    category_statistics = {}
    for category in category_keys:
        decisions = [
            (pair.get("category_decisions") or {}).get(category, {})
            for pair in comparisons
        ]
        category_statistics[category] = {
            "compared_pairs": len(comparisons),
            "eligible_pairs": sum(bool(item.get("eligible")) for item in decisions),
            "passed_pairs": sum(bool(item.get("passed")) for item in decisions),
            "below_threshold_or_evidence_pairs": sum(
                bool(item) and not bool(item.get("passed")) for item in decisions
            ),
        }

    result: dict[str, Any] = {
        "schema_version": "2.2",
        "engine_version": "offline_independent_category_v4",
        "created_at": _now(),
        "project_dir": str(root.resolve()),
        "method": (
            "Five independent offline relationship scorers. Research focus uses problem/objective/conclusion text; "
            "methodology uses method-specific text and a controlled technical taxonomy; shared gaps use only "
            "explicit limitations/future-work/gap text; gap addressing is directional; conflicts require "
            "the same measured outcome with opposing result directions. No LLM, API or embedding service is used."
        ),
        "score_method": "offline_independent_category_scoring_v4",
        "external_ai_required": False,
        "analyzed_paper_count": len(records),
        "pairwise_comparison_count": len(comparisons),
        "candidate_relationship_count": candidate_relationship_count,
        "verification_call_count": 0,
        "verification_accepted_count": 0,
        "verification_unavailable_count": 0,
        "verification_error_count": 0,
        "verification_errors": [],
        "semantic_error_count": 0,
        "inferred_relationship_count": len(unique_edges),
        "relationship_type_counts": dict(per_type),
        "category_statistics": category_statistics,
        "field_coverage": field_coverage,
        "diagnostics": {
            "papers_with_conclusions": field_coverage["conclusion"],
            "papers_with_gaps": field_coverage["gaps"],
            "papers_with_methods": field_coverage["methods"],
            "papers_with_objectives": field_coverage["objective"],
            "papers_with_datasets": field_coverage["datasets"],
            "papers_with_evaluation_metrics": field_coverage["evaluation_metrics"],
            "papers_with_contributions": field_coverage["contributions"],
            "category_statistics": category_statistics,
            "pairs_without_candidates": sum(1 for item in comparisons if not item["candidate_types"]),
            "message": (
                "At least two successfully analyzed papers are required."
                if len(records) < 2 else
                "No pair passed the independent category evidence and score rules; inspect per-category decisions and field coverage."
                if not unique_edges else
                "Candidate relationships were generated. Review their evidence before treating them as scientific claims."
            ),
        },
        "idf_document_count": idf_document_count,
        "thresholds": {
            "focus": _threshold("RELATIONSHIP_FOCUS_THRESHOLD", 0.15),
            "methodology": _threshold("RELATIONSHIP_METHOD_THRESHOLD", 0.20),
            "shared_gap": _threshold("RELATIONSHIP_GAP_THRESHOLD", 0.18),
            "gap_address": _threshold("RELATIONSHIP_GAP_ADDRESS_THRESHOLD", 0.17),
            "conflicting_findings": _threshold("RELATIONSHIP_CONFLICT_THRESHOLD", 0.18),
        },
        "gaps": gaps,
        "comparisons": comparisons,
        "inferred_edges": list(unique_edges.values()),
        "analyzed_papers": [
            {
                "id": record["paper_id"],
                "title": record["paper"].get("title"),
                "artifact_path": record["artifact_path"],
            }
            for record in records
        ],
        "notes": [
            "All relationship scores are heuristic similarity scores, not probabilities.",
            "Each of the five relationship categories has independent fields, evidence requirements and thresholds.",
            "Titles alone cannot produce a research-focus relationship; abstract-only focus matching uses a stricter fallback threshold.",
            "Methodology links require matching methods or recognized technique concepts; shared datasets alone are insufficient.",
            "Shared-gap links require explicit gap/limitation/future-work text in both papers.",
            "Shared-gap scores compare explicit research_gaps, limitations and future_work text.",
            "Potentially-addresses-gap is directional: source paper states the gap; target paper may address it.",
            "Potentially-conflicting-findings requires the same named outcome metric with opposing result directions.",
            "Edges include source-field evidence snippets and require human review.",
            "No OpenAI API, API key, Sentence Transformers model or network call is used by relationship analysis.",
            "With fewer than two analyzed papers, no paper-to-paper comparison can be generated.",
        ],
    }

    output_path = root / "relationships" / "relationships.json"
    write_json(output_path, result)
    result["file"] = str(output_path.resolve())
    return result


def _whiteboard_identifier_aliases(paper_input: dict[str, Any]) -> list[str]:
    """Build normalized scholarly-identifier aliases for whiteboard duplicate checks.

    The whiteboard node ID is a UI identity; this list identifies the underlying
    scholarly work across DOI, PMID, arXiv and OpenAlex representations.
    """
    from discovery.identifiers import parse_research_input

    identifiers = paper_input.get("identifiers") if isinstance(paper_input.get("identifiers"), dict) else {}
    values: list[str] = []
    for key in ("openalex_id", "openAlexId", "doi", "pmid", "arxiv_id", "arxivId", "canonical_id", "canonicalId"):
        value = paper_input.get(key)
        if value not in (None, ""):
            values.append(str(value).strip())
    for key in ("openalex", "doi", "pmid", "arxiv"):
        value = identifiers.get(key)
        if value not in (None, ""):
            values.append(str(value).strip())

    identifier_type = str(paper_input.get("identifier_type") or paper_input.get("identifierType") or "").lower()
    identifier_value = paper_input.get("identifier_value") or paper_input.get("identifierValue")
    if identifier_value:
        values.append(f"{identifier_type}:{identifier_value}" if identifier_type in {"doi", "pmid", "arxiv", "openalex"} else str(identifier_value))

    aliases: set[str] = set()
    for value in values:
        try:
            parsed = parse_research_input(value)
        except ValueError:
            parsed = None
        if parsed and parsed.kind == "doi":
            aliases.add("doi:" + parsed.value.casefold())
        elif parsed and parsed.kind == "openalex":
            aliases.add("openalex:" + parsed.value.upper())
        elif parsed and parsed.kind == "pmid":
            aliases.add("pmid:" + parsed.value)
        elif parsed and parsed.kind == "arxiv":
            # arXiv versions are versions of the same scholarly work.
            aliases.add("arxiv:" + re.sub(r"v\d+$", "", parsed.value, flags=re.IGNORECASE).casefold())
    return sorted(aliases)


def _whiteboard_paper_record(paper_input: dict[str, Any]) -> dict[str, Any]:
    """Normalize a frontend whiteboard paper node into the relationship schema."""
    if not isinstance(paper_input, dict):
        raise ValueError("Each whiteboard paper must be an object.")

    paper_id = _as_text(
        paper_input.get("id") or paper_input.get("paper_id") or paper_input.get("doi")
    ).strip()
    title = _as_text(paper_input.get("title")).strip()
    if not paper_id:
        raise ValueError("Whiteboard paper is missing its id.")
    if not title:
        raise ValueError(f"Whiteboard paper {paper_id!r} is missing its title.")

    nested_analysis = paper_input.get("analysis")
    nested_analysis = dict(nested_analysis) if isinstance(nested_analysis, dict) else {}
    profile = paper_input.get("research_profile") or paper_input.get("researchProfile")
    if isinstance(profile, dict):
        nested_analysis.setdefault("research_profile", profile)

    def pick(*keys: str) -> Any:
        for key in keys:
            value = paper_input.get(key)
            if value not in (None, "", [], {}):
                return value
            value = nested_analysis.get(key)
            if value not in (None, "", [], {}):
                return value
        return ""

    key_insights = pick("keyFindings", "key_findings", "keyInsights", "key_insights")
    conclusion = pick("conclusion", "conclusions")
    if not _as_text(conclusion):
        # Prefer the structured Phase 1 profile's conclusion over the weaker
        # key-insights fallback when a whiteboard node carries a nested profile.
        profile_data = (
            nested_analysis.get("research_profile")
            or nested_analysis.get("researchProfile")
            or profile
            or {}
        )
        profile_fields = profile_data.get("fields", {}) if isinstance(profile_data, dict) else {}
        profile_conclusion = profile_fields.get("conclusion", {}) if isinstance(profile_fields, dict) else {}
        if isinstance(profile_conclusion, dict):
            conclusion = profile_conclusion.get("value", "")
        else:
            conclusion = profile_conclusion
    if not _as_text(conclusion):
        conclusion = key_insights

    analysis = {
        "research_problem": pick("researchProblem", "research_problem"),
        "research_objective": pick("researchObjective", "research_objective", "objective"),
        "research_questions": pick("researchQuestions", "research_questions"),
        "methodology": pick("methodology", "methods"),
        "method_concepts": pick("method_concepts", "methodConcepts"),
        "datasets": pick("datasets", "dataset"),
        "evaluation_metrics": pick("evaluation_metrics", "evaluationMetrics", "metrics"),
        "contributions": pick("contributions", "contribution"),
        "conclusion": conclusion,
        "key_findings": key_insights,
        "research_gaps": pick("researchGaps", "research_gaps", "gaps"),
        "limitations": pick("limitations", "limitationsAndCaveats"),
        "future_work": pick("futureWork", "future_work"),
        "evidence": pick("evidence"),
        "research_profile": nested_analysis.get("research_profile") or nested_analysis.get("researchProfile") or profile,
    }
    paper = {
        "id": paper_id,
        "title": title,
        "abstract": _as_text(pick("abstract", "summary", "description")),
        "authors": _as_text(paper_input.get("authors")),
        "year": paper_input.get("year"),
        "tags": _as_text(paper_input.get("tags")),
    }
    text_bundle = _analysis_text_bundle(analysis, paper)
    return {
        "paper_id": paper_id,
        "identity_aliases": _whiteboard_identifier_aliases(paper_input),
        "paper": paper,
        "analysis": analysis,
        "artifact_path": "whiteboard://memory",
        "text_bundle": text_bundle,
        "bundle": _analysis_bundle(analysis, paper),
    }


def _whiteboard_profile_coverage(record: dict[str, Any]) -> dict[str, Any]:
    """Describe which research fields are present on a whiteboard paper node.

    This is a coverage diagnostic, not a quality score. Existing Phase 1 field
    statuses/evidence are preferred; manually-created nodes are assessed from
    the fields supplied by the user.
    """
    analysis = record.get("analysis") or {}
    profile = analysis.get("research_profile") or analysis.get("researchProfile") or {}
    profile_fields = profile.get("fields") if isinstance(profile, dict) else {}
    field_names = (
        "research_problem", "research_objective", "research_questions",
        "methodology", "method_concepts", "datasets", "evaluation_metrics",
        "contributions", "key_findings", "conclusion", "limitations",
        "future_work", "research_gaps",
    )
    field_details: dict[str, dict[str, Any]] = {}
    counts = Counter()
    for field in field_names:
        value = _profile_value(analysis, field)
        text = _as_text(value).strip()
        profile_item = profile_fields.get(field) if isinstance(profile_fields, dict) else None
        declared_status = profile_item.get("status") if isinstance(profile_item, dict) else None
        if declared_status in {"available", "partial", "missing"}:
            status = declared_status
        elif not text:
            status = "missing"
        elif len(text) >= 35 or len(text.split()) >= 6:
            status = "available"
        else:
            status = "partial"
        evidence = profile_item.get("evidence") or [] if isinstance(profile_item, dict) else []
        raw_evidence = analysis.get("evidence") or []
        if isinstance(raw_evidence, list):
            evidence_count = len([item for item in raw_evidence if isinstance(item, dict) and item.get("field") == field and item.get("quote")])
        else:
            evidence_count = 0
        evidence_count = max(evidence_count, len(evidence) if isinstance(evidence, list) else 0)
        field_details[field] = {
            "status": status,
            "characters": len(text),
            "word_count": len(text.split()),
            "evidence_count": evidence_count,
            "source_sections": profile_item.get("source_sections", []) if isinstance(profile_item, dict) else [],
        }
        counts[status] += 1

    bundle = record.get("text_bundle") or {}
    dimensions = {
        "research_focus": bool(bundle.get("focus_core", "").strip() or len(bundle.get("abstract", "").strip()) >= 80),
        "methodology": len(bundle.get("methods", "").strip()) >= 20,
        "research_gaps": len(bundle.get("gaps", "").strip()) >= 25,
        "contributions": len(bundle.get("contribution_text", "").strip()) >= 25,
        "findings": len(bundle.get("outcomes", "").strip()) >= 20,
        "evaluation_context": bool(bundle.get("evaluation_metrics", "").strip() or bundle.get("datasets", "").strip()),
    }
    weighted_available = counts["available"] + 0.5 * counts["partial"]
    percent = round(100 * weighted_available / len(field_names)) if field_names else 0
    completeness = profile.get("completeness", {}) if isinstance(profile, dict) else {}
    if isinstance(completeness, dict) and isinstance(completeness.get("percent"), (int, float)):
        # The Phase 1 profile's declared coverage is the canonical profile metric.
        percent = int(completeness["percent"])
    return {
        "percent": percent,
        "quality_band": (completeness.get("quality_band") if isinstance(completeness, dict) else None) or (
            "high" if percent >= 75 else "moderate" if percent >= 45 else "sparse"
        ),
        "available_fields": counts["available"],
        "partial_fields": counts["partial"],
        "missing_fields": counts["missing"],
        "total_fields": len(field_names),
        "field_details": field_details,
        "dimensions": dimensions,
        "ready_dimensions": [name for name, ready in dimensions.items() if ready],
        "missing_dimensions": [name for name, ready in dimensions.items() if not ready],
    }


def _whiteboard_category_diagnostics(
    comparisons: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Aggregate pair-level Phase 2 decisions for clear whiteboard feedback."""
    categories = (
        "similar_research_focus",
        "similar_methodology",
        "shared_research_gap",
        "potentially_addresses_gap_a_to_b",
        "potentially_addresses_gap_b_to_a",
        "potentially_conflicting_findings",
    )
    diagnostics: dict[str, dict[str, Any]] = {}
    for category in categories:
        eligible = passed = below_threshold = 0
        reason_counts: Counter[str] = Counter()
        score_values: list[float] = []
        for comparison in comparisons:
            decision = (comparison.get("category_decisions") or {}).get(category) or {}
            if not decision:
                continue
            is_eligible = bool(decision.get("eligible"))
            is_passed = bool(decision.get("passed"))
            eligible += int(is_eligible)
            passed += int(is_passed)
            below_threshold += int(is_eligible and not is_passed)
            score = decision.get("score")
            if isinstance(score, (int, float)):
                score_values.append(float(score))
            for reason in decision.get("reasons") or []:
                reason_counts[str(reason)] += 1
        base_type = "potentially_addresses_gap" if category.startswith("potentially_addresses_gap_") else category
        matching_edges = [edge for edge in edges if edge.get("type") == base_type]
        if category.endswith("_a_to_b"):
            matching_edges = [edge for edge in matching_edges if edge.get("direction", "a_to_b") == "a_to_b"]
        elif category.endswith("_b_to_a"):
            matching_edges = [edge for edge in matching_edges if edge.get("direction", "a_to_b") == "b_to_a"]
        diagnostics[category] = {
            "compared": len(comparisons),
            "eligible": eligible,
            "ineligible": max(0, len(comparisons) - eligible),
            "below_threshold": below_threshold,
            "passed": passed,
            "connections_added": len(matching_edges),
            "mean_score": round(sum(score_values) / len(score_values), 4) if score_values else 0.0,
            "reason_counts": dict(reason_counts.most_common(5)),
        }
    return diagnostics


def _whiteboard_profile_coverage(record: dict[str, Any]) -> dict[str, Any]:
    """Describe which research fields are present on a whiteboard paper node.

    This is a coverage diagnostic, not a quality score. Existing Phase 1 field
    statuses/evidence are preferred; manually-created nodes are assessed from
    the fields supplied by the user.
    """
    analysis = record.get("analysis") or {}
    profile = analysis.get("research_profile") or analysis.get("researchProfile") or {}
    profile_fields = profile.get("fields") if isinstance(profile, dict) else {}
    field_names = (
        "research_problem", "research_objective", "research_questions",
        "methodology", "method_concepts", "datasets", "evaluation_metrics",
        "contributions", "key_findings", "conclusion", "limitations",
        "future_work", "research_gaps",
    )
    field_details: dict[str, dict[str, Any]] = {}
    counts = Counter()
    for field in field_names:
        value = _profile_value(analysis, field)
        text = _as_text(value).strip()
        profile_item = profile_fields.get(field) if isinstance(profile_fields, dict) else None
        declared_status = profile_item.get("status") if isinstance(profile_item, dict) else None
        if declared_status in {"available", "partial", "missing"}:
            status = declared_status
        elif not text:
            status = "missing"
        elif len(text) >= 35 or len(text.split()) >= 6:
            status = "available"
        else:
            status = "partial"
        evidence = profile_item.get("evidence") or [] if isinstance(profile_item, dict) else []
        raw_evidence = analysis.get("evidence") or []
        if isinstance(raw_evidence, list):
            evidence_count = len([item for item in raw_evidence if isinstance(item, dict) and item.get("field") == field and item.get("quote")])
        else:
            evidence_count = 0
        evidence_count = max(evidence_count, len(evidence) if isinstance(evidence, list) else 0)
        field_details[field] = {
            "status": status,
            "characters": len(text),
            "word_count": len(text.split()),
            "evidence_count": evidence_count,
            "source_sections": profile_item.get("source_sections", []) if isinstance(profile_item, dict) else [],
        }
        counts[status] += 1

    bundle = record.get("text_bundle") or {}
    dimensions = {
        "research_focus": bool(bundle.get("focus_core", "").strip() or len(bundle.get("abstract", "").strip()) >= 80),
        "methodology": len(bundle.get("methods", "").strip()) >= 20,
        "research_gaps": len(bundle.get("gaps", "").strip()) >= 25,
        "contributions": len(bundle.get("contribution_text", "").strip()) >= 25,
        "findings": len(bundle.get("outcomes", "").strip()) >= 20,
        "evaluation_context": bool(bundle.get("evaluation_metrics", "").strip() or bundle.get("datasets", "").strip()),
    }
    weighted_available = counts["available"] + 0.5 * counts["partial"]
    percent = round(100 * weighted_available / len(field_names)) if field_names else 0
    completeness = profile.get("completeness", {}) if isinstance(profile, dict) else {}
    if isinstance(completeness, dict) and isinstance(completeness.get("percent"), (int, float)):
        # The Phase 1 profile's declared coverage is the canonical profile metric.
        percent = int(completeness["percent"])
    return {
        "percent": percent,
        "quality_band": (completeness.get("quality_band") if isinstance(completeness, dict) else None) or (
            "high" if percent >= 75 else "moderate" if percent >= 45 else "sparse"
        ),
        "available_fields": counts["available"],
        "partial_fields": counts["partial"],
        "missing_fields": counts["missing"],
        "total_fields": len(field_names),
        "field_details": field_details,
        "dimensions": dimensions,
        "ready_dimensions": [name for name, ready in dimensions.items() if ready],
        "missing_dimensions": [name for name, ready in dimensions.items() if not ready],
    }


def _whiteboard_category_diagnostics(
    comparisons: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Aggregate pair-level Phase 2 decisions for clear whiteboard feedback."""
    categories = (
        "similar_research_focus",
        "similar_methodology",
        "shared_research_gap",
        "potentially_addresses_gap_a_to_b",
        "potentially_addresses_gap_b_to_a",
        "potentially_conflicting_findings",
    )
    diagnostics: dict[str, dict[str, Any]] = {}
    for category in categories:
        eligible = passed = below_threshold = 0
        reason_counts: Counter[str] = Counter()
        score_values: list[float] = []
        for comparison in comparisons:
            decision = (comparison.get("category_decisions") or {}).get(category) or {}
            if not decision:
                continue
            is_eligible = bool(decision.get("eligible"))
            is_passed = bool(decision.get("passed"))
            eligible += int(is_eligible)
            passed += int(is_passed)
            below_threshold += int(is_eligible and not is_passed)
            score = decision.get("score")
            if isinstance(score, (int, float)):
                score_values.append(float(score))
            for reason in decision.get("reasons") or []:
                reason_counts[str(reason)] += 1
        base_type = "potentially_addresses_gap" if category.startswith("potentially_addresses_gap_") else category
        matching_edges = [edge for edge in edges if edge.get("type") == base_type]
        if category.endswith("_a_to_b"):
            matching_edges = [edge for edge in matching_edges if edge.get("direction", "a_to_b") == "a_to_b"]
        elif category.endswith("_b_to_a"):
            matching_edges = [edge for edge in matching_edges if edge.get("direction", "a_to_b") == "b_to_a"]
        diagnostics[category] = {
            "compared": len(comparisons),
            "eligible": eligible,
            "ineligible": max(0, len(comparisons) - eligible),
            "below_threshold": below_threshold,
            "passed": passed,
            "connections_added": len(matching_edges),
            "mean_score": round(sum(score_values) / len(score_values), 4) if score_values else 0.0,
            "reason_counts": dict(reason_counts.most_common(5)),
        }
    return diagnostics


def analyze_paper_against_board(
    new_paper: dict[str, Any],
    existing_papers: list[dict[str, Any]],
    existing_edges: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Compare a newly added whiteboard node against every existing board paper.

    The response includes edges plus pair/category diagnostics and per-paper
    information coverage so the frontend can distinguish a true no-match from
    a comparison that was not possible because fields were missing.
    """
    if not isinstance(existing_papers, list):
        raise ValueError("existing_papers must be a list.")
    if len(existing_papers) > 500:
        raise ValueError("A whiteboard can submit at most 500 existing papers per scan.")

    new_record = _whiteboard_paper_record(new_paper)
    existing_records: list[dict[str, Any]] = []
    seen_ids = {new_record["paper_id"]}
    seen_identifier_aliases = set(new_record.get("identity_aliases") or [])
    duplicate_identifier_paper_count = 0
    for paper in existing_papers:
        record = _whiteboard_paper_record(paper)
        if record["paper_id"] in seen_ids:
            continue
        aliases = set(record.get("identity_aliases") or [])
        if aliases and seen_identifier_aliases.intersection(aliases):
            duplicate_identifier_paper_count += 1
            continue
        seen_ids.add(record["paper_id"])
        seen_identifier_aliases.update(aliases)
        existing_records.append(record)

    new_coverage = _whiteboard_profile_coverage(new_record)
    new_coverage_flags = {
        field: bool(new_record["text_bundle"].get(field, "").strip())
        for field in ("focus_core", "methods", "datasets", "evaluation_metrics", "gaps", "contribution_text")
    }
    if not existing_records:
        return {
            "status": "completed",
            "diagnostics_schema": "2.0",
            "engine_version": "offline_independent_category_v4",
            "new_paper_id": new_record["paper_id"],
            "checked_count": 0,
            "candidate_count": 0,
            "connection_count": 0,
            "connected_paper_count": 0,
            "duplicate_edge_count": 0,
            "duplicate_identifier_paper_count": duplicate_identifier_paper_count,
            "relationship_type_counts": {},
            "edges": [],
            "comparisons": [],
            "category_diagnostics": _whiteboard_category_diagnostics([], []),
            "new_paper_profile_coverage": {**new_coverage_flags, **new_coverage},
            "existing_paper_profile_coverage": [],
            "coverage_summary": {
                "papers_checked": 0,
                "pairs_with_any_eligible_category": 0,
                "pairs_without_eligible_categories": 0,
            },
            "message": "Paper added. There were no distinct existing papers to compare against; add another paper to discover connections.",
        }

    idf, idf_document_count = _build_idf(existing_records + [new_record])
    existing_edge_keys: set[tuple[str, str, str]] = set()
    for edge in existing_edges or []:
        if not isinstance(edge, dict):
            continue
        source = _as_text(edge.get("sourceNodeId") or edge.get("source"))
        target = _as_text(edge.get("targetNodeId") or edge.get("target"))
        relation = _as_text(edge.get("backendRelationType") or edge.get("type") or edge.get("relationType"))
        if source and target and relation:
            existing_edge_keys.add((source, target, relation))

    inferred_edges: list[dict[str, Any]] = []
    comparisons: list[dict[str, Any]] = []
    candidate_count = 0
    duplicate_edge_count = 0
    existing_coverage_rows: list[dict[str, Any]] = []
    for existing in existing_records:
        existing_coverage = _whiteboard_profile_coverage(existing)
        existing_coverage_rows.append({
            "paper_id": existing["paper_id"],
            "title": existing["paper"].get("title"),
            "coverage": existing_coverage,
        })
        # A=existing paper, B=new paper. Thus A->B on gap-addressing means the
        # newly added paper may address a gap already recorded on the board.
        metrics = _compare_pair(existing, new_record, idf)
        candidates = _build_candidates(existing, new_record, metrics)
        candidate_count += len(candidates)
        decisions = metrics.get("category_decisions", {})
        eligible_categories = [name for name, item in decisions.items() if item.get("eligible")]
        passed_categories = [name for name, item in decisions.items() if item.get("passed")]
        if passed_categories:
            comparison_status = "relationships_found"
        elif eligible_categories:
            comparison_status = "eligible_no_threshold_passed"
        else:
            comparison_status = "insufficient_profile_data"
        comparisons.append({
            "paper_id": existing["paper_id"],
            "paper_title": existing["paper"].get("title"),
            "new_paper_id": new_record["paper_id"],
            "candidate_types": [candidate["type"] for candidate in candidates],
            "scores": metrics,
            "category_decisions": decisions,
            "eligible_categories": eligible_categories,
            "passed_categories": passed_categories,
            "comparison_status": comparison_status,
            "existing_paper_profile_coverage": existing_coverage,
        })

        for candidate in candidates:
            relation = str(candidate["type"])
            direction = str(candidate.get("direction", "a_to_b"))
            if relation == "potentially_addresses_gap" and direction == "b_to_a":
                source_id, target_id = new_record["paper_id"], existing["paper_id"]
            else:
                source_id, target_id = existing["paper_id"], new_record["paper_id"]
            edge_key = (source_id, target_id, relation)
            if edge_key in existing_edge_keys:
                duplicate_edge_count += 1
                continue
            edge = _candidate_edge(source_id, target_id, candidate, existing, new_record, metrics)
            edge["board_scan"] = True
            edge["checked_against_paper_id"] = existing["paper_id"]
            inferred_edges.append(edge)
            existing_edge_keys.add(edge_key)

    type_counts = Counter(edge["type"] for edge in inferred_edges)
    connected_ids = {
        edge["source"] if edge["source"] != new_record["paper_id"] else edge["target"]
        for edge in inferred_edges
    }
    count = len(inferred_edges)
    category_diagnostics = _whiteboard_category_diagnostics(comparisons, inferred_edges)
    pairs_with_eligible = sum(1 for row in comparisons if row.get("eligible_categories"))
    pairs_without_eligible = len(comparisons) - pairs_with_eligible

    missing_dimensions = new_coverage["missing_dimensions"]
    if count:
        by_type = ", ".join(
            f"{value} {key.replace('_', ' ')}"
            for key, value in sorted(type_counts.items())
        )
        message = (
            f"Compared the new paper with {len(existing_records)} existing papers and added "
            f"{count} connection(s) across {len(connected_ids)} paper(s). Types: {by_type}."
        )
    elif pairs_without_eligible == len(comparisons):
        message = (
            f"Checked {len(existing_records)} existing papers, but none had enough comparable "
            "research-profile evidence for any relationship category."
        )
    else:
        message = (
            f"Compared the new paper with {len(existing_records)} existing papers. "
            "No new connections passed the independent category-specific evidence and score requirements."
        )
    if missing_dimensions:
        message += " New paper profile is missing comparison information for: " + ", ".join(missing_dimensions) + "."
    if duplicate_edge_count:
        message += f" {duplicate_edge_count} matching edge(s) already existed and were not duplicated."
    if duplicate_identifier_paper_count:
        message += f" Skipped {duplicate_identifier_paper_count} board node(s) that resolve to the same scholarly identifier as the new paper or another duplicate."

    return {
        "status": "completed",
        "diagnostics_schema": "2.0",
        "engine_version": "offline_independent_category_v4",
        "new_paper_id": new_record["paper_id"],
        "checked_count": len(existing_records),
        "candidate_count": candidate_count,
        "connection_count": count,
        "connected_paper_count": len(connected_ids),
        "duplicate_edge_count": duplicate_edge_count,
        "duplicate_identifier_paper_count": duplicate_identifier_paper_count,
        "relationship_type_counts": dict(type_counts),
        "category_diagnostics": category_diagnostics,
        "new_paper_profile_coverage": {**new_coverage_flags, **new_coverage},
        "existing_paper_profile_coverage": existing_coverage_rows,
        "coverage_summary": {
            "papers_checked": len(existing_records),
            "pairs_with_any_eligible_category": pairs_with_eligible,
            "pairs_without_eligible_categories": pairs_without_eligible,
            "new_paper_profile_percent": new_coverage["percent"],
            "new_paper_ready_dimensions": new_coverage["ready_dimensions"],
            "new_paper_missing_dimensions": new_coverage["missing_dimensions"],
        },
        "edges": inferred_edges,
        "comparisons": comparisons,
        "idf_document_count": idf_document_count,
        "message": message,
    }

