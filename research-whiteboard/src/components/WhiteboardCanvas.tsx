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
  cardElementId,
  layoutCard,
  hitTestPaperNode,
  resolveNodeId,
  graphHasDrifted,
  findMovedNodes,
  relayoutEdges,
  parseOwnedId,
  enforceEdgeState,
  stripEdgeSelection,
  isEdgeElementId,
  POINT_DIAMETER,
} from "../utils/excalidrawAdapter";
import {
  ResearchPaperNode,
  ResearchPaperEdge,
  WhiteboardElement,
  ViewTransform,
  Point,
} from "../types";
import { HoverCard } from "./HoverCard";
import { LINKED_PAPER_MIME } from "../utils/dnd";

/** Two clicks on the same node within this window count as a double-click. */
const DOUBLE_CLICK_MS = 300;

export interface WhiteboardHandle {
  /** Scroll the canvas so the given node is centered. */
  locateNode: (nodeId: string) => void;
  /** Center of the visible area, in scene coordinates (used to place new nodes). */
  getViewportCenter: () => Point;
  /** Download the current canvas as a PNG. */
  exportPNG: (fileName: string) => Promise<void>;
}

/**
 * The graph (React state) is rendered onto the canvas:
 *   graph --buildPaperElements--> unlocked Excalidraw elements --updateScene--> canvas
 * The ONLY thing that flows back is node positions (dragging), via `onNodesMoved`. Nodes and edges
 * can be added / deleted only from the graph sidebar; deleting them on the canvas is reverted.
 * Edges are LOCKED: the user can only move nodes, and the arrows follow them.
 */
interface WhiteboardCanvasProps {
  paperNodes: ResearchPaperNode[];
  paperEdges: ResearchPaperEdge[];
  legacyElements: WhiteboardElement[];
  sceneElements?: any[];
  viewTransform: ViewTransform;

  /** A node was clicked (id) or empty canvas was clicked (null). */
  onSelectNode: (nodeId: string | null) => void;
  /** A node was double-clicked (two clicks within 300ms) -> open the inspector. */
  onOpenNode: (nodeId: string) => void;
  /** Nodes were dragged on the canvas: new top-left coordinates keyed by node id. */
  onNodesMoved: (positions: Record<string, Point>) => void;
  /** Free-hand drawings (NOT part of the graph) changed - persisted per board. */
  onSceneChange: (elements: any[]) => void;
  onViewChange: (view: ViewTransform) => void;

  /** Edge flow: while true, a click on a node is reported via `onPickNode` instead of selecting it. */
  isPickingNode?: boolean;
  onPickNode?: (nodeId: string) => void;
  /** A linked paper was dropped from the sidebar. `point` is the top-left of the new node, in scene coordinates. */
  onDropLinkedPaper?: (paper: any, point: Point) => void;
}

/** Everything that affects how nodes / arrows look. If it changes, the graph elements are rebuilt. */
const graphSignature = (nodes: ResearchPaperNode[], edges: ResearchPaperEdge[]) =>
  JSON.stringify([
    nodes.map((n) => [n.id, n.title, n.authors, n.color, n.x, n.y]),
    edges.map((e) => [e.id, e.sourceNodeId, e.targetNodeId, e.relationType, e.label]),
  ]);

const freeSignature = (els: any[]) => els.map((e) => `${e.id}:${e.version}`).join("|");

interface CardInfo {
  nodeId: string;
  left: number;
  top: number;
  pinned: boolean;
}

/** Screen position (px inside the canvas container) just below a node's point + title. */
const nodeAnchor = (n: ResearchPaperNode, s: any): { left: number; top: number } => {
  const L = layoutCard(n);
  return {
    left: (n.x + s.scrollX) * s.zoom.value,
    top: (n.y + L.offsetY + L.height + s.scrollY) * s.zoom.value,
  };
};

