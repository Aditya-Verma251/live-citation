import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { inferRelationType } from "./graphOps";
import type {
  ResearchPaperNode,
  ResearchPaperEdge,
  WhiteboardElement,
  RelationType,
  Point,
} from "../types";

/**
 * ADAPTER: graph (React state) -> Excalidraw elements.
 * Node elements (point + title) are UNLOCKED so users can drag them. Edge elements (arrow + its label)
 * are LOCKED: they can't be selected, dragged, resized or deleted by hand and only ever move because a
 * node moved (see relayoutEdges / enforceEdgeState). The only thing the canvas writes back is node
 * POSITIONS (WhiteboardCanvas.onChange). Structural edits (add / delete nodes and edges) happen only in
 * the graph sidebar / edge flow -> graphOps -> React state -> buildPaperElements -> updateScene.
 *
 * ID CONVENTION (this is what keeps the canvas and the app state in sync)
 *   paper node parts : `${nodeId}::card` (the ellipse / point) and `${nodeId}::title` (the text)
 *   edge arrow       : `${edgeId}::edge`
 *   anything else    : a free-hand element the user drew -> saved as-is
 * Point + title share the group `grp::${nodeId}` so they move as one.
 */
const SEP = "::";

export const cardElementId = (nodeId: string) => `${nodeId}${SEP}card`;
export const edgeElementId = (edgeId: string) => `${edgeId}${SEP}edge`;
const groupIdOf = (nodeId: string) => `grp${SEP}${nodeId}`;

export const parseOwnedId = (id: string): { baseId: string; part: string } | null => {
  const i = id.indexOf(SEP);
  if (i === -1) return null;
  return { baseId: id.slice(0, i), part: id.slice(i + SEP.length) };
};

/** True for anything generated from paperNodes / paperEdges (incl. arrow labels). */
export const isPaperOwned = (el: any): boolean => {
  if (typeof el?.id === "string" && el.id.includes(SEP)) return true;
  if (el?.type === "text" && typeof el.containerId === "string" && el.containerId.includes(SEP)) {
    return true;
  }
  return false;
};

/** True for an edge's arrow (`<edgeId>::edge`) and for the text label bound to it. */
export const isEdgeOwned = (el: any): boolean => {
  if (typeof el?.id === "string" && parseOwnedId(el.id)?.part === "edge") return true;
  if (el?.type === "text" && typeof el.containerId === "string") {
    return parseOwnedId(el.containerId)?.part === "edge";
  }
  return false;
};

/* --------------------------- click -> node lookup --------------------------- */

/** `paper-1::card` / `paper-1::title` -> `paper-1`. Anything else (arrows, free shapes) -> null. */
export const resolveNodeId = (
  elementId: string | null | undefined,
  nodes: { id: string }[]
): string | null => {
  if (!elementId) return null;
  const parsed = parseOwnedId(elementId);
  if (!parsed || (parsed.part !== "card" && parsed.part !== "title")) return null;
  return nodes.some((n) => n.id === parsed.baseId) ? parsed.baseId : null;
};

/**
 * Finds the paper node under a scene-space point by testing the point/title ELEMENTS (topmost first)
 * and mapping the element id back to its node. Used because Excalidraw's own hit-test result is not
 * populated yet when `onPointerDown` fires.
 */
export const hitTestPaperNode = (
  elements: readonly any[],
  nodes: { id: string }[],
  point: Point,
  zoom: number
): string | null => {
  const slop = 6 / (zoom || 1);
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted) continue;
    const nodeId = resolveNodeId(el.id, nodes);
    if (!nodeId) continue;
    if (
      point.x >= el.x - slop &&
      point.x <= el.x + el.width + slop &&
      point.y >= el.y - slop &&
      point.y <= el.y + el.height + slop
    ) {
      return nodeId;
    }
  }
  return null;
};

/* ------------------------------ edge styling ------------------------------ */

