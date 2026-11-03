# Research discovery and relationship analysis backend

This backend discovers academic papers, retrieves legally accessible PDFs, extracts structured research information locally, and builds two separate kinds of graph edges: bibliographic edges from OpenAlex and content-inferred research relationships from an offline lexical scorer.

## No OpenAI or embedding service

The current pipeline is fully local for extraction and relationship analysis. It does **not** call OpenAI, use an API key, load Sentence Transformers, or call an external embedding service. The only external network requests are the research discovery and permitted open-access PDF retrieval stages (OpenAlex / Unpaywall).

Paper content extraction uses the existing deterministic `RuleBasedExtractor`. Paper-to-paper relationship scoring uses project-wide TF-IDF weighted term similarity, token overlap, Jaccard similarity, and adjacent phrase overlap. Conclusions/key findings receive the greatest weight in research-focus comparison; explicit research gaps, limitations, and future work are compared separately. Every inferred edge includes evidence snippets and requires human review.

Scores are heuristic similarity scores, **not probabilities** and not proof of agreement, contradiction, or gap resolution.

## Install (Linux)

```bash
python3 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env
```

Set contact emails for metadata / Unpaywall where appropriate:

```env
UNPAYWALL_EMAIL=you@example.com
CONTACT_EMAIL=you@example.com
```

No OpenAI key, Sentence Transformers model, or other AI service is required.

## Run tests

```bash
# Run all suites from the backend root (the directory containing api.py).
python -m unittest discover -s analyzer/tests -v
python -m unittest discover -s relationships/tests -v
python -m unittest discover -s discovery/tests -v
```

## Run the complete pipeline

```bash
python main.py "RISC-V architecture" \
  --mode keyword \
  --seeds 2 \
  --per-neighborhood 3 \
  --max-discovered 20 \
  --analyze-limit 10 \
  --parser pymupdf \
  --extractor rules
```

Start the API:

```bash
python -m uvicorn api:app --reload --host 127.0.0.1 --port 8000
```

Health endpoint: `http://127.0.0.1:8000/api/health`. It reports `extractor: rules`, `relationship_engine: offline_conclusion_gap_v3`, and `external_ai_required: false`.

## Relationship finder

The relationship engine loads successful analysis artifacts from `output/<project>/analysis/analyses/*.json` and compares every pair of analyzed papers.

| Relationship type | What is compared |
|---|---|
| `similar_research_focus` | Weighted blend of conclusion/key findings, objective/problem, title and abstract. Conclusions receive the greatest weight. |
| `similar_methodology` | Methodology and datasets. |
| `shared_research_gap` | Explicit research gaps, limitations and future work. |
| `potentially_addresses_gap` | A paper's stated gap against the other paper's conclusion, objective and methods; directional. |
| `potentially_conflicting_findings` | Shared conclusion vocabulary plus explicit opposite outcome language. |

Each pair's `relationships.json` comparison includes diagnostic scores (`tfidf_cosine`, overlap, Jaccard, phrase overlap, shared terms), the candidate relationship types, and the threshold values used by the project. This makes it possible to see why a relationship was or was not created.

The scorer combines:

- Whole-field TF-IDF cosine similarity, overlap coefficient, Jaccard and phrase overlap.
- Best-match sentence scoring in both directions so one relevant conclusion/gap sentence is not diluted by a long paper field.
- A 42% whole-field / 58% sentence-match blend for each field score.
- Research-focus scoring weighted 60% to conclusion/key findings, 25% to objectives/questions, and 15% to title/abstract context (missing fields are excluded and the remaining weights are renormalized).
- Gap comparison across research gaps, limitations and future work; gap-addressing is directional and compares a stated gap with the other paper’s conclusion/findings/objective/methods.
- Small, explicit aliases (for example, “machine learning”/“ML”, “large language model”/“LLM”, and “graph neural network”/“GNN”) to reduce avoidable vocabulary mismatches.

Default thresholds can be tuned in `.env`:

```env
OFFLINE_RELATIONSHIP_FOCUS_THRESHOLD=0.09
OFFLINE_RELATIONSHIP_METHOD_THRESHOLD=0.12
OFFLINE_RELATIONSHIP_GAP_THRESHOLD=0.10
OFFLINE_RELATIONSHIP_GAP_ADDRESS_THRESHOLD=0.10
OFFLINE_RELATIONSHIP_CONFLICT_THRESHOLD=0.12
```

Thresholds are starting points and should be evaluated against a representative sample of papers. Lower thresholds yield more candidates but increase false positives. A minimum of two shared informative terms is also required for each candidate.

## Important interpretation limits

- Lexical matching cannot reliably detect synonyms or conceptual relationships expressed with entirely different vocabulary. This deliberately returns to the transparent, offline comparison approach rather than semantic AI.
- `potentially_addresses_gap` means there is textual overlap between a stated gap and another paper's contribution; it does not prove that the gap was solved.
- A conflict candidate uses explicit outcome wording; researchers must check whether the papers use comparable datasets, populations, measures and experimental conditions.
- OpenAlex citations remain separate from content-inferred relationships.
- With fewer than two successfully analyzed papers, there are no paper-to-paper comparisons.
- A publisher/repository HTTP 403/502 or a closed-access result can prevent PDF analysis. The downloader does not bypass paywalls.

## Output files

```text
output/<project_id>/
├── discovery.json
├── analysis_input.json
├── research_summary.json
├── pdfs/
├── analysis/
│   ├── analysis_summary.json
│   ├── parsed/
│   └── analyses/
├── relationships/
│   └── relationships.json
└── knowledge_graph/
    └── graph.json
```
