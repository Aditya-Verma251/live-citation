# Local research-paper PDF analyzer

This component retrieves legally accessible PDFs from OpenAlex/Unpaywall locations, parses them with PyMuPDF (or an optional configured GROBID service), and uses a deterministic rule-based extractor to produce research objectives, methodology, findings, conclusions, limitations, future work, candidate gaps and evidence snippets.

There is no OpenAI integration, LLM call, API key or embedding model in the supported analyzer pipeline.

## Install

From the backend root:

```bash
python -m pip install -r requirements.txt
```

The analyzer dependency list contains PyMuPDF only. The relationship scorer uses the Python standard library.

## Analyze a discovered-paper JSON file

```bash
python -m analyzer.cli inputs/discovery.json \
  --max-papers 5 \
  --parser pymupdf \
  --extractor rules \
  --out output/analysis \
  --pdf-dir storage/pdfs
```

## Analyze one local PDF

```bash
python -m analyzer.single_pdf /path/to/paper.pdf \
  --parser pymupdf \
  --extractor rules \
  --out output/local_test
```

The extractor is transparent and deterministic. It classifies text using section headings and phrase patterns, and retains snippets with section/page metadata. An empty field means that the heuristic extractor did not confidently identify the information; it does not prove the paper omits it.

## Output schema

Each `analyses/<paper-id>.json` file contains the source paper record, retrieval/parser metadata, and an `analysis` object with:

- `research_problem`
- `research_objective`
- `research_questions`
- `methodology`
- `datasets`
- `key_findings`
- `conclusion`
- `limitations`
- `future_work`
- `research_gaps`
- `evidence`

Research gaps are taken from explicit limitation and future-work material; they are not invented from missing text. Conclusions are populated only when an identifiable conclusion/summary section is found.


## Relationship scoring details

The relationship finder is fully offline. It compares conclusions/key findings, research objectives, title/abstract context, research gaps, limitations, future work, methodology and datasets. Focus similarity weights conclusions at 60%, objectives at 25%, and publication context at 15% when those fields are available. Gap similarity and directional gap-to-contribution comparisons are scored separately. The scorer uses TF-IDF cosine, overlap, Jaccard, phrase features and bidirectional sentence matches. Scores are heuristic similarities, not probabilities; every edge requires researcher review.
