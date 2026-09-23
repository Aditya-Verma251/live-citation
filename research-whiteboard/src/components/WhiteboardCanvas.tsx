import React, { useRef, useEffect, useState, useCallback } from 'react';
import rough from 'roughjs';
import {
  ToolType,
  FillStyle,
  WhiteboardElement,
  ResearchPaperNode,
  ResearchPaperEdge,
  ViewTransform,
  Point,
} from '../types';
import {
  drawGrid,
  drawWhiteboardElement,
  drawResearchPaperEdge,
  getPaperNodeCenter,
  getEdgeConnectionPoints,
} from '../utils/canvasRenderer';
import { ResearchPaperCard } from './ResearchPaperCard';

interface WhiteboardCanvasProps {
  elements: WhiteboardElement[];
  paperNodes: ResearchPaperNode[];
  paperEdges: ResearchPaperEdge[];
  activeTool: ToolType;
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  roughness: number;
  fillStyle: FillStyle;
  viewTransform: ViewTransform;
  gridType: 'dots' | 'grid' | 'none';
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onUpdateElements: (elements: WhiteboardElement[]) => void;
  onUpdateNodes: (nodes: ResearchPaperNode[]) => void;
  onUpdateEdges: (edges: ResearchPaperEdge[]) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onOpenInspector: (nodeId: string) => void;
  onChangeViewTransform: (transform: ViewTransform) => void;
  onRecordHistory: () => void;
  onDropPaperNode?: (paperData: any, worldPos: Point) => void;
}