interface ArrowLook {
  strokeColor: string;
  strokeStyle: "solid" | "dashed" | "dotted";
  /** null = sharp corners, { type: 2 } = rounded / curved (shows once the arrow has a bend point) */
  roundness: { type: number } | null;
  strokeWidth: number;
}

const EDGE_LOOKS: Record<Exclude<RelationType, "custom">, ArrowLook> = {
  cites:                    { strokeColor: "#64748b", strokeStyle: "solid",  roundness: null,       strokeWidth: 1 },
  extends:                  { strokeColor: "#4f46e5", strokeStyle: "solid",  roundness: { type: 2 }, strokeWidth: 2 },
  improves:                 { strokeColor: "#059669", strokeStyle: "dashed", roundness: { type: 2 }, strokeWidth: 2 },
  contradicts:              { strokeColor: "#dc2626", strokeStyle: "dotted", roundness: null,       strokeWidth: 2 },
  benchmarks:               { strokeColor: "#d97706", strokeStyle: "dashed", roundness: null,       strokeWidth: 2 },
  "theoretical-foundation": { strokeColor: "#7c3aed", strokeStyle: "solid",  roundness: { type: 2 }, strokeWidth: 2 },
};

/** Look for an edge, derived ONLY from its type (or label when the type is 'custom'). */
export const getArrowLook = (e: ResearchPaperEdge): ArrowLook => {
  const type: RelationType =
    e.relationType && e.relationType !== "custom"
      ? e.relationType
      : e.label
      ? inferRelationType(e.label)
      : "custom";
  if (type !== "custom") return EDGE_LOOKS[type];
  return { strokeColor: "#475569", strokeStyle: "solid", roundness: { type: 2 }, strokeWidth: 2 };
};

/* ----------------------------- text helpers ------------------------------ */

const truncate = (text: string, max: number) =>
  text.length <= max ? text : text.slice(0, Math.max(1, max - 1)).trimEnd() + "…";

const wrapText = (text: string, maxChars: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let word of words) {
    while (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!line) line = word;
    else if ((line + " " + word).length <= maxChars) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
};

/* ------------------------------ node layout ------------------------------ */
// A paper is now a small point (ellipse) with its title next to it.
// node.x / node.y are the TOP-LEFT of the ellipse, so dragging the ellipse maps 1:1 to node.x / node.y.

export const POINT_DIAMETER = 22;
const LABEL_GAP = 8;
const FS_LABEL = 14;
const LABEL_LH = 1.25;
const LABEL_MAX_CHARS = 26;
const LABEL_MAX_LINES = 3;

export interface NodeLayout {
  /** Footprint of point + title, measured from node.x */
  width: number;
  height: number;
  /** Where the footprint's top edge sits relative to node.y (<= 0 when the title is taller than the point) */
  offsetY: number;
  label: { x: number; y: number; text: string };
}

/** Size of a paper node (point + title). Exported so the app can place new nodes and hit-test hovers. */
export const layoutCard = (p: ResearchPaperNode): NodeLayout => {
  let lines = wrapText(p.title || "Untitled paper", LABEL_MAX_CHARS);
  if (lines.length > LABEL_MAX_LINES) {
    lines = lines.slice(0, LABEL_MAX_LINES);
    lines[LABEL_MAX_LINES - 1] = truncate(lines[LABEL_MAX_LINES - 1] + "…", LABEL_MAX_CHARS);
  }
  const labelW = Math.ceil(Math.max(...lines.map((l) => l.length)) * FS_LABEL * 0.56);
  const labelH = Math.ceil(lines.length * FS_LABEL * LABEL_LH);
  const labelY = POINT_DIAMETER / 2 - labelH / 2; // vertically centred on the point

  return {
    width: POINT_DIAMETER + LABEL_GAP + labelW,
    height: Math.max(POINT_DIAMETER, labelH),
    offsetY: Math.min(0, labelY),
    label: { x: POINT_DIAMETER + LABEL_GAP, y: labelY, text: lines.join("\n") },
  };
};

