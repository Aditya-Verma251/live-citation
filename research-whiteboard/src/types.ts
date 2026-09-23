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

export interface ResearchPaperNode {
  id: string;
  title: string;
  authors: string;
  year: number | string;
  venue: string;
  arxivId?: string;
  url?: string;
  abstract: string;
  keyInsights: string[];
  tags: string[];
  citationsCount?: number;
  status: PaperStatus;
  color: string; // card accent color
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RelationType =
  | 'cites'
  | 'extends'
  | 'improves'
  | 'contradicts'
  | 'benchmarks'
  | 'theoretical-foundation'
  | 'custom';

export interface ResearchPaperEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: RelationType;
  label?: string;
  style: 'solid' | 'dashed' | 'dotted';
  color: string;
}

export interface ViewTransform {
  x: number;
  y: number;
  zoom: number;
}

export interface DashboardData {
  id: string;
  title: string;
  elements: WhiteboardElement[];
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
