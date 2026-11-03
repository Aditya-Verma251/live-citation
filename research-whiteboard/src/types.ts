export type ToolType =
  | 'select'
  | 'hand'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'draw'
  | 'text'
  | 'eraser'
  | 'paper-node';

export type FillStyle = 'hachure' | 'cross-hatch' | 'solid' | 'dots' | 'none';

export interface Point {
  x: number;
  y: number;
}

export interface WhiteboardElement {
  id: string;
  type: 'rectangle' | 'diamond' | 'ellipse' | 'line' | 'arrow' | 'draw' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  points?: Point[];
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  roughness: number;
  fillStyle: FillStyle;
  opacity: number;
  text?: string;
  fontSize?: number;
  fontFamily?: 'handwritten' | 'sans' | 'mono';
  angle?: number;
}

export type PaperStatus = 'to-read' | 'reading' | 'read' | 'seminal';

/*
 * GRAPH MODEL - the single source of truth.
 * These types know nothing about Excalidraw (no element ids, bindings, groups or lock flags).
 * The adapter (utils/excalidrawAdapter.ts) translates them into Excalidraw elements, one-way.
 */

/** Minimal graph node: what the graph itself needs. */
export interface PaperNode {
  id: string;
  title: string;
  authors: string;
  abstract: string;
  /** Top-left of the node's point (ellipse) in scene coordinates. */
  x: number;
  y: number;
}

export interface ResearchProfileEvidence {
  quote: string;
  section?: string;
  page_start?: number;
  page_end?: number;
  source?: string;
}

export interface ResearchProfileField {
  value?: unknown;
  status?: 'available' | 'partial' | 'missing' | string;
  confidence?: string;
  source_sections?: string[];
  evidence?: ResearchProfileEvidence[];
  value_count?: number;
}

export interface ResearchProfile {
  schema_version?: string;
  fields?: Record<string, ResearchProfileField>;
  dimensions?: Record<string, { ready?: boolean; coverage?: number; available_fields?: string[]; partial_fields?: string[]; missing_fields?: string[] }>;
  completeness?: {
    percent?: number;
    coverage?: number;
    quality_band?: string;
    available_fields?: number;
    partial_fields?: number;
    missing_fields?: number;
    total_fields?: number;
    missing_field_names?: string[];
  };
  document?: Record<string, unknown>;
}

/** Full app node = graph node + display / research metadata. */
export interface ResearchPaperNode extends PaperNode {
  year: number | string;
  venue: string;
  arxivId?: string;
  /** Stable scholarly identity (OpenAlex WID preferred; DOI/PMID/arXiv fallback). Separate from the UI node id. */
  canonicalId?: string;
  doi?: string;
  pmid?: string;
  openAlexId?: string;
  identifiers?: Partial<Record<'doi' | 'arxiv' | 'openalex' | 'pmid', string>>;
  identifierType?: 'doi' | 'arxiv' | 'openalex' | 'pmid' | 'title' | string;
  identifierValue?: string;
  url?: string;
  keyInsights: string[];
  tags: string[];
  /** Optional research-analysis fields used for automatic whiteboard matching. */
  conclusion?: string;
  keyFindings?: string[] | string;
  researchProblem?: string;
  researchObjective?: string;
  researchQuestions?: string[] | string;
  researchGaps?: string[] | string;
  limitations?: string[] | string;
  futureWork?: string[] | string;
  methodology?: string;
  methodConcepts?: string[] | string;
  datasets?: string[] | string;
  evaluationMetrics?: string[] | string;
  contributions?: string[] | string;
  /** Full Phase 1 normalized extraction, retained for Phase 2 comparisons. */
  researchProfile?: ResearchProfile;
  researchProfileCompleteness?: ResearchProfile['completeness'];
  citationsCount?: number;
  status: PaperStatus;
  color: string; // accent colour of the point
  /** @deprecated Legacy card size. Nodes are points now; kept optional so saved boards still load. */
  width?: number;
  height?: number;
}

export type RelationType =
  | 'cites'
  | 'extends'
  | 'improves'
  | 'contradicts'
  | 'benchmarks'
  | 'theoretical-foundation'
  | 'custom';

/** Minimal graph edge. `relationType` + `label` drive how the arrow is styled. */
export interface PaperEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: RelationType;
  /** Text drawn on the arrow (e.g. "Cites"). */
  label?: string;
}

/** Full app edge. How it is drawn (colour, dashes) is derived from `relationType` by the adapter. */
export interface ResearchPaperEdge extends PaperEdge {
  /** Free-text note about why the two papers are connected. */
  description?: string;
  /** Source bucket from the backend graph: bibliographic citations or inferred relationships. */
  graphKind?: 'citation' | 'identified';
  /** Original backend edge type, preserved for labels, filters and styling. */
  backendRelationType?: string;
  backendEdgeKind?: string;
  score?: number;
  confidenceLabel?: string;
  requiresHumanReview?: boolean;
  sharedTerms?: string[];
  evidence?: unknown;
}

/** Input for creating an edge. */
export interface EdgeMetadata {
  sourceNodeId: string;
  targetNodeId: string;
  relationType: RelationType;
  /** Text drawn on the arrow. Falls back to the relation type's default label. */
  label?: string;
  description?: string;
}

export interface ViewTransform {
  x: number;
  y: number;
  zoom: number;
}

export interface DashboardData {
  id: string;
  title: string;
  /** Legacy seed shapes (banners, group backdrops). Converted to Excalidraw once. */
  elements: WhiteboardElement[];
  /** Everything the user draws freely in Excalidraw (non-paper elements), saved as-is. */
  sceneElements?: any[];
  /** Bump to force the canvas to remount (used after importing JSON). */
  revision?: number;
  paperNodes: ResearchPaperNode[];
  paperEdges: ResearchPaperEdge[];
  viewTransform: ViewTransform;
  gridType: 'dots' | 'grid' | 'none';
  updatedAt: string;
  /** Raw research API metadata retained with dashboards created from the backend. */
  researchProjectId?: string;
  /** Which of the two backend-generated research graph views is currently selected. */
  researchGraphView?: 'citations' | 'relationships';
  researchSummary?: unknown;
  researchGaps?: unknown;
}

export interface FileItem {
  id: string;
  name: string;
  isFolder: boolean;
  parentId: string | null;
  dashboardId?: string; // only if isFolder is false
  colorTag?: string;
}

export interface TabItem {
  id: string; // tab id (corresponds to dashboardId)
  fileId: string;
  title: string;
  isDirty?: boolean;
}
