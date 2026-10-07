/**
 * Pure graph operations - the ONLY place graph state is mutated.
 * No React, no Excalidraw. Every function takes a graph and returns a new one (never mutates),
 * so the React state stays the single source of truth and the canvas just re-renders from it.
 */
import type { EdgeMetadata, PaperEdge, RelationType, ResearchPaperEdge, ResearchPaperNode } from "../types";

export interface GraphState {
  nodes: ResearchPaperNode[];
  edges: ResearchPaperEdge[];
}

export const RELATION_LABELS: Record<RelationType, string> = {
  extends: "Extends",
  improves: "Improves",
  cites: "Cites",
  contradicts: "Contradicts",
  benchmarks: "Benchmarks",
  "theoretical-foundation": "Foundation",
  custom: "Related",
};

/** Free-text label ("Cites", "builds upon", "challenges"...) -> relation type. Unknown text -> 'custom'. */
export const inferRelationType = (label: string): RelationType => {
  const l = label.trim().toLowerCase();
  if (!l) return "custom";
  if (/^(cite|cites|cited|reference|references)/.test(l)) return "cites";
  if (/^(extend|extends|builds)/.test(l)) return "extends";
  if (/^(improve|improves|optimi)/.test(l)) return "improves";
  if (/^(contradict|challenge|refute|disagree)/.test(l)) return "contradicts";
  if (/^benchmark/.test(l)) return "benchmarks";
  if (/(foundation|theor)/.test(l)) return "theoretical-foundation";
  return "custom";
};

export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/* ---------------------------------- nodes ---------------------------------- */

export interface NewNodeInput {
  title: string;
  authors: string;
  abstract: string;
  /** Optional. When both are given the node is placed there, otherwise the app picks a free spot. */
  x?: number;
  y?: number;
}

/** Builds a complete node from the minimal form input (sensible defaults for the research metadata). */
export const createNode = (input: NewNodeInput, pos: { x: number; y: number }): ResearchPaperNode => ({
  id: newId("paper"),
  title: input.title.trim() || "Untitled paper",
  authors: input.authors.trim() || "Unknown authors",
  abstract: input.abstract.trim(),
  x: Math.round(pos.x),
  y: Math.round(pos.y),
  year: new Date().getFullYear(),
  venue: "Unpublished",
  keyInsights: [],
  tags: [],
  status: "to-read",
  color: "#4f46e5",
});

export const addNode = (g: GraphState, node: ResearchPaperNode): GraphState =>
  g.nodes.some((n) => n.id === node.id) ? g : { ...g, nodes: [...g.nodes, node] };

/** Deleting a node also deletes every edge touching it, so no edge can dangle. */
export const removeNodes = (g: GraphState, ids: string[]): GraphState => {
  const gone = new Set(ids);
  return {
    nodes: g.nodes.filter((n) => !gone.has(n.id)),
    edges: g.edges.filter((e) => !gone.has(e.sourceNodeId) && !gone.has(e.targetNodeId)),
  };
};

export const updateNode = (g: GraphState, updated: ResearchPaperNode): GraphState => ({
  ...g,
  nodes: g.nodes.map((n) => (n.id === updated.id ? updated : n)),
});

/* ---------------------------------- edges ---------------------------------- */

/** Why an edge can't be created (null = fine). Used by the sidebar to disable its button. */
export const edgeProblem = (
  g: { nodes: { id: string }[]; edges: PaperEdge[] },
  sourceNodeId: string,
  targetNodeId: string,
  label?: string
): string | null => {
  if (!sourceNodeId || !targetNodeId) return "Pick a source and a target";
  if (sourceNodeId === targetNodeId) return "Source and target must differ";
  if (!g.nodes.some((n) => n.id === sourceNodeId) || !g.nodes.some((n) => n.id === targetNodeId))
    return "Unknown node";
  const l = (label ?? "").trim().toLowerCase();
  if (g.edges.some((e) => e.sourceNodeId === sourceNodeId && e.targetNodeId === targetNodeId && (e.label ?? "").toLowerCase() === l))
    return "That connection already exists";
  return null;
};

export const addEdge = (g: GraphState, meta: EdgeMetadata): GraphState => {
  if (edgeProblem(g, meta.sourceNodeId, meta.targetNodeId, meta.label)) return g;
  const edge: ResearchPaperEdge = {
    id: newId("edge"),
    sourceNodeId: meta.sourceNodeId,
    targetNodeId: meta.targetNodeId,
    relationType: meta.relationType,
    label: meta.label?.trim() || RELATION_LABELS[meta.relationType],
    description: meta.description,
  };
  return { ...g, edges: [...g.edges, edge] };
};

export const removeEdges = (g: GraphState, ids: string[]): GraphState => {
  const gone = new Set(ids);
  return { ...g, edges: g.edges.filter((e) => !gone.has(e.id)) };
};