export const WhiteboardCanvas = forwardRef<WhiteboardHandle, WhiteboardCanvasProps>((props, ref) => {
  const {
    paperNodes,
    paperEdges,
    legacyElements,
    sceneElements,
    viewTransform,
  } = props;

  const [api, setApi] = useState<any>(null);
  const apiRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Floating card: transient on hover, pinned (interactive) after a click.
  const [card, setCard] = useState<CardInfo | null>(null);
  const hoverIdRef = useRef<string | null>(null);
  const pinnedRef = useRef(false);

  // Click bookkeeping: double-click detection + swallowing Excalidraw's own dblclick behaviour.
  const lastClickRef = useRef<{ nodeId: string | null; time: number } | null>(null);
  const lastNodeHitRef = useRef<string | null>(null);

  // Always read the latest props from inside Excalidraw's (stable) event handlers.
  const live = useRef(props);
  live.current = props;

  const renderedSigRef = useRef("");
  const freeSigRef = useRef("");
  const driftFixesRef = useRef(0);
  const edgeFixesRef = useRef(0);
  const viewTimer = useRef<number | undefined>(undefined);
  // Node positions (nodeId -> x,y) the edges were last laid out for. Lets us detect "a node moved".
  const layoutPosRef = useRef<Map<string, Point>>(new Map());
  const rememberLayout = (nodes: ResearchPaperNode[]) => {
    layoutPosRef.current = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  };

  /* ---- graph -> canvas (the ONLY write path into the graph elements) ---- */
  const pushGraph = useCallback(() => {
    const a = apiRef.current;
    if (!a) return;
    const { paperNodes: nodes, paperEdges: edges } = live.current;
    renderedSigRef.current = graphSignature(nodes, edges);
    rememberLayout(nodes);
    const free = a.getSceneElementsIncludingDeleted().filter((el: any) => !isPaperOwned(el));
    a.updateScene({ elements: [...free, ...buildPaperElements(nodes, edges)] });
  }, []);

  // Scene used only for the very first render of this canvas instance.
  const initialData = useMemo(() => {
    const free =
      sceneElements && sceneElements.length > 0 ? sceneElements : legacyToElements(legacyElements || []);
    const graph = buildPaperElements(paperNodes, paperEdges);
    renderedSigRef.current = graphSignature(paperNodes, paperEdges);
    rememberLayout(paperNodes);
    freeSigRef.current = freeSignature(free.filter((e: any) => !e.isDeleted));
    return {
      elements: [...free, ...graph],
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

  // Whenever the React graph changes (sidebar add/delete node/edge), re-translate and push it.
  useEffect(() => {
    if (!api) return;
    if (graphSignature(paperNodes, paperEdges) === renderedSigRef.current) return;
    pushGraph();
  }, [api, paperNodes, paperEdges, pushGraph]);

  // A card for a node that no longer exists (deleted in the sidebar) must go away.
  useEffect(() => {
    if (card && !paperNodes.some((n) => n.id === card.nodeId)) {
      hoverIdRef.current = null;
      pinnedRef.current = false;
      setCard(null);
    }
  }, [paperNodes, card]);

  const clearCard = useCallback(() => {
    hoverIdRef.current = null;
    pinnedRef.current = false;
    setCard(null);
  }, []);

  // Starting the edge flow closes any open hover / pinned card.
  useEffect(() => {
    if (props.isPickingNode) clearCard();
  }, [props.isPickingNode, clearCard]);

  /* ---- clicks on the graph elements ---- */
  // We hit-test the point/title ELEMENTS ourselves and map their ids back to graph nodes. (Excalidraw's own hit result is
  // not populated yet when onPointerDown fires, hence the fallback order below.)
  const handlePointerDown = useCallback(
    (_tool: any, pointerDownState: any) => {
      const a = apiRef.current;
      const p = live.current;
      if (!a || !pointerDownState?.origin) return;

      const s = a.getAppState();
      const nodeId =
        resolveNodeId(pointerDownState.hit?.element?.id, p.paperNodes) ??
        hitTestPaperNode(a.getSceneElements(), p.paperNodes, pointerDownState.origin as Point, s.zoom.value);
      lastNodeHitRef.current = nodeId;

      // Edge flow: the click belongs to the flow ("this is my source / destination"), not to selection.
      if (p.isPickingNode) {
        clearCard();
        if (nodeId) p.onPickNode?.(nodeId);
        return;
      }

      // Double click: same node twice within 300ms -> open the inspector
      const now = Date.now();
      const last = lastClickRef.current;
      if (nodeId && last && last.nodeId === nodeId && now - last.time <= DOUBLE_CLICK_MS) {
        lastClickRef.current = null;
        clearCard();
        p.onOpenNode(nodeId);
        return;
      }
      lastClickRef.current = { nodeId, time: now };

      p.onSelectNode(nodeId);

      // Single click: pin the card to the clicked node's position (empty canvas closes it)
      const node = nodeId ? p.paperNodes.find((n) => n.id === nodeId) : undefined;
      if (!node) return clearCard();
      hoverIdRef.current = node.id;
      pinnedRef.current = true;
      setCard({ nodeId: node.id, ...nodeAnchor(node, s), pinned: true });
    },
    [clearCard]
  );

  /* ---- live edge tracking ---- */
  // Excalidraw is supposed to drag bound arrows along with their node, but that only works when its
  // internal binding data is complete, and it isn't (the arrows stayed put until a rebuild, e.g. the
  // delete-restore, re-routed them). So we do it ourselves: on EVERY onChange (including each frame of a
  // drag) find node ellipses that moved since the edges were last laid out, and patch just the
  // arrows (and their label text) touching them via updateScene. The patch is idempotent - once the
  // arrows match the ellipses nothing more is dispatched - so this can't loop.
  const trackEdges = useCallback((elements: readonly any[]) => {
    const a = apiRef.current;
    if (!a) return;
    const known = layoutPosRef.current;
    const moved = new Set<string>();
    for (const el of elements) {
      if (el.isDeleted || el.type !== "ellipse") continue;
      const parsed = parseOwnedId(el.id);
      if (!parsed || parsed.part !== "card") continue;
      const last = known.get(parsed.baseId);
      if (!last) continue; // brand-new node: the graph->canvas rebuild will lay it out
      if (Math.abs(el.x - last.x) > 0.01 || Math.abs(el.y - last.y) > 0.01) {
        moved.add(parsed.baseId);
        known.set(parsed.baseId, { x: el.x, y: el.y });
      }
    }
    if (moved.size === 0) return;

    const patch = relayoutEdges(elements, moved, live.current.paperEdges);
    if (!patch) return;
    a.updateScene({
      elements: elements.map((el) => patch.get(el.id) ?? el),
      captureUpdate: "NEVER", // layout fix-up, not a user action: keep it out of undo/redo
    } as any);
  }, []);

  /* ---- canvas -> app: free-hand drawings + node positions (never graph structure) ---- */
  const handleChange = useCallback(
    (elements: readonly any[], appState: any) => {
      const p = live.current;

      // Runs BEFORE the mid-gesture early return below, so arrows follow the node frame by frame.
      trackEdges(elements);

      // Edges are locked, but box-select / Ctrl+A / the "unlock" bubble could still reach them: keep them
      // out of the selection and dismiss the bubble.
      const a = apiRef.current;
      if (a) {
        const cleaned = stripEdgeSelection(appState.selectedElementIds, elements);
        const bubble = isEdgeElementId(appState.activeLockedId);
        if (cleaned || bubble) {
          a.updateScene({
            appState: {
              ...(cleaned ? { selectedElementIds: cleaned } : {}),
              ...(bubble ? { activeLockedId: null } : {}),
            },
            captureUpdate: "NEVER",
          } as any);
        }
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

      // 1) Deletion guard: nodes/edges may only be deleted from the graph sidebar. If a graph element
      //    vanished from the scene (Delete key, eraser, undo), restore everything from React state.
      //    Capped so a persistent mismatch can't loop forever.
      if (graphHasDrifted(elements, p.paperNodes, p.paperEdges)) {
        if (driftFixesRef.current < 3) {
          driftFixesRef.current += 1;
          window.setTimeout(pushGraph, 0);
        }
        return; // don't sync positions / persist from a scene that is about to be replaced
      }
      driftFixesRef.current = 0;

      // 1b) Edge lock guard: re-lock any edge that got unlocked and snap any arrow that is not exactly where its
      //     nodes put it. Idempotent (returns null once everything matches); capped like the drift guard.
      const edgeFix = enforceEdgeState(elements, p.paperEdges);
      if (edgeFix) {
        if (edgeFixesRef.current < 5) {
          edgeFixesRef.current += 1;
          apiRef.current?.updateScene({
            elements: elements.map((el) => edgeFix.get(el.id) ?? el),
            captureUpdate: "NEVER",
          } as any);
        }
      } else {
        edgeFixesRef.current = 0;
      }

      // 2) Drag sync: the gesture is over (early return above), so any ellipse whose x/y differs from
      //    its PaperNode is a finished move. Comparing against state means this only fires once per
      //    move: after the update the coordinates match and nothing is dispatched.
      const moved = findMovedNodes(elements, p.paperNodes);
      if (Object.keys(moved).length > 0) {
        // Pre-mark the new graph as "already rendered" so the graph->canvas effect doesn't rebuild
        // (and re-push) elements that already sit at these coordinates.
        const nextNodes = p.paperNodes.map((n) => (moved[n.id] ? { ...n, ...moved[n.id] } : n));
        renderedSigRef.current = graphSignature(nextNodes, p.paperEdges);
        p.onNodesMoved(moved);
      }

      // Free-hand shapes/text the user drew (non-graph) -> persist per board
      const free = elements.filter((el) => !isPaperOwned(el) && !el.isDeleted);
      const fSig = freeSignature(free);
      if (fSig !== freeSigRef.current) {
        freeSigRef.current = fSig;
        p.onSceneChange(free as any[]);
      }
    },
    [pushGraph, trackEdges]
  );

  /* ---- hover preview: Excalidraw has no CSS hover on canvas elements, so hit-test the pointer ---- */
  const clearHover = useCallback(() => {
    if (!pinnedRef.current) clearCard(); // a pinned card stays until the user closes it
  }, [clearCard]);

  const handlePointerUpdate = useCallback(
    (payload: any) => {
      const a = apiRef.current;
      if (!a || !payload?.pointer || pinnedRef.current || live.current.isPickingNode) return;
      if (payload.button === "down") return clearHover();

      const nodeId = hitTestPaperNode(
        a.getSceneElements(),
        live.current.paperNodes,
        payload.pointer,
        a.getAppState().zoom.value
      );
      if (!nodeId) return clearHover();
      if (nodeId === hoverIdRef.current) return;

      const node = live.current.paperNodes.find((n) => n.id === nodeId);
      if (!node) return;
      hoverIdRef.current = nodeId;
      setCard({ nodeId, ...nodeAnchor(node, a.getAppState()), pinned: false });
    },
    [clearHover]
  );

  /* ---- drag & drop: linked papers dragged from the sidebar ---- */
  // Capture phase + stopPropagation so Excalidraw's own file-drop handler never sees our payload.
  const hasLinkedPaper = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(LINKED_PAPER_MIME);

  const onDragOverCapture = (e: React.DragEvent) => {
    if (!hasLinkedPaper(e)) return;
    e.preventDefault(); // required, otherwise the browser refuses the drop
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };

  const onDropCapture = (e: React.DragEvent) => {
    if (!hasLinkedPaper(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const a = apiRef.current;
    const box = containerRef.current?.getBoundingClientRect();
    if (!a || !box) return;

    let paper: any;
    try {
      paper = JSON.parse(e.dataTransfer.getData(LINKED_PAPER_MIME));
    } catch {
      return;
    }
    const s = a.getAppState();
    // screen -> scene, then centre the point under the cursor (node x/y is the ellipse's top-left)
    const sceneX = (e.clientX - box.left) / s.zoom.value - s.scrollX;
    const sceneY = (e.clientY - box.top) / s.zoom.value - s.scrollY;
    live.current.onDropLinkedPaper?.(paper, {
      x: sceneX - POINT_DIAMETER / 2,
      y: sceneY - POINT_DIAMETER / 2,
    });
  };

  // The inspector opens from onPointerDown (300ms rule). Without this, Excalidraw would also handle the
  // native double-click itself ("edit text in shape" / "enter group").
  const onDoubleClickCapture = (e: React.MouseEvent) => {
    if (!lastNodeHitRef.current) return;
    e.stopPropagation();
    e.preventDefault();
  };

  /* ---- remember pan / zoom (debounced) ---- */
  const handleScroll = useCallback(
    (scrollX: number, scrollY: number, zoom: any) => {
      clearCard(); // the card is positioned in screen space, so close it when the view moves
      window.clearTimeout(viewTimer.current);
      viewTimer.current = window.setTimeout(() => {
        live.current.onViewChange({ x: scrollX, y: scrollY, zoom: zoom.value });
      }, 300);
    },
    [clearCard]
  );
  useEffect(() => () => window.clearTimeout(viewTimer.current), []);

  /* ---- methods the parent can call ---- */
  useImperativeHandle(
    ref,
    () => ({
      locateNode: (nodeId) => {
        if (!api) return;
        const el = api.getSceneElements().find((e: any) => e.id === cardElementId(nodeId));
        if (el) api.scrollToContent(el, { animate: true, fitToViewport: false });
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

  const cardNode = card ? paperNodes.find((n) => n.id === card.nodeId) : undefined;

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0 }}
      className={props.isPickingNode ? "edge-picking" : undefined}
      onDoubleClickCapture={onDoubleClickCapture}
      onDragOverCapture={onDragOverCapture}
      onDropCapture={onDropCapture}
      onPointerLeave={clearHover}
    >
      {/* crosshair while the user is choosing a source / destination node */}
      {props.isPickingNode && <style>{`.edge-picking .excalidraw canvas { cursor: crosshair !important; }`}</style>}

      <Excalidraw
        excalidrawAPI={(a) => {
          apiRef.current = a;
          setApi(a);
        }}
        initialData={initialData as any}
        onChange={handleChange}
        onScrollChange={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerUpdate={handlePointerUpdate}
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

      {/* Hover / click card: plain HTML positioned over the canvas */}
      {card && cardNode && (
        <HoverCard
          paper={cardNode}
          left={card.left}
          top={card.top}
          containerWidth={containerRef.current?.clientWidth ?? 800}
          containerHeight={containerRef.current?.clientHeight ?? 600}
          pinned={card.pinned}
          onClose={clearCard}
          onOpenDetails={() => {
            clearCard();
            live.current.onOpenNode(cardNode.id);
          }}
        />
      )}
    </div>
  );
});

WhiteboardCanvas.displayName = "WhiteboardCanvas";