/* --------------------------- paper -> Excalidraw --------------------------- */

const ARROW_GAP = 4;

/** Relative points from the arrow origin to the target. Never degenerate (start === end). */
const arrowPoints = (x1: number, y1: number, x2: number, y2: number): [number, number][] => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return [[0, 0], [50, 50]];
  return [[0, 0], [dx, dy]];
};

export const buildPaperElements = (
  papers: ResearchPaperNode[],
  edges: ResearchPaperEdge[]
): any[] => {
  const skeleton: any[] = [];
  const known = new Map<string, ResearchPaperNode>();

  papers.forEach((p) => {
    const L = layoutCard(p);
    const grp = [groupIdOf(p.id)]; // same group id on point + title => they move as one entity
    const accent = p.color || "#4f46e5";
    known.set(p.id, p);

    skeleton.push({
      type: "ellipse",
      id: cardElementId(p.id),
      x: p.x,
      y: p.y,
      width: POINT_DIAMETER,
      height: POINT_DIAMETER,
      strokeColor: accent,
      backgroundColor: accent,
      fillStyle: "solid",
      strokeWidth: 2,
      roughness: 0,
      groupIds: grp,
    });

    skeleton.push({
      type: "text",
      id: `${p.id}${SEP}title`,
      x: p.x + L.label.x,
      y: p.y + L.label.y,
      text: L.label.text,
      fontSize: FS_LABEL,
      fontFamily: 2,
      textAlign: "left",
      strokeColor: "#0f172a",
      groupIds: grp,
    });
  });

  // Arrows come after the points so the elements they bind to already exist.
  edges.forEach((e) => {
    const s = known.get(e.sourceNodeId);
    const t = known.get(e.targetNodeId);
    if (!s || !t) return;

    const look = getArrowLook(e);
    const startX = s.x + POINT_DIAMETER / 2;
    const startY = s.y + POINT_DIAMETER / 2;
    skeleton.push({
      type: "arrow",
      id: edgeElementId(e.id),
      x: startX,
      y: startY,
      // Always >= 2 DISTINCT relative points so there is a renderable path before binding routing runs.
      points: arrowPoints(startX, startY, t.x + POINT_DIAMETER / 2, t.y + POINT_DIAMETER / 2),
      // Bind to the ELLIPSE ids (`${nodeId}::card`), never the group id, so arrows can't detach.
      start: { id: cardElementId(e.sourceNodeId) },
      end: { id: cardElementId(e.targetNodeId) },
      strokeColor: look.strokeColor,
      strokeWidth: look.strokeWidth,
      strokeStyle: look.strokeStyle,
      roundness: look.roundness,
      roughness: 0,
      locked: true, // edges are not user-editable; they follow their nodes
      endArrowhead: "arrow",
      ...(e.label
        ? { label: { text: e.label, fontSize: 14, strokeColor: look.strokeColor } }
        : {}),
    });
  });

  // regenerateIds:false is REQUIRED - the ids above are how we map clicks back to papers.
  const elements: any[] = convertToExcalidrawElements(skeleton, { regenerateIds: false });
  ensureBindings(elements, edges);
  // The converter does not let us flag the generated label text, so lock every edge element explicitly.
  elements.forEach((el) => {
    if (isEdgeOwned(el)) el.locked = true;
  });

  return elements;
};

/**
 * Guarantees every edge arrow is explicitly bound to its two ellipses:
 *   arrow.startBinding = { elementId: sourceEllipseId }, arrow.endBinding = { elementId: targetEllipseId }
 * and each ellipse lists the arrow in boundElements. Missing bindings are what makes arrows
 * lose their anchors (and vanish/detach) when nodes move. Existing, correct bindings are kept.
 */
