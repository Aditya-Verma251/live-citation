# Research Paper Discovery — MVP 1

This module discovers research papers from a keyword, title, or DOI and builds a small, one-hop citation neighbourhood. It uses the OpenAlex Works API.

## What it does

1. Searches OpenAlex for a keyword/title, or resolves a DOI.
2. Treats the top search result(s) as seed papers.
3. Retrieves a capped sample of each seed's references (`referenced_works`).
4. Retrieves a capped sample of works that cite each seed (`filter=cites:W...`).
5. Retrieves OpenAlex's related-work neighbours (`related_works`).

Incoming citations are sorted newest-first using OpenAlex's explicit `publication_date:desc` syntax.
6. Deduplicates by DOI, falling back to normalized title + publication year.
7. Saves paper metadata and graph edges as JSON.

This is discovery only. It does **not** download PDFs, analyze conclusions, or infer research gaps yet.

## Requirements

- Python 3.10+
- Internet access to `api.openalex.org`
- No pip dependencies for this MVP (standard library only)

## Setup

```powershell
cd paper_discovery_mvp
copy .env.example .env
```

On macOS/Linux, use `cp .env.example .env` instead of `copy`.

Open `.env` and optionally add:

```dotenv
OPENALEX_API_KEY=your_openalex_key_here
CONTACT_EMAIL=your-real-contact-email@example.com
```

**Where to put credentials:** `.env` in the project root, beside `README.md`. Do not put API keys in source code or commit `.env` to Git. OpenAlex basic API use works without a key; a free key raises usage budget and is required for cursor paging beyond the first page. This MVP does not use cursor paging.

## Run a keyword search

```powershell
py -m app.cli "RISC-V architecture" --mode keyword --seeds 1 --per-neighborhood 2 --max-papers 8 --out output/riscv_discovery.json
```

On macOS/Linux, use `python` instead of `py` if that is your Python command.

## Run from a DOI

```powershell
py -m app.cli "10.48550/arXiv.2106.15928" --mode doi --max-papers 10 --out output/doi_discovery.json
```

You may also pass a DOI URL. `--mode auto` detects DOI-shaped input; otherwise it treats the input as a keyword search. For a full paper title, set `--mode title`.

## Run tests without internet

```powershell
py -m unittest discover -s tests -v
```

The tests use a fake OpenAlex client. They verify keyword discovery, DOI mode, edge generation, and abstract reconstruction without depending on API uptime or network access.

## Output format

The output file is a JSON object with:

- `papers`: normalized metadata and OpenAlex IDs
- `edges`: `cites` and `related_to` links
- `seed_paper_ids`: starting paper IDs
- `input_mode`, `paper_count`, `edge_count`, and `created_at`

An edge `{ "source": "W1", "target": "W2", "type": "cites" }` means the source paper cites the target paper. Incoming citations to a seed are represented with the citing paper as the source and the seed as the target.

## Important limitations

- Search is relevance-ranked; a title input is not a guaranteed exact-title resolver. Verify the returned title before downstream analysis.
- Citation matching depends on OpenAlex's reference matching. Missing citation links do not prove there is no citation.
- The graph expands one hop only. `--seeds`, `--per-neighborhood`, and `--max-papers` cap the collection.
- OpenAlex may not provide an abstract, PDF URL, or complete authors for every work.
- Related-work edges are semantic neighbours, not citations.
- The module stores metadata and links only; it does not download full text.

## API references

- OpenAlex API reference: https://help.openalex.org/api/
- OpenAlex citation/reference fields: https://help.openalex.org/data/works/citations/
- OpenAlex filtering recipes (including DOI, `cites`, and batch OpenAlex IDs): https://help.openalex.org/how-to/api-recipes/
- OpenAlex authentication: https://help.openalex.org/api/authentication/

## Where the next backend step plugs in

The next PDF collection/parser service should consume `papers[*].pdf_url` and `papers[*].landing_page_url`, subject to access and license checks. The later paper analyzer should store its results keyed by `papers[*].id`. The relationship analyzer can extend `edges` with evidence-backed semantic relationship types, keeping them distinct from bibliographic citation edges.
