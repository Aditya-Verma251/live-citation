# Live Citation

**Live Citation** is a research discovery and analysis application. It finds academic papers from a keyword, title, or scholarly identifier, extracts structured research information, identifies candidate relationships, and displays papers and connections on an interactive React whiteboard.

## Project team

AI511 Project:
- Harsh Yadav (2024AIB1006)
- Aditya Verma (2024AIB1002)
- Aditya Jatav (2024AIB1001)

- [Demo video](https://drive.google.com/file/d/1sbrzgzwIKKnkOUJx0O5R_AErYtTk1UwG/view)
- [Presentation](https://drive.google.com/drive/folders/1SyAFUlSJjWoE_Ao_L7Ad2J90nRckjXlW?usp=sharing)
- [Repository](https://github.com/Aditya-Verma251/live-citation)

## Features

- **Paper discovery:** Search OpenAlex by keyword, title, DOI, arXiv ID, PMID, or OpenAlex ID.
- **Identifier resolution:** Normalize scholarly identifiers into canonical paper IDs and use them to prevent duplicate papers. Whiteboard node IDs remain separate from scholarly paper IDs.
- **Open-access retrieval:** Find and download legally available PDFs through OpenAlex and Unpaywall.
- **Research profiles:** Extract objectives, research questions, methods, datasets, metrics, findings, conclusions, limitations, future work, and research gaps. Extracted fields include evidence and information-coverage details where available.
- **Independent relationship analysis:** Compare five relationship types separately:
  1. Similar research focus
  2. Similar methodology
  3. Shared research gaps
  4. Potentially addresses a research gap
  5. Potentially conflicting findings
- **Incremental whiteboard analysis:** When a paper is added to the whiteboard, compare it with the papers already on that board, add qualifying relationship edges, and report connection counts and comparison eligibility.
- **Separate graph types:** Keep bibliographic citation/related-work edges distinct from content-inferred relationship edges.

Relationships are heuristic candidates, not proof of scientific agreement, contradiction, or gap resolution. Review the supporting paper evidence before relying on an inferred connection.

## Project structure

```text
live-citation/
├── backend_h/
│   ├── api.py
│   ├── app.py
│   ├── discovery/
│   ├── analyzer/
│   ├── relationships/
│   ├── knowledge_graph/
│   └── output/
└── research-whiteboard/
    ├── package.json
    └── src/
```

## Requirements

- Python 3.10 or newer
- Node.js and npm
- Internet access for OpenAlex/Unpaywall discovery and open-access PDF retrieval

**OpenAI is not used.** Research extraction and relationship comparison run locally using the rule-based pipeline. No OpenAI API key, embedding service, or vector database is required.

## Run locally

Run the backend and frontend in separate terminals.

### 1. Backend setup

```bash
cd backend_h
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

On Windows PowerShell, activate the environment with:

```powershell
.\.venv\Scripts\Activate.ps1
```

### 2. Configure the backend

Create `.env` in `backend_h/`:

```bash
cp .env.example .env
```

Set the contact details used by the scholarly services:

```env
OPENALEX_API_KEY=
CONTACT_EMAIL=you@example.com
UNPAYWALL_EMAIL=you@example.com

HTTP_TIMEOUT_SECONDS=30
MAX_RETRIES=3
MAX_PDF_MB=50
```

`OPENALEX_API_KEY` is optional for small tests. Configure `UNPAYWALL_EMAIL` for the Unpaywall fallback. Do not commit `.env` or share credentials.

### 3. Start the backend

From `backend_h/`, with the virtual environment active:

```bash
python -m uvicorn api:app --reload --host 127.0.0.1 --port 8000
```

- Health check: <http://127.0.0.1:8000/api/health>
- Interactive API documentation: <http://127.0.0.1:8000/docs>

### 4. Set up and start the frontend

Open a second terminal:

```bash
cd research-whiteboard
npm install
```

Create `.env.local` beside `package.json`:

```env
VITE_RESEARCH_API_URL=http://127.0.0.1:8000
```

Start Vite:

```bash
npm run dev
```

Open the local URL printed by Vite, normally <http://localhost:5173>. Keep both terminal processes running.

If Vite uses a different port, add that exact origin to `FRONTEND_ORIGINS` in the backend `.env`, then restart the backend. For example:

```env
FRONTEND_ORIGINS=http://localhost:5174,http://127.0.0.1:5174
```

## How the backend works

1. **Discovery:** OpenAlex searches for seed papers and retrieves bibliographic metadata, references, citing works, and related works.
2. **Retrieval and parsing:** The downloader checks legal open-access locations. PyMuPDF extracts text and page information from downloaded PDFs.
3. **Research-profile extraction:** The local rule-based extractor creates structured fields and records supporting evidence and field coverage. Missing information is left missing rather than invented.
4. **Relationship analysis:** Each relationship category has its own comparison inputs, eligibility checks, score, and threshold. The output records the reasons a category was or was not eligible.
5. **Knowledge graph:** The graph builder combines citation/related-work edges with inferred relationship edges and research-gap nodes.
6. **Whiteboard scan:** Adding a paper triggers an incremental comparison against the other papers on that board. The response reports papers compared, new connections, category counts, and information coverage.

## Relationship categories

| Relationship | Compared information |
|---|---|
| Similar research focus | Research problems, objectives, questions, conclusions, and findings |
| Similar methodology | Methods, algorithms, experimental designs, datasets, and metrics |
| Shared research gaps | Explicit gaps, limitations, and future-work statements from both papers |
| Potentially addresses a gap | One paper's gap against the other paper's proposed work and findings; directional |
| Potentially conflicting findings | Comparable outcomes with evidence of opposing result directions |

A category is only eligible when the required evidence is present. A missing field is not treated as a negative finding. Similarity scores are not probabilities or scientific confidence levels.

## API overview

Base URL: `http://127.0.0.1:8000`

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Backend status and enabled engine versions |
| `GET` | `/api/projects` | List saved research projects |
| `POST` | `/api/research` | Start a research job |
| `GET` | `/api/jobs/{job_id}` | Check job status and retrieve the resulting project ID |
| `GET` | `/api/projects/{project_id}/summary` | Project summary and processing counts |
| `GET` | `/api/projects/{project_id}/papers` | Discovered papers and processing status |
| `GET` | `/api/projects/{project_id}/papers/{paper_id}` | Paper metadata and extracted analysis |
| `GET` | `/api/projects/{project_id}/graph` | Graph nodes and edges |
| `GET` | `/api/projects/{project_id}/relationships` | Pairwise comparisons and inferred relationships |
| `GET` | `/api/projects/{project_id}/gaps` | Extracted research gaps |
| `POST` | `/api/whiteboard/relationships` | Compare a newly added whiteboard paper with papers already on that board |

`POST /api/research` returns a `job_id`. Poll `GET /api/jobs/{job_id}` until the job completes, then use its `project_id` to load the project results.

## Storage

Project artifacts are stored as JSON files and downloaded PDFs under `backend_h/output/`. The application does not require a relational database or graph database.

## Troubleshooting

### The frontend reports “Failed to fetch”

- Confirm the backend is running and `http://127.0.0.1:8000/api/health` returns HTTP 200.
- Check `VITE_RESEARCH_API_URL` in `research-whiteboard/.env.local`.
- Confirm the browser origin is allowed by backend CORS settings.
- Restart Vite after changing `.env.local`.

### A research run finds papers but analyzes none

Check `analysis/analysis_summary.json` in the project output. A paper may be skipped when no legal open-access PDF is available, or fail because a download or parsing request failed. HTTP 403/502 responses can come from repositories or publishers. The application does not bypass access controls.

### Few relationships are found

Check each paper's research profile and coverage information first. Methodology, gap, and conflict comparisons require specific evidence fields. A category marked ineligible means the available paper data was insufficient; it does not mean the papers were proven unrelated.

Inspect `relationships/relationships.json` for per-pair scores, eligibility, thresholds, evidence, and reasons.

### Duplicate papers appear

Check the paper's canonical scholarly identifier (DOI, arXiv, PMID, or OpenAlex ID) separately from its whiteboard node ID. Different whiteboard nodes can refer to the same scholarly paper; identifier normalization is used to detect duplicates.

## Limitations and responsible use

- The application is intended for local, single-user development. The API has no authentication; do not expose it directly to the public internet.
- Research jobs run as in-process FastAPI background tasks. They may be interrupted if the server stops.
- OpenAlex and Unpaywall metadata can be incomplete. A paper may have a lawful copy not found by the automated lookup.
- Publisher and repository servers may reject automated requests or return temporary errors.
- Rule-based extraction can miss information, especially in scanned PDFs, unusual layouts, or papers with non-standard section headings.
- Relationship edges are candidate links based on extracted text. Verify evidence against the original papers, especially for conflicting findings and research-gap claims.
- A citation does not imply agreement or endorsement.
- The current implementation uses JSON/filesystem storage and is not designed for concurrent multi-user operation.


## References

- [OpenAlex API documentation](https://docs.openalex.org/)
- [Unpaywall API](https://unpaywall.org/products/api)
- [PyMuPDF documentation](https://pymupdf.readthedocs.io/)
- [FastAPI documentation](https://fastapi.tiangolo.com/)
- [React documentation](https://react.dev/)
- [Vite documentation](https://vite.dev/)
- [Excalidraw documentation](https://docs.excalidraw.com/)