export const WhiteboardCanvas: React.FC<WhiteboardCanvasProps> = ({
  elements,
  paperNodes,
  paperEdges,
  activeTool,
  strokeColor,
  backgroundColor,
  strokeWidth,
  roughness,
  fillStyle,
  viewTransform,
  gridType,
  selectedNodeId,
  selectedEdgeId,
  onUpdateElements,
  onUpdateNodes,
  onUpdateEdges,
  onSelectNode,
  onSelectEdge,
  onOpenInspector,
  onChangeViewTransform,
  onRecordHistory,
  onDropPaperNode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Interaction States
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Drawing elements state
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentElement, setCurrentElement] = useState<WhiteboardElement | null>(null);

  // Node Dragging State
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });

  // Edge Connecting State
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null);
  const [connectingPort, setConnectingPort] = useState<string>('right');
  const [connectMousePos, setConnectMousePos] = useState<Point | null>(null);
  const [hoveredTargetNodeId, setHoveredTargetNodeId] = useState<string | null>(null);

  // Inline Text Editor State
  const [inlineTextInput, setInlineTextInput] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  // Transform screen to world coordinates
  const screenToWorld = useCallback(
    (screenX: number, screenY: number): Point => {
      return {
        x: (screenX - viewTransform.x) / viewTransform.zoom,
        y: (screenY - viewTransform.y) / viewTransform.zoom,
      };
    },
    [viewTransform]
  );

  // World to screen
  const worldToScreen = useCallback(
    (worldX: number, worldY: number): Point => {
      return {
        x: worldX * viewTransform.zoom + viewTransform.x,
        y: worldY * viewTransform.zoom + viewTransform.y,
      };
    },
    [viewTransform]
  );

  // Handle Spacebar hold for pan
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !inlineTextInput && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [inlineTextInput]);

  // Main Canvas Render Effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Draw background grid
    drawGrid(ctx, rect.width, rect.height, viewTransform, gridType);

    // Apply viewport camera transform
    ctx.save();
    ctx.translate(viewTransform.x, viewTransform.y);
    ctx.scale(viewTransform.zoom, viewTransform.zoom);

    const rc = rough.canvas(canvas);

    // 1. Draw all whiteboard elements (shapes, lines, texts, sketches)
    elements.forEach((el) => {
      drawWhiteboardElement(rc, ctx, el);
    });

    // 2. Draw current element being drawn live
    if (currentElement) {
      drawWhiteboardElement(rc, ctx, currentElement);
    }

    // 3. Draw Research Paper Edges (relationships)
    paperEdges.forEach((edge) => {
      const source = paperNodes.find((n) => n.id === edge.sourceNodeId);
      const target = paperNodes.find((n) => n.id === edge.targetNodeId);
      if (source && target) {
        drawResearchPaperEdge(rc, ctx, edge, source, target, edge.id === selectedEdgeId);
      }
    });

    // 4. Draw interactive rubber-band connecting line
    if (connectingSourceId && connectMousePos) {
      const source = paperNodes.find((n) => n.id === connectingSourceId);
      if (source) {
        const start = getPaperNodeCenter(source);
        ctx.strokeStyle = '#4f46e5';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 6]);

        rc.line(start.x, start.y, connectMousePos.x, connectMousePos.y, {
          stroke: '#4f46e5',
          strokeWidth: 2,
          roughness: 1.2,
        });

        // Small indicator circle at pointer
        ctx.beginPath();
        ctx.arc(connectMousePos.x, connectMousePos.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#4f46e5';
        ctx.fill();
        ctx.setLineDash([]);
      }
    }

    ctx.restore();
    ctx.restore();
  }, [
    elements,
    currentElement,
    paperNodes,
    paperEdges,
    viewTransform,
    gridType,
    selectedEdgeId,
    connectingSourceId,
    connectMousePos,
  ]);

  // Handle Zoom Wheel
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      const newZoom = Math.min(Math.max(viewTransform.zoom * zoomFactor, 0.2), 3.0);

      const newX = mouseX - (mouseX - viewTransform.x) * (newZoom / viewTransform.zoom);
      const newY = mouseY - (mouseY - viewTransform.y) * (newZoom / viewTransform.zoom);

      onChangeViewTransform({
        x: newX,
        y: newY,
        zoom: newZoom,
      });
    } else {
      // Pan with 2-finger trackpad or wheel
      onChangeViewTransform({
        x: viewTransform.x - e.deltaX,
        y: viewTransform.y - e.deltaY,
        zoom: viewTransform.zoom,
      });
    }
  };

  // Mouse Down on Canvas Container
  const handleMouseDown = (e: React.MouseEvent) => {
    // If middle click or space pressed or hand tool active: start pan
    if (e.button === 1 || isSpacePressed || activeTool === 'hand') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - viewTransform.x, y: e.clientY - viewTransform.y });
      return;
    }

    if (e.button !== 0) return; // Only primary button for drawing/selecting

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const worldPt = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    if (activeTool === 'select') {
      // Check if clicked near an edge label or edge line to select edge
      let clickedEdgeId: string | null = null;
      for (const edge of paperEdges) {
        const s = paperNodes.find((n) => n.id === edge.sourceNodeId);
        const t = paperNodes.find((n) => n.id === edge.targetNodeId);
        if (s && t) {
          const { start, end } = getEdgeConnectionPoints(s, t);
          const midX = (start.x + end.x) / 2;
          const midY = (start.y + end.y) / 2;
          const dist = Math.hypot(worldPt.x - midX, worldPt.y - midY);
          if (dist < 28) {
            clickedEdgeId = edge.id;
            break;
          }
        }
      }

      if (clickedEdgeId) {
        onSelectEdge(clickedEdgeId);
        onSelectNode(null);
      } else {
        onSelectNode(null);
        onSelectEdge(null);
      }
      return;
    }

    if (activeTool === 'text') {
      setInlineTextInput({
        x: worldPt.x,
        y: worldPt.y,
        text: '',
      });
      return;
    }

    if (activeTool === 'eraser') {
      // Erase nearest element
      const hitIndex = elements.findIndex((el) => {
        return (
          worldPt.x >= el.x &&
          worldPt.x <= el.x + el.width &&
          worldPt.y >= el.y &&
          worldPt.y <= el.y + el.height
        );
      });
      if (hitIndex >= 0) {
        onRecordHistory();
        const updated = elements.filter((_, idx) => idx !== hitIndex);
        onUpdateElements(updated);
      }
      return;
    }

    // Standard drawing tools: rectangle, diamond, ellipse, arrow, line, draw
    if (['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'draw'].includes(activeTool)) {
      setIsDrawing(true);
      const newEl: WhiteboardElement = {
        id: `elem-${Date.now()}`,
        type: activeTool as any,
        x: worldPt.x,
        y: worldPt.y,
        width: 1,
        height: 1,
        points: activeTool === 'draw' ? [{ x: 0, y: 0 }] : undefined,
        strokeColor,
        backgroundColor,
        strokeWidth,
        roughness,
        fillStyle,
        opacity: 1,
      };
      setCurrentElement(newEl);
    }
  };

  // Mouse Move
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const worldPt = screenToWorld(clientX, clientY);

    // 1. Panning Canvas
    if (isPanning) {
      onChangeViewTransform({
        ...viewTransform,
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    // 2. Dragging a Research Paper Node
    if (draggingNodeId) {
      const updatedNodes = paperNodes.map((n) => {
        if (n.id === draggingNodeId) {
          return {
            ...n,
            x: Math.round(worldPt.x - dragOffset.x),
            y: Math.round(worldPt.y - dragOffset.y),
          };
        }
        return n;
      });
      onUpdateNodes(updatedNodes);
      return;
    }

    // 3. Dragging a Connection Handle
    if (connectingSourceId) {
      setConnectMousePos(worldPt);

      // Check which node is hovered
      const hovered = paperNodes.find((n) => {
        if (n.id === connectingSourceId) return false;
        return (
          worldPt.x >= n.x &&
          worldPt.x <= n.x + n.width &&
          worldPt.y >= n.y &&
          worldPt.y <= n.y + n.height
        );
      });
      setHoveredTargetNodeId(hovered ? hovered.id : null);
      return;
    }

    // 4. Drawing Whiteboard Shape
    if (isDrawing && currentElement) {
      if (currentElement.type === 'draw') {
        const relX = worldPt.x - currentElement.x;
        const relY = worldPt.y - currentElement.y;
        setCurrentElement({
          ...currentElement,
          points: [...(currentElement.points || []), { x: relX, y: relY }],
        });
      } else {
        const width = worldPt.x - currentElement.x;
        const height = worldPt.y - currentElement.y;
        setCurrentElement({
          ...currentElement,
          width,
          height,
        });
      }
    }
  };

  // Mouse Up
  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
    }

    // Finish Dragging Node
    if (draggingNodeId) {
      setDraggingNodeId(null);
      onRecordHistory();
    }

    // Finish Connecting Handle
    if (connectingSourceId) {
      if (hoveredTargetNodeId && hoveredTargetNodeId !== connectingSourceId) {
        // Create new relationship edge
        const existing = paperEdges.some(
          (e) =>
            (e.sourceNodeId === connectingSourceId && e.targetNodeId === hoveredTargetNodeId) ||
            (e.sourceNodeId === hoveredTargetNodeId && e.targetNodeId === connectingSourceId)
        );

        if (!existing) {
          onRecordHistory();
          const newEdge: ResearchPaperEdge = {
            id: `edge-${Date.now()}`,
            sourceNodeId: connectingSourceId,
            targetNodeId: hoveredTargetNodeId,
            relationType: 'extends',
            label: 'Extends',
            style: 'solid',
            color: '#4f46e5',
          };
          onUpdateEdges([...paperEdges, newEdge]);
          onSelectEdge(newEdge.id);
        }
      }
      setConnectingSourceId(null);
      setConnectMousePos(null);
      setHoveredTargetNodeId(null);
    }

    // Commit Drawing Element
    if (isDrawing && currentElement) {
      if (
        currentElement.type === 'draw' ||
        Math.abs(currentElement.width) > 3 ||
        Math.abs(currentElement.height) > 3
      ) {
        onRecordHistory();
        // Normalize box if negative width/height
        let normalized = { ...currentElement };
        if (['rectangle', 'diamond', 'ellipse'].includes(currentElement.type)) {
          if (normalized.width < 0) {
            normalized.x += normalized.width;
            normalized.width = Math.abs(normalized.width);
          }
          if (normalized.height < 0) {
            normalized.y += normalized.height;
            normalized.height = Math.abs(normalized.height);
          }
        }
        onUpdateElements([...elements, normalized]);
      }
      setIsDrawing(false);
      setCurrentElement(null);
    }
  };

  // Node Drag Start
  const handleStartDragNode = (nodeId: string, e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const worldPt = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const node = paperNodes.find((n) => n.id === nodeId);
    if (!node) return;

    setDraggingNodeId(nodeId);
    setDragOffset({
      x: worldPt.x - node.x,
      y: worldPt.y - node.y,
    });
    onSelectNode(nodeId);
    onSelectEdge(null);
  };

  // Node Connection Start
  const handleStartConnect = (
    nodeId: string,
    port: 'top' | 'bottom' | 'left' | 'right',
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setConnectingSourceId(nodeId);
    setConnectingPort(port);
    const node = paperNodes.find((n) => n.id === nodeId);
    if (node) {
      setConnectMousePos(getPaperNodeCenter(node));
    }
  };

  // Drop connection on node
  const handleConnectDrop = (targetNodeId: string) => {
    if (connectingSourceId && targetNodeId && connectingSourceId !== targetNodeId) {
      const existing = paperEdges.some(
        (e) => e.sourceNodeId === connectingSourceId && e.targetNodeId === targetNodeId
      );
      if (!existing) {
        onRecordHistory();
        const newEdge: ResearchPaperEdge = {
          id: `edge-${Date.now()}`,
          sourceNodeId: connectingSourceId,
          targetNodeId,
          relationType: 'cites',
          label: 'Cites',
          style: 'solid',
          color: '#4f46e5',
        };
        onUpdateEdges([...paperEdges, newEdge]);
        onSelectEdge(newEdge.id);
      }
      setConnectingSourceId(null);
      setConnectMousePos(null);
      setHoveredTargetNodeId(null);
    }
  };

  // Commit Inline Text Element
  const handleCommitInlineText = () => {
    if (inlineTextInput && inlineTextInput.text.trim()) {
      onRecordHistory();
      const newEl: WhiteboardElement = {
        id: `text-${Date.now()}`,
        type: 'text',
        x: inlineTextInput.x,
        y: inlineTextInput.y,
        width: 300,
        height: 50,
        strokeColor,
        backgroundColor: 'transparent',
        strokeWidth: 1,
        roughness: 1,
        fillStyle: 'none',
        opacity: 1,
        text: inlineTextInput.text,
        fontSize: 18,
        fontFamily: 'handwritten',
      };
      onUpdateElements([...elements, newEl]);
    }
    setInlineTextInput(null);
  };

  return (
    <div
      ref={containerRef}
      id="whiteboard-viewport-container"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const data = e.dataTransfer.getData('application/json');
        if (data && onDropPaperNode) {
          try {
            const paper = JSON.parse(data);
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) {
              const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
              onDropPaperNode(paper, worldPos);
            }
          } catch (err) {
            console.error('Failed to parse dropped paper JSON', err);
          }
        }
      }}
      className={`relative w-full h-full overflow-hidden select-none bg-white ${
        isPanning || isSpacePressed || activeTool === 'hand'
          ? 'cursor-grab active:cursor-grabbing'
          : activeTool === 'draw'
          ? 'cursor-crosshair'
          : activeTool === 'text'
          ? 'cursor-text'
          : activeTool === 'eraser'
          ? 'cursor-not-allowed'
          : 'cursor-default'
      }`}
    >
      {/* 1. Underlying Rough.js 2D Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* 2. Interactive DOM Container for Research Paper Graph Nodes */}
      <div
        id="whiteboard-nodes-dom-container"
        style={{
          transform: `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.zoom})`,
          transformOrigin: '0 0',
        }}
        className="absolute inset-0 pointer-events-none"
      >
        {paperNodes.map((node) => (
          <div key={node.id} className="pointer-events-auto">
            <ResearchPaperCard
              node={node}
              isSelected={node.id === selectedNodeId}
              isConnectingSource={node.id === connectingSourceId}
              isConnectingTarget={node.id === hoveredTargetNodeId}
              zoom={viewTransform.zoom}
              onSelect={(nodeId, e) => {
                e.stopPropagation();
                onSelectNode(nodeId);
                onSelectEdge(null);
              }}
              onOpenInspector={(nodeId, e) => {
                e.stopPropagation();
                onSelectNode(nodeId);
                onOpenInspector(nodeId);
              }}
              onStartDrag={handleStartDragNode}
              onStartConnect={handleStartConnect}
              onConnectDrop={handleConnectDrop}
            />
          </div>
        ))}
      </div>

      {/* 3. Inline Text Input overlay when Text Tool is active */}
      {inlineTextInput && (
        <div
          style={{
            left: `${worldToScreen(inlineTextInput.x, inlineTextInput.y).x}px`,
            top: `${worldToScreen(inlineTextInput.x, inlineTextInput.y).y}px`,
          }}
          className="absolute z-30"
        >
          <textarea
            autoFocus
            value={inlineTextInput.text}
            onChange={(e) =>
              setInlineTextInput({ ...inlineTextInput, text: e.target.value })
            }
            onBlur={handleCommitInlineText}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleCommitInlineText();
              }
              if (e.key === 'Escape') setInlineTextInput(null);
            }}
            placeholder="Type whiteboard note..."
            style={{
              color: strokeColor,
              fontFamily: 'Caveat, Kalam, cursive',
              fontSize: `${18 * viewTransform.zoom}px`,
            }}
            className="p-1 bg-white/90 border border-blue-400 rounded shadow-md outline-none min-w-[200px] min-h-[50px] resize"
          />
        </div>
      )}
    </div>
  );
};
