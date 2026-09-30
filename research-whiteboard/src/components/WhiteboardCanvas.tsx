import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
// REQUIRED since Excalidraw 0.18 - without this the toolbar is unstyled and the lock icon is huge.
import "@excalidraw/excalidraw/index.css";

import {
  buildPaperElements,
  legacyToElements,
  isPaperOwned,
  parseOwnedId,
  cardElementId,
} from "../utils/excalidrawAdapter";
import {
  ResearchPaperNode,
  ResearchPaperEdge,
  WhiteboardElement,
  ViewTransform,
  Point,
} from "../types";

export interface WhiteboardHandle {
  /** Scroll the canvas so the given paper card is centered. */
  locateNode: (nodeId: string) => void;
  /** Center of the visible area, in scene coordinates (used to place new cards). */
  getViewportCenter: () => Point;
  /** Download the current canvas as a PNG. */
  exportPNG: (fileName: string) => Promise<void>;
}

interface WhiteboardCanvasProps {
  paperNodes: ResearchPaperNode[];
  paperEdges: ResearchPaperEdge[];
  legacyElements: WhiteboardElement[];
  sceneElements?: any[];
  viewTransform: ViewTransform;

  onSelectNode: (nodeId: string | null) => void;
  onNodesMoved: (positions: Record<string, Point>) => void;
  onNodesDeleted: (nodeIds: string[]) => void;
  onEdgesDeleted: (edgeIds: string[]) => void;
  onSceneChange: (elements: any[]) => void;
  onViewChange: (view: ViewTransform) => void;
  onDropPaper: (paper: any, scenePos: Point) => void;
}

/** Everything that affects how paper cards / arrows look. If it changes, we rebuild them. */
const paperSignature = (nodes: ResearchPaperNode[], edges: ResearchPaperEdge[]) =>
  JSON.stringify([
    nodes.map((n) => [
      n.id, n.title, n.authors, n.year, n.venue, n.status, n.color,
      n.x, n.y, n.width, n.keyInsights,
    ]),
    edges.map((e) => [e.id, e.sourceNodeId, e.targetNodeId, e.label, e.style, e.color]),
  ]);

const freeSignature = (els: any[]) => els.map((e) => `${e.id}:${e.version}`).join("|");