const ensureBindings = (elements: any[], edges: ResearchPaperEdge[]): any[] => {
  const byId = new Map<string, any>(elements.map((el) => [el.id, el]));

  edges.forEach((e) => {
    const arrow = byId.get(edgeElementId(e.id));
    const src = byId.get(cardElementId(e.sourceNodeId));
    const dst = byId.get(cardElementId(e.targetNodeId));
    if (!arrow || !src || !dst) return;

    // Safety net: an arrow with fewer than 2 distinct points has no path to draw.
    const pts: number[][] = arrow.points ?? [];
    const degenerate =
      pts.length < 2 || pts.every((q) => Math.abs(q[0] - pts[0][0]) < 1 && Math.abs(q[1] - pts[0][1]) < 1);
    if (degenerate) {
      arrow.x = src.x + POINT_DIAMETER / 2;
      arrow.y = src.y + POINT_DIAMETER / 2;
      arrow.points = arrowPoints(arrow.x, arrow.y, dst.x + POINT_DIAMETER / 2, dst.y + POINT_DIAMETER / 2);
      arrow.width = Math.abs(arrow.points[1][0]);
      arrow.height = Math.abs(arrow.points[1][1]);
    }

    // Safety net: if the converter left a binding missing or pointing elsewhere, force it onto the
    // ELLIPSE ids (never the group id). Correct bindings (with their computed focus) are kept.
    if (arrow.startBinding?.elementId !== src.id) {
      arrow.startBinding = { elementId: src.id, focus: 0, gap: ARROW_GAP };
    }
    if (arrow.endBinding?.elementId !== dst.id) {
      arrow.endBinding = { elementId: dst.id, focus: 0, gap: ARROW_GAP };
    }

    [src, dst].forEach((node) => {
      const bound: any[] = node.boundElements ? [...node.boundElements] : [];
      if (!bound.some((b) => b.id === arrow.id)) bound.push({ id: arrow.id, type: "arrow" });
      node.boundElements = bound;
    });
  });

  return elements;
};

/* --------------------------- live edge tracking --------------------------- */

const nextVersion = (el: any) => ({
  version: (el.version ?? 0) + 1,
  versionNonce: Math.floor(Math.random() * 2147483647),
  updated: Date.now(),
});

/**
 * Computes where an edge's arrow must sit for the CURRENT positions of its two node ellipses: a straight
 * segment along the line between the two centres, starting/ending ARROW_GAP outside each circle.
 * Pure geometry on the elements themselves, so it works no matter how Excalidraw's own binding code
 * behaves in the installed version.
 */
const edgeGeometry = (src: any, dst: any) => {
  const sx = src.x + src.width / 2;
  const sy = src.y + src.height / 2;
  const dx = dst.x + dst.width / 2 - sx;
  const dy = dst.y + dst.height / 2 - sy;
  const dist = Math.hypot(dx, dy);
  const rs = src.width / 2 + ARROW_GAP;
  const rd = dst.width / 2 + ARROW_GAP;

  // Nodes (almost) touching/overlapping: no room for a gap, fall back to centre -> centre.
  if (dist < 1 || dist <= rs + rd + 1) {
    const [p1, p2] = arrowPoints(sx, sy, sx + dx, sy + dy);
    return { x: sx, y: sy, points: [p1, p2], width: Math.abs(p2[0]), height: Math.abs(p2[1]) };
  }
  const ux = dx / dist;
  const uy = dy / dist;
  const x = sx + ux * rs;
  const y = sy + uy * rs;
  const ex = dx - ux * (rs + rd);
  const ey = dy - uy * (rs + rd);
  return { x, y, points: [[0, 0], [ex, ey]], width: Math.abs(ex), height: Math.abs(ey) };
};

/**
 * Re-routes the arrows of every edge touching a moved node (and re-centres their label text).
 * Returns replacement elements keyed by id, or null when nothing needs to change. Elements that are
 * already in the right place are skipped, so calling this on every onChange never loops.
 */
