"""Small, deterministic terminology taxonomies for offline paper comparison.

This is not a semantic model. It canonicalizes common technical names and
metrics so equivalent spellings/acronyms can be compared consistently.
"""
from __future__ import annotations

import re
from typing import Iterable

METHOD_CONCEPTS: dict[str, tuple[str, ...]] = {
    "convolutional_neural_network": ("cnn", "cnns", "convolutional neural network", "convnet", "convolution network"),
    "recurrent_neural_network": ("rnn", "rnns", "recurrent neural network"),
    "long_short_term_memory": ("lstm", "long short term memory", "long short-term memory"),
    "gated_recurrent_unit": ("gru", "gated recurrent unit"),
    "transformer": ("transformer", "transformer architecture", "self attention", "self-attention", "multi head attention", "multi-head attention"),
    "bert": ("bert", "bidirectional encoder representations from transformers"),
    "roberta": ("roberta", "robustly optimized bert pretraining"),
    "gpt": ("gpt", "generative pre trained transformer", "generative pre-trained transformer"),
    "t5": ("t5", "text to text transfer transformer"),
    "bart": ("bart", "bidirectional and auto regressive transformers"),
    "word2vec": ("word2vec", "word2 vec"),
    "glove_embeddings": ("glove embeddings", "global vectors for word representation"),
    "fasttext": ("fasttext", "fast text embeddings"),
    "resnet": ("resnet", "residual neural network"),
    "unet": ("unet", "u net", "u-net"),
    "vision_transformer": ("vision transformer", "vit"),
    "yolo": ("yolo", "you only look once"),
    "graph_neural_network": ("gnn", "gnns", "graph neural network", "graph neural networks"),
    "graph_convolutional_network": ("gcn", "gcns", "graph convolutional network"),
    "support_vector_machine": ("svm", "support vector machine", "support vector machines"),
    "random_forest": ("random forest", "random forests", "random forest classifier"),
    "decision_tree": ("decision tree", "decision trees"),
    "gradient_boosting": ("gradient boosting", "xgboost", "lightgbm", "catboost"),
    "k_nearest_neighbors": ("knn", "k nearest neighbor", "k nearest neighbors", "nearest-neighbor classifier"),
    "naive_bayes": ("naive bayes", "naive bayes classifier"),
    "logistic_regression": ("logistic regression",),
    "linear_regression": ("linear regression",),
    "reinforcement_learning": ("rl", "reinforcement learning"),
    "federated_learning": ("federated learning", "federated averaging", "fedavg"),
    "transfer_learning": ("transfer learning", "domain adaptation"),
    "fine_tuning": ("fine tuning", "fine-tuning", "instruction tuning", "parameter efficient fine tuning", "peft"),
    "contrastive_learning": ("contrastive learning", "contrastive loss", "info nce", "infonce"),
    "knowledge_distillation": ("knowledge distillation", "teacher student distillation", "model distillation"),
    "dense_retrieval": ("dense retrieval", "dense passage retrieval", "dual encoder", "bi encoder", "biencoder"),
    "sparse_retrieval": ("sparse retrieval", "bm25", "best matching 25", "tf idf", "term frequency inverse document frequency"),
    "retrieval_augmented_generation": ("rag", "retrieval augmented generation", "retrieval-augmented generation"),
    "clustering": ("clustering", "k means", "k-means", "hierarchical clustering", "dbscan"),
    "topic_modeling": ("topic modeling", "topic modelling", "latent dirichlet allocation", "lda"),
    "principal_component_analysis": ("pca", "principal component analysis"),
    "meta_analysis": ("meta analysis", "meta-analysis", "systematic review and meta analysis"),
    "systematic_review": ("systematic review", "systematic literature review"),
    "randomized_controlled_trial": ("randomized controlled trial", "randomised controlled trial", "rct"),
    "cohort_study": ("cohort study", "prospective cohort", "retrospective cohort"),
    "clinical_trial": ("clinical trial", "clinical trials"),
    "survival_analysis": ("survival analysis", "time to event analysis", "time-to-event analysis"),
    "cox_regression": ("cox regression", "cox proportional hazards", "proportional hazards model"),
    "kaplan_meier": ("kaplan meier", "kaplan-meier"),
    "propensity_score_matching": ("propensity score matching", "propensity score matched"),
    "difference_in_differences": ("difference in differences", "diff in diff", "did estimator"),
    "structural_equation_modeling": ("structural equation modeling", "structural equation modelling", "sem model"),
    "factor_analysis": ("factor analysis", "exploratory factor analysis", "confirmatory factor analysis"),
    "anova": ("anova", "analysis of variance"),
    "pearson_correlation": ("pearson correlation", "pearson's correlation"),
    "spearman_correlation": ("spearman correlation", "spearman's rank correlation"),
    "case_control_study": ("case control study", "case-control study"),
    "cross_sectional_study": ("cross sectional study", "cross-sectional study"),
    "qualitative_interviews": ("semi structured interview", "semi-structured interview", "qualitative interview", "in depth interview"),
    "thematic_analysis": ("thematic analysis", "reflexive thematic analysis"),
    "content_analysis": ("content analysis",),
    "ablation_study": ("ablation study", "ablation experiment", "component ablation"),
}