export const WhiteboardCanvas = forwardRef<WhiteboardHandle, WhiteboardCanvasProps>(
  (props, ref) => {
    const {
      paperNodes,
      paperEdges,
      legacyElements,
      sceneElements,
      viewTransform,
      onSelectNode,
      onNodesMoved,
      onNodesDeleted,
      onEdgesDeleted,
      onSceneChange,
      onViewChange,
      onDropPaper,
    } = props;

    const [api, setApi] = useState<any>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Always call the latest callbacks / data from inside Excalidraw's event handlers.
    const live = useRef(props);
    live.current = props;

    const renderedSigRef = useRef("");
    const freeSigRef = useRef("");
    const lastSelectedRef = useRef<string | null>(null);
    const viewTimer = useRef<number | undefined>(undefined);

    // Scene used only for the very first render of this canvas instance.
    const initialData = useMemo(() => {
      const free =
        sceneElements && sceneElements.length > 0
          ? sceneElements
          : legacyToElements(legacyElements || []);
      const paper = buildPaperElements(paperNodes, paperEdges);
      renderedSigRef.current = paperSignature(paperNodes, paperEdges);
      freeSigRef.current = freeSignature(free.filter((e: any) => !e.isDeleted));
      return {
        elements: [...free, ...paper],
        appState: {
          viewBackgroundColor: "#f8fafc",
          scrollX: viewTransform.x,
          scrollY: viewTransform.y,
          zoom: { value: viewTransform.zoom } as any,
          currentItemFontFamily: 2,
        },
        scrollToContent: false,
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ---- app state -> canvas: rebuild paper cards only when something visual changed ---- */
    useEffect(() => {
      if (!api) return;
      const sig = paperSignature(paperNodes, paperEdges);
      if (sig === renderedSigRef.current) return;
      renderedSigRef.current = sig;

      const free = api.getSceneElementsIncludingDeleted().filter((el: any) => !isPaperOwned(el));
      api.updateScene({ elements: [...free, ...buildPaperElements(paperNodes, paperEdges)] });
    }, [api, paperNodes, paperEdges]);

    /* ---- canvas -> app state ---- */
    const handleChange = useCallback((elements: readonly any[], appState: any) => {
      const p = live.current;

      // 1) Selection -> open the inspector for a single selected paper
      const selected = Object.keys(appState.selectedElementIds || {}).filter(
        (id) => appState.selectedElementIds[id]
      );
      const nodeIds = new Set<string>();
      let hasOther = false;
      for (const id of selected) {
        const parsed = parseOwnedId(id);
        if (parsed && p.paperNodes.some((n) => n.id === parsed.baseId)) nodeIds.add(parsed.baseId);
        else hasOther = true;
      }
      const nextSelected = nodeIds.size === 1 && !hasOther ? [...nodeIds][0] : null;
      if (nextSelected !== lastSelectedRef.current) {
        lastSelectedRef.current = nextSelected;
        p.onSelectNode(nextSelected);
      }

      // Don't commit anything while the user is mid-gesture.
      if (
        appState.selectedElementsAreBeingDragged ||
        appState.resizingElement ||
        appState.newElement ||
        appState.editingTextElement
      ) {
        return;
      }

      // 2) Moves + deletes of paper cards / arrows
      const moved: Record<string, Point> = {};
      const deletedNodes: string[] = [];
      const deletedEdges: string[] = [];

      for (const el of elements) {
        const parsed = parseOwnedId(el.id);
        if (!parsed) continue;
        if (parsed.part === "card") {
          const node = p.paperNodes.find((n) => n.id === parsed.baseId);
          if (!node) continue;
          if (el.isDeleted) deletedNodes.push(node.id);
          else if (Math.abs(el.x - node.x) > 0.5 || Math.abs(el.y - node.y) > 0.5) {
            moved[node.id] = { x: Math.round(el.x), y: Math.round(el.y) };
          }
        } else if (parsed.part === "edge" && el.isDeleted) {
          if (p.paperEdges.some((e) => e.id === parsed.baseId)) deletedEdges.push(parsed.baseId);
        }
      }

      if (Object.keys(moved).length > 0) {
        // Pre-compute the signature so the effect above does NOT rebuild the cards we just moved.
        renderedSigRef.current = paperSignature(
          p.paperNodes.map((n) => (moved[n.id] ? { ...n, ...moved[n.id] } : n)),
          p.paperEdges
        );
        p.onNodesMoved(moved);
      }
      if (deletedNodes.length) p.onNodesDeleted(deletedNodes);
      if (deletedEdges.length) p.onEdgesDeleted(deletedEdges);

      // 3) Free-hand shapes/text the user drew -> persist per board
      const free = elements.filter((el) => !isPaperOwned(el) && !el.isDeleted);
      const fSig = freeSignature(free);
      if (fSig !== freeSigRef.current) {
        freeSigRef.current = fSig;
        p.onSceneChange(free as any[]);
      }
    }, []);

    /* ---- remember pan / zoom (debounced) ---- */
    const handleScroll = useCallback((scrollX: number, scrollY: number, zoom: any) => {
      window.clearTimeout(viewTimer.current);
      viewTimer.current = window.setTimeout(() => {
        live.current.onViewChange({ x: scrollX, y: scrollY, zoom: zoom.value });
      }, 300);
    }, []);
    useEffect(() => () => window.clearTimeout(viewTimer.current), []);

    /* ---- methods the parent can call ---- */
    useImperativeHandle(
      ref,
      () => ({
        locateNode: (nodeId) => {
          if (!api) return;
          const card = api.getSceneElements().find((e: any) => e.id === cardElementId(nodeId));
          if (card) api.scrollToContent(card, { animate: true, fitToViewport: false });
        },
        getViewportCenter: () => {
          if (!api) return { x: 300, y: 250 };
          const s = api.getAppState();
          return {
            x: s.width / 2 / s.zoom.value - s.scrollX,
            y: s.height / 2 / s.zoom.value - s.scrollY,
          };
        },
        exportPNG: async (fileName) => {
          if (!api) return;
          const blob: Blob = await exportToBlob({
            elements: api.getSceneElements(),
            appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: "#f8fafc" },
            files: api.getFiles(),
            mimeType: "image/png",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fileName;
          a.click();
          URL.revokeObjectURL(url);
        },
      }),
      [api]
    );

    /* ---- drag a paper from the Linked Papers sidebar onto the canvas ---- */
    const isPaperDrag = (e: React.DragEvent) =>
      Array.from(e.dataTransfer.types).includes("application/json");

    const onDragOverCapture = (e: React.DragEvent) => {
      if (!isPaperDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      if (!isDragOver) setIsDragOver(true);
    };

    const onDropCapture = (e: React.DragEvent) => {
      if (!isPaperDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (!api || !containerRef.current) return;
      try {
        const paper = JSON.parse(e.dataTransfer.getData("application/json"));
        const rect = containerRef.current.getBoundingClientRect();
        const s = api.getAppState();
        onDropPaper(paper, {
          x: (e.clientX - rect.left) / s.zoom.value - s.scrollX,
          y: (e.clientY - rect.top) / s.zoom.value - s.scrollY,
        });
      } catch {
        /* not one of our drags */
      }
    };

    return (
      <div
        ref={containerRef}
        style={{ position: "absolute", inset: 0 }}
        onDragOverCapture={onDragOverCapture}
        onDropCapture={onDropCapture}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
        }}
      >
        <Excalidraw
          excalidrawAPI={(a) => setApi(a)}
          initialData={initialData as any}
          onChange={handleChange}
          onScrollChange={handleScroll}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: false,
              clearCanvas: false,
              toggleTheme: false,
            },
          }}
        />
        {isDragOver && (
          <div
            style={{
              position: "absolute",
              inset: 8,
              border: "2px dashed #6366f1",
              borderRadius: 12,
              background: "rgba(99,102,241,0.06)",
              pointerEvents: "none",
              zIndex: 5,
            }}
          />
        )}
      </div>
    );
  }
);

WhiteboardCanvas.displayName = "WhiteboardCanvas";