export const relayoutEdges = (
  elements: readonly any[],
  movedNodeIds: ReadonlySet<string>,
  edges: ResearchPaperEdge[]
): Map<string, any> | null => {
  const byId = new Map<string, any>();
  for (const el of elements) if (!el.isDeleted) byId.set(el.id, el);

  const out = new Map<string, any>();
  for (const e of edges) {
    if (!movedNodeIds.has(e.sourceNodeId) && !movedNodeIds.has(e.targetNodeId)) continue;
    const arrow = byId.get(edgeElementId(e.id));
    const src = byId.get(cardElementId(e.sourceNodeId));
    const dst = byId.get(cardElementId(e.targetNodeId));
    if (!arrow || !src || !dst) continue;

    const g = edgeGeometry(src, dst);
    const end = arrow.points?.[arrow.points.length - 1] ?? [0, 0];
    const same =
      arrow.points?.length === 2 &&
      Math.abs(arrow.x - g.x) < 0.25 &&
      Math.abs(arrow.y - g.y) < 0.25 &&
      Math.abs(end[0] - g.points[1][0]) < 0.25 &&
      Math.abs(end[1] - g.points[1][1]) < 0.25;
    if (same) continue;

    out.set(arrow.id, { ...arrow, ...g, ...nextVersion(arrow) });

    // The edge label is a bound text element: keep it centred on the arrow.
    const mx = g.x + g.points[1][0] / 2;
    const my = g.y + g.points[1][1] / 2;
    for (const el of byId.values()) {
      if (el.type === "text" && el.containerId === arrow.id) {
        out.set(el.id, { ...el, x: mx - el.width / 2, y: my - el.height / 2, ...nextVersion(el) });
      }
    }
  }
  return out.size > 0 ? out : null;
};

/* ----------------------------- edge lock guard ----------------------------- */

/**
 * Safety net that keeps edges untouchable, even if the user finds a way around Excalidraw's lock
 * (context menu "Unlock all", the unlock bubble on a locked element, a stale scene after undo...).
 * Returns replacement elements keyed by id, or null when every edge is already locked AND sitting
 * exactly where its two nodes put it. Idempotent, so it is safe to call on every onChange.
 */
export const enforceEdgeState = (
  elements: readonly any[],
  edges: ResearchPaperEdge[]
): Map<string, any> | null => {
  const out = new Map<string, any>();

  // 1) anything edge-owned must be locked
  for (const el of elements) {
    if (el.isDeleted || !isEdgeOwned(el) || el.locked === true) continue;
    out.set(el.id, { ...el, locked: true, ...nextVersion(el) });
  }

  // 2) every arrow must match its nodes' CURRENT positions (re-uses the live drag routing)
  const base = out.size > 0 ? elements.map((el) => out.get(el.id) ?? el) : elements;
  const allNodeIds = new Set<string>();
  for (const e of edges) {
    allNodeIds.add(e.sourceNodeId);
    allNodeIds.add(e.targetNodeId);
  }
  const geometry = relayoutEdges(base, allNodeIds, edges);
  if (geometry) geometry.forEach((el, id) => out.set(id, el));

  return out.size > 0 ? out : null;
};

/**
 * Returns `selectedElementIds` without any edge element (box-select and Ctrl+A can otherwise sweep locked
 * elements into a selection), or null when nothing needs removing.
 */
export const stripEdgeSelection = (
  selectedElementIds: Record<string, boolean>,
  elements: readonly any[]
): Record<string, boolean> | null => {
  const edgeIds = new Set<string>();
  for (const el of elements) if (isEdgeOwned(el)) edgeIds.add(el.id);

  let changed = false;
  const next: Record<string, boolean> = {};
  for (const [id, on] of Object.entries(selectedElementIds ?? {})) {
    if (edgeIds.has(id)) changed = true;
    else next[id] = on;
  }
  return changed ? next : null;
};

/** True when `id` is the id of an edge element (used to dismiss Excalidraw's "unlock" bubble for edges). */
export const isEdgeElementId = (id: unknown): boolean =>
  typeof id === "string" && parseOwnedId(id)?.part === "edge";

