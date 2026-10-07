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

/** Full app node = graph node + display / research metadata. */
export interface ResearchPaperNode extends PaperNode {
  year: number | string;
  venue: string;
  arxivId?: string;
  url?: string;
  keyInsights: string[];
  tags: string[];
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
