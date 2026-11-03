import type { ResearchPaperEdge, ResearchPaperNode } from '../types';

/**
 * Research backend API client.
 *
 * For local development create .env.local in the React project root:
 *   VITE_RESEARCH_API_URL=http://127.0.0.1:8000
 * Restart Vite after changing the environment file.
 */

export type ResearchInputMode = 'keyword' | 'paper';

export interface ResearchInput {
  mode: ResearchInputMode;
  value: string;
}

export interface ResearchJobStart {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | string;
}

export interface ResearchJobState {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | string;
  project_id?: string;
  error?: string;
  result?: unknown;
}

export interface CompletedResearchJob extends ResearchJobState {
  status: 'completed';
  project_id: string;
}

const configuredBaseUrl = String(
  (import.meta as any).env?.VITE_RESEARCH_API_URL ?? ''
).trim();

// An explicit local default prevents requests silently going to the Vite server.
const API_BASE_URL = (configuredBaseUrl || 'http://127.0.0.1:8000').replace(/\/$/, '');

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    const original = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot reach the research backend at ${url}. ` +
      `Check that FastAPI is running on port 8000 and that its CORS allowlist includes this React origin. ` +
      `Browser detail: ${original}`
    );
  }

  const raw = await response.text();
  let payload: any = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }

  if (!response.ok) {
    const detail = typeof payload === 'string'
      ? payload
      : payload?.detail || payload?.message || payload?.error || response.statusText;
    throw new Error(`Research API (${response.status}) at ${url}: ${detail || 'Request failed'}`);
  }

  return payload as T;
}

/**
 * Start a background research job.
 * Paper mode requests exact-title resolution. The backend overrides title mode when
 * the value is a recognized DOI, arXiv, OpenAlex or PubMed identifier.
 */
export function startResearch(input: ResearchInput): Promise<ResearchJobStart> {
  const backendMode = input.mode === 'keyword' ? 'keyword' : 'title';
  return requestJson<ResearchJobStart>('/api/research', {
    method: 'POST',
    body: JSON.stringify({
      mode: backendMode,
      query: input.value.trim(),
      seeds: 2,
      per_neighborhood: 3,
      max_discovered: 20,
      analyze_limit: 10,
      parser: 'pymupdf',
      extractor: 'rules',
    }),
  });
}

export function getResearchJob(jobId: string): Promise<ResearchJobState> {
  return requestJson<ResearchJobState>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

/** Poll the background job until it succeeds or fails. */
export async function waitForResearchJob(
  jobId: string,
  options: { intervalMs?: number; timeoutMs?: number; onStatus?: (job: ResearchJobState) => void } = {},
): Promise<CompletedResearchJob> {
  const intervalMs = options.intervalMs ?? 1800;
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const job = await getResearchJob(jobId);
    options.onStatus?.(job);

    if (job.status === 'completed') {
      if (!job.project_id) {
        throw new Error(`Research job ${jobId} completed but the backend did not return project_id.`);
      }
      return job as CompletedResearchJob;
    }

    if (job.status === 'failed') {
      throw new Error(job.error || `Research job ${jobId} failed. Check the backend terminal for details.`);
    }

    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }

  throw new Error(`Research job ${jobId} is still running after ${Math.round(timeoutMs / 60000)} minutes. Check the backend job status before retrying.`);
}

/** Convenience function used by the Create Dashboard flow. */
export async function startResearchAndWait(
  input: ResearchInput,
  onStatus?: (job: ResearchJobState) => void,
): Promise<CompletedResearchJob> {
  const started = await startResearch(input);
  if (!started?.job_id) {
    throw new Error('The backend did not return job_id from POST /api/research. Check that the React app is connected to the expected FastAPI backend.');
  }
  return waitForResearchJob(started.job_id, { onStatus });
}

export function getProjectData(projectId: string) {
  const id = encodeURIComponent(projectId);
  const get = (suffix: string) => requestJson<any>(`/api/projects/${id}/${suffix}`);

  return Promise.all([
    get('summary'),
    get('papers'),
    // graph.json is required: it is the backend's canonical source for all paper nodes and
    // citation/inferred edges. Do not silently create an edge-less dashboard when it fails.
    get('graph'),
    // graph.json already contains inferred edges; this endpoint enriches older schemas/fallbacks.
    get('relationships').catch(() => null),
    get('gaps').catch(() => null),
  ]).then(([summary, papers, graph, relationships, gaps]) => ({
    summary,
    papers,
    graph,
    relationships,
    gaps,
  }));
}

export interface WhiteboardCategoryDiagnostic {
  compared: number;
  eligible: number;
  ineligible: number;
  below_threshold: number;
  passed: number;
  connections_added: number;
  mean_score: number;
  reason_counts: Record<string, number>;
}

export interface WhiteboardProfileCoverage {
  percent: number;
  quality_band: string;
  available_fields: number;
  partial_fields: number;
  missing_fields: number;
  total_fields: number;
  field_details: Record<string, {
    status: 'available' | 'partial' | 'missing' | string;
    characters: number;
    word_count: number;
    evidence_count: number;
    source_sections: string[];
  }>;
  dimensions: Record<string, boolean>;
  ready_dimensions: string[];
  missing_dimensions: string[];
}

export interface WhiteboardRelationshipScanResult {
  status: 'completed';
  diagnostics_schema?: string;
  engine_version?: string;
  new_paper_id: string;
  checked_count: number;
  candidate_count: number;
  connection_count: number;
  connected_paper_count?: number;
  duplicate_edge_count?: number;
  duplicate_identifier_paper_count?: number;
  relationship_type_counts?: Record<string, number>;
  category_diagnostics?: Record<string, WhiteboardCategoryDiagnostic>;
  new_paper_profile_coverage?: Record<string, any> & WhiteboardProfileCoverage;
  existing_paper_profile_coverage?: Array<{ paper_id: string; title?: string; coverage: WhiteboardProfileCoverage }>;
  coverage_summary?: {
    papers_checked: number;
    pairs_with_any_eligible_category: number;
    pairs_without_eligible_categories: number;
    new_paper_profile_percent: number;
    new_paper_ready_dimensions: string[];
    new_paper_missing_dimensions: string[];
  };
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    kind?: string;
    score: number;
    confidence_label?: string;
    shared_terms?: string[];
    shared_term_count?: number;
    explanation?: string;
    evidence?: unknown;
    requires_human_review?: boolean;
    direction?: string;
  }>;
  comparisons?: Array<Record<string, any>>;
  message: string;
}

/**
 * Compare one newly added paper against every paper already on the active
 * whiteboard. This is an incremental local-rule scan; it does not start a new
 * literature-discovery project or recompare existing paper pairs.
 */
export function findWhiteboardRelationships(
  newPaper: ResearchPaperNode,
  existingPapers: ResearchPaperNode[],
  existingEdges: ResearchPaperEdge[] = [],
): Promise<WhiteboardRelationshipScanResult> {
  const serializePaper = (paper: ResearchPaperNode) => ({
    id: paper.id,
    canonical_id: paper.canonicalId,
    doi: paper.doi,
    arxiv_id: paper.arxivId,
    pmid: paper.pmid,
    openalex_id: paper.openAlexId,
    identifier_type: paper.identifierType,
    identifier_value: paper.identifierValue,
    identifiers: paper.identifiers,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    abstract: paper.abstract,
    keyInsights: paper.keyInsights,
    keyFindings: paper.keyFindings,
    conclusion: paper.conclusion,
    researchProblem: paper.researchProblem,
    researchObjective: paper.researchObjective,
    researchQuestions: paper.researchQuestions,
    researchGaps: paper.researchGaps,
    limitations: paper.limitations,
    futureWork: paper.futureWork,
    methodology: paper.methodology,
    method_concepts: paper.methodConcepts,
    datasets: paper.datasets,
    evaluation_metrics: paper.evaluationMetrics,
    contributions: paper.contributions,
    tags: paper.tags,
    research_profile: paper.researchProfile,
    research_profile_completeness: paper.researchProfileCompleteness,
  });

  return requestJson<WhiteboardRelationshipScanResult>('/api/whiteboard/relationships', {
    method: 'POST',
    body: JSON.stringify({
      new_paper: serializePaper(newPaper),
      existing_papers: existingPapers.map(serializePaper),
      // Only identity/type fields are needed for server-side de-duplication.
      existing_edges: existingEdges
        .filter((edge) => Boolean(edge.backendRelationType))
        .map((edge) => ({
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          backendRelationType: edge.backendRelationType,
        })),
    }),
  });
}