DATASET_CONCEPTS: dict[str, tuple[str, ...]] = {
    "natural_questions": ("natural questions", "nq dataset"),
    "triviaqa": ("triviaqa", "trivia qa"),
    "squad": ("squad", "stanford question answering dataset"),
    "glue": ("glue benchmark", "general language understanding evaluation"),
    "super_glue": ("superglue", "super glue benchmark"),
    "mnist": ("mnist", "modified national institute of standards and technology"),
    "cifar10": ("cifar 10", "cifar-10"),
    "cifar100": ("cifar 100", "cifar-100"),
    "imagenet": ("imagenet", "image net"),
    "pubmed": ("pubmed", "pubmed abstracts"),
    "mimic": ("mimic iii", "mimic-iii", "mimic iv", "mimic-iv"),
    "conll": ("conll", "conll 2003", "conll-2003"),
    "ontonotes": ("ontonotes", "ontonotes 5.0"),
    "squad2": ("squad 2", "squad 2.0", "squad2"),
    "ms_marco": ("ms marco", "ms-marco"),
    "beir": ("beir benchmark", "beir"),
    "wikitext": ("wikitext", "wiki text"),
    "common_crawl": ("common crawl", "commoncrawl"),
    "wikipedia": ("wikipedia", "wiki dump"),
    "arxiv": ("arxiv corpus", "arxiv dataset"),
}

METRIC_CONCEPTS: dict[str, tuple[str, ...]] = {
    "accuracy": ("accuracy", "classification accuracy"),
    "precision": ("precision", "positive predictive value"),
    "recall": ("recall", "sensitivity", "true positive rate"),
    "f1": ("f1", "f1 score", "f measure", "f-measure"),
    "auc": ("auc", "roc auc", "area under the curve", "auroc"),
    "latency": ("latency", "response time", "inference time", "end to end delay"),
    "runtime": ("runtime", "execution time", "computation time"),
    "memory": ("memory usage", "memory consumption", "memory footprint"),
    "energy": ("energy consumption", "energy use", "power consumption"),
    "cost": ("cost", "computational cost", "operational cost"),
    "error_rate": ("error rate", "error", "failure rate"),
    "loss": ("loss", "loss value", "objective value"),
    "throughput": ("throughput", "tokens per second", "requests per second"),
    "robustness": ("robustness", "adversarial robustness"),
    "calibration": ("calibration error", "expected calibration error", "ece"),
    "bleu": ("bleu", "bleu score"),
    "rouge": ("rouge", "rouge l", "rouge-l"),
    "map": ("mean average precision", "map score"),
    "mse": ("mean squared error", "mse"),
    "rmse": ("root mean squared error", "rmse"),
    "mae": ("mean absolute error", "mae"),
    "pearson_r": ("pearson r", "pearson correlation coefficient"),
    "ndcg": ("ndcg", "normalized discounted cumulative gain"),
    "mrr": ("mrr", "mean reciprocal rank"),
}

# Lower values are generally desirable for these outcomes. Other metrics use
# higher-is-better as the default. This is only used to interpret outcome verbs.
LOWER_IS_BETTER = {
    "latency", "runtime", "memory", "energy", "cost", "error_rate", "loss",
    "calibration",
}


def _compile_aliases(groups: dict[str, tuple[str, ...]]) -> list[tuple[re.Pattern[str], str]]:
    compiled: list[tuple[re.Pattern[str], str]] = []
    for canonical, variants in groups.items():
        for variant in sorted(set((canonical, *variants)), key=len, reverse=True):
            escaped = re.escape(variant).replace(r"\ ", r"\s+")
            compiled.append((re.compile(rf"(?<![A-Za-z0-9]){escaped}(?![A-Za-z0-9])", re.I), canonical))
    return sorted(compiled, key=lambda item: len(item[0].pattern), reverse=True)


_METHOD_PATTERNS = _compile_aliases(METHOD_CONCEPTS)
_DATASET_PATTERNS = _compile_aliases(DATASET_CONCEPTS)
_METRIC_PATTERNS = _compile_aliases(METRIC_CONCEPTS)
_ALL_PATTERNS = _compile_aliases({**METHOD_CONCEPTS, **DATASET_CONCEPTS, **METRIC_CONCEPTS})


def normalize_domain_phrases(text: str) -> str:
    """Normalize common abbreviations and long-form technical phrases."""
    normalized = text or ""
    # Specific aliases are replaced before generic tokenization. Canonical
    # names are stable identifiers (underscored tokens).
    for pattern, canonical in _ALL_PATTERNS:
        normalized = pattern.sub(canonical, normalized)
    return normalized


def extract_concepts(text: str, category: str = "method") -> set[str]:
    patterns = {
        "method": _METHOD_PATTERNS,
        "dataset": _DATASET_PATTERNS,
        "metric": _METRIC_PATTERNS,
    }.get(category)
    if patterns is None:
        raise ValueError(f"Unknown taxonomy category: {category}")
    source = text or ""
    return {canonical for pattern, canonical in patterns if pattern.search(source)}


def extract_outcome_metrics(text: str) -> set[str]:
    return extract_concepts(text, "metric")


def taxonomy_similarity(left: Iterable[str], right: Iterable[str]) -> dict[str, object]:
    left_set, right_set = set(left), set(right)
    shared = sorted(left_set & right_set)
    union = left_set | right_set
    smaller = min(len(left_set), len(right_set))
    return {
        "score": round(len(shared) / smaller, 4) if smaller else 0.0,
        "jaccard": round(len(shared) / len(union), 4) if union else 0.0,
        "shared_concepts": shared,
        "left_concepts": sorted(left_set),
        "right_concepts": sorted(right_set),
    }
