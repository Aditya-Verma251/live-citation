import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type {
  ResearchPaperNode,
  ResearchPaperEdge,
  WhiteboardElement,
  PaperStatus,
} from "../types";

/**
 * ID CONVENTION (this is what keeps the canvas and the app state in sync)
 *   paper card parts : `${nodeId}::card | ::meta | ::title | ::authors | ::insights | ::status`
 *   edge arrow       : `${edgeId}::edge`
 *   anything else    : a free-hand element the user drew -> saved as-is
 * Every part of one card shares the group `grp::${nodeId}` so it moves as one.
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

/* ------------------------------ card layout ------------------------------ */

const PAD = 16;
const LH = 1.2; // slightly above Excalidraw's real line-height (1.15-1.25) so text never overflows the card
const FS_TITLE = 16;
const FS_SMALL = 12;
export const CARD_MIN_WIDTH = 280;

const STATUS_LABEL: Record<PaperStatus, string> = {
  seminal: "SEMINAL",
  reading: "READING",
  read: "READ",
  "to-read": "TO READ",
};

const STATUS_COLOR: Record<PaperStatus, string> = {
  seminal: "#b45309",
  reading: "#0369a1",
  read: "#047857",
  "to-read": "#64748b",
};

export interface CardLayout {
  width: number;
  height: number;
  meta: { y: number; text: string };
  title: { y: number; text: string };
  authors: { y: number; text: string };
  insights: { y: number; text: string } | null;
  status: { y: number; text: string; color: string };
}

/** Computes the size of a card from its content. Also exported so the app can place new cards. */
export const layoutCard = (p: ResearchPaperNode): CardLayout => {
  const width = Math.max(p.width || 0, CARD_MIN_WIDTH);
  const inner = width - PAD * 2;
  const titleChars = Math.floor(inner / (FS_TITLE * 0.56));
  const smallChars = Math.floor(inner / (FS_SMALL * 0.55));

  let titleLines = wrapText(p.title || "Untitled paper", titleChars);
  if (titleLines.length > 3) {
    titleLines = titleLines.slice(0, 3);
    titleLines[2] = truncate(titleLines[2] + "…", titleChars);
  }
  const insightLines = (p.keyInsights || [])
    .filter(Boolean)
    .slice(0, 2)
    .map((t) => "• " + truncate(t, smallChars - 2));

  const smallH = FS_SMALL * LH;
  let y = PAD;

  const meta = { y, text: `${p.year}  ·  ${truncate(p.venue || "", smallChars - 8)}` };
  y += smallH + 6;

  const title = { y, text: titleLines.join("\n") };
  y += titleLines.length * FS_TITLE * LH + 6;

  const authors = { y, text: truncate(p.authors || "Unknown authors", smallChars) };
  y += smallH + 10;

  let insights: CardLayout["insights"] = null;
  if (insightLines.length) {
    insights = { y, text: insightLines.join("\n") };
    y += insightLines.length * smallH + 10;
  }

  const status = {
    y,
    text: STATUS_LABEL[p.status] || "TO READ",
    color: STATUS_COLOR[p.status] || "#64748b",
  };
  y += smallH + PAD;

  return { width, height: Math.ceil(y), meta, title, authors, insights, status };
};

/* --------------------------- paper -> Excalidraw --------------------------- */

export const buildPaperElements = (
  papers: ResearchPaperNode[],
  edges: ResearchPaperEdge[]
): any[] => {
  const skeleton: any[] = [];
  const sizes = new Map<string, { w: number; h: number; x: number; y: number }>();

  papers.forEach((p) => {
    const L = layoutCard(p);
    const grp = [groupIdOf(p.id)];
    const accent = p.color || "#4f46e5";
    sizes.set(p.id, { w: L.width, h: L.height, x: p.x, y: p.y });

    skeleton.push({
      type: "rectangle",
      id: cardElementId(p.id),
      x: p.x,
      y: p.y,
      width: L.width,
      height: L.height,
      strokeColor: accent,
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      strokeWidth: 2,
      roughness: 0,
      roundness: { type: 3 },
      groupIds: grp,
    });

    const text = (part: string, y: number, t: string, fontSize: number, color: string) =>
      skeleton.push({
        type: "text",
        id: `${p.id}${SEP}${part}`,
        x: p.x + PAD,
        y: p.y + y,
        text: t,
        fontSize,
        fontFamily: 2, // Helvetica-style, easy to read at small sizes
        textAlign: "left",
        strokeColor: color,
        groupIds: grp,
      });

    text("meta", L.meta.y, L.meta.text, FS_SMALL, accent);
    text("title", L.title.y, L.title.text, FS_TITLE, "#0f172a");
    text("authors", L.authors.y, L.authors.text, FS_SMALL, "#64748b");
    if (L.insights) text("insights", L.insights.y, L.insights.text, FS_SMALL, "#334155");
    text("status", L.status.y, L.status.text, FS_SMALL, L.status.color);
  });

  // Arrows come after the cards so the cards they bind to already exist.
  edges.forEach((e) => {
    const s = sizes.get(e.sourceNodeId);
    const t = sizes.get(e.targetNodeId);
    if (!s || !t) return;

    skeleton.push({
      type: "arrow",
      id: edgeElementId(e.id),
      x: s.x + s.w / 2,
      y: s.y + s.h / 2,
      start: { id: cardElementId(e.sourceNodeId) },
      end: { id: cardElementId(e.targetNodeId) },
      strokeColor: e.color || "#64748b",
      strokeWidth: 2,
      strokeStyle: e.style || "solid",
      roughness: 0,
      endArrowhead: "arrow",
      ...(e.label
        ? { label: { text: e.label, fontSize: 14, strokeColor: e.color || "#64748b" } }
        : {}),
    });
  });

  // regenerateIds:false is REQUIRED - the ids above are how we map clicks back to papers.
  return convertToExcalidrawElements(skeleton, { regenerateIds: false });
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