/* ------------------------- deletion guard / drag sync ------------------------- */

/**
 * True when a graph element was deleted from the canvas (Delete key, eraser, undo...) or a stale one
 * is left over. Nodes and edges may only be removed through the graph sidebar, so the canvas then
 * re-pushes the graph. Positions are NOT checked here: dragging is allowed and synced separately
 * (see findMovedNodes).
 */
export const graphHasDrifted = (
  elements: readonly any[],
  nodes: ResearchPaperNode[],
  edges: ResearchPaperEdge[]
): boolean => {
  const live = new Map<string, any>();
  for (const el of elements) if (!el.isDeleted) live.set(el.id, el);

  const nodeIds = new Set(nodes.map((n) => n.id));
  const expectedEdges = edges.filter((e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId));
  const edgeIds = new Set(expectedEdges.map((e) => e.id));

  for (const n of nodes) {
    if (!live.has(cardElementId(n.id)) || !live.has(`${n.id}${SEP}title`)) return true;
  }
  for (const e of expectedEdges) {
    if (!live.has(edgeElementId(e.id))) return true;
  }
  for (const el of live.values()) {
    const parsed = parseOwnedId(el.id);
    if (!parsed) continue;
    if ((parsed.part === "card" || parsed.part === "title") && !nodeIds.has(parsed.baseId)) return true;
    if (parsed.part === "edge" && !edgeIds.has(parsed.baseId)) return true;
  }
  return false;
};

/**
 * Compares every live node ellipse with its PaperNode and returns the ones whose x / y differ.
 * node.x / node.y are the ellipse's top-left, so the mapping is 1:1.
 */
export const findMovedNodes = (
  elements: readonly any[],
  nodes: ResearchPaperNode[]
): Record<string, Point> => {
  const moved: Record<string, Point> = {};
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const el of elements) {
    if (el.isDeleted || el.type !== "ellipse") continue;
    const parsed = parseOwnedId(el.id);
    if (!parsed || parsed.part !== "card") continue;
    const node = byId.get(parsed.baseId);
    if (!node) continue;
    if (Math.abs(el.x - node.x) > 0.5 || Math.abs(el.y - node.y) > 0.5) {
      moved[node.id] = { x: Math.round(el.x), y: Math.round(el.y) };
    }
  }
  return moved;
};

/* ------------------------ legacy seed shapes -> Excalidraw ------------------------ */

const FONT_MAP = { handwritten: 1, sans: 2, mono: 3 } as const;

export const legacyToElements = (legacy: WhiteboardElement[]): any[] => {
  const skeleton: any[] = [];

  legacy.forEach((el) => {
    const base = {
      id: el.id,
      x: el.x,
      y: el.y,
      strokeColor: el.strokeColor,
      opacity: Math.round((el.opacity ?? 1) * 100),
    };

    if (el.type === "text") {
      skeleton.push({
        ...base,
        type: "text",
        text: el.text || "",
        fontSize: el.fontSize || 20,
        fontFamily: FONT_MAP[el.fontFamily || "handwritten"],
      });
    } else if (el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse") {
      const fill = el.fillStyle === "hachure" || el.fillStyle === "cross-hatch" ? el.fillStyle : "solid";
      skeleton.push({
        ...base,
        type: el.type,
        width: el.width,
        height: el.height,
        backgroundColor: el.fillStyle === "none" ? "transparent" : el.backgroundColor,
        fillStyle: fill,
        strokeWidth: el.strokeWidth,
        roughness: Math.min(2, el.roughness ?? 1),
      });
    } else if ((el.type === "line" || el.type === "arrow") && el.points && el.points.length > 1) {
      skeleton.push({
        ...base,
        type: el.type,
        points: el.points.map((p) => [p.x, p.y]),
        strokeWidth: el.strokeWidth,
      });
    }
  });

  return convertToExcalidrawElements(skeleton, { regenerateIds: false });
};
