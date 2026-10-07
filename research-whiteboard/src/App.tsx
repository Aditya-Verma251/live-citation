import React, { useState, useEffect, useMemo, useReducer, useRef } from 'react';
import { INITIAL_FILES, INITIAL_DASHBOARDS } from './data/initialData';
import {
  FileItem,
  TabItem,
  DashboardData,
  ResearchPaperNode,
  RelationType,
  ViewTransform,
  Point,
  EdgeMetadata,
} from './types';
import { Sidebar, PRESET_RESEARCH_PAPERS } from './components/Sidebar';
import { TopNav } from './components/TopNav';
import { WhiteboardCanvas, WhiteboardHandle } from './components/WhiteboardCanvas';
import { PaperInspector } from './components/PaperInspector';
import { GraphSidebar } from './components/GraphSidebar';
import { EdgeFlowOverlay } from './components/EdgeFlowOverlay';
import { AddPaperModal } from './components/AddPaperModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { TabBar } from './components/TabBar';
import { getAllLinkedPapersForDashboard, isPaperOnDashboard } from './data/linkedPapersData';
import { layoutCard } from './utils/excalidrawAdapter';
import { EDGE_FLOW_IDLE, edgeFlowReducer, isEdgeFlowActive, isPickingNode } from './utils/edgeFlow';
import * as graph from './utils/graphOps';
import { RELATION_LABELS, type NewNodeInput } from './utils/graphOps';

const EMPTY_VIEW: ViewTransform = { x: 100, y: 100, zoom: 1 };

/** Nudge a new card downward until it no longer overlaps an existing one. */
const findFreeSpot = (nodes: ResearchPaperNode[], x: number, y: number, w: number, h: number): Point => {
  let ny = y;
  for (let i = 0; i < 25; i++) {
    const hit = nodes.some((n) => {
      const L = layoutCard(n);
      return x < n.x + L.width + 24 && x + w + 24 > n.x && ny < n.y + L.height + 24 && ny + h + 24 > n.y;
    });
    if (!hit) break;
    ny += h + 30;
  }
  return { x, y: ny };
};

export default function App() {
  // File System State
  const [files, setFiles] = useState<FileItem[]>(INITIAL_FILES);
  const [dashboards, setDashboards] = useState<Record<string, DashboardData>>(INITIAL_DASHBOARDS);

  // Tabs State
  const [tabs, setTabs] = useState<TabItem[]>([
    { id: 'dash-1', fileId: 'file-1', title: 'Transformer Lineage.excali' },
    { id: 'dash-2', fileId: 'file-2', title: 'Diffusion & Generative.excali' },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('dash-1');

  // UI Panels State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isGraphSidebarOpen, setIsGraphSidebarOpen] = useState(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isAddPaperModalOpen, setIsAddPaperModalOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  // Selection State
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Interactive "Add edge" flow: pick source -> pick destination -> pick relationship -> edge is created
  const [edgeFlow, dispatchEdgeFlow] = useReducer(edgeFlowReducer, EDGE_FLOW_IDLE);

  const canvasRef = useRef<WhiteboardHandle>(null);

  // Active Dashboard Data
  const currentDashboard: DashboardData = useMemo(() => {
    return (
      dashboards[activeTabId] || {
        id: activeTabId,
        title: 'Untitled Whiteboard.excali',
        elements: [],
        paperNodes: [],
        paperEdges: [],
        viewTransform: EMPTY_VIEW,
        gridType: 'dots',
        updatedAt: new Date().toISOString(),
      }
    );
  }, [dashboards, activeTabId]);

  /**
   * Safe way to change the active board. Uses the *latest* state (prev), so several
   * updates fired in the same tick (e.g. from the canvas) never overwrite each other.
   */
  const patchBoard = (fn: (d: DashboardData) => Partial<DashboardData>, tabId: string = activeTabId) => {
    setDashboards((prev) => {
      const d = prev[tabId];
      if (!d) return prev;
      return { ...prev, [tabId]: { ...d, ...fn(d), updatedAt: new Date().toISOString() } };
    });
  };

  /**
   * The ONLY way the graph changes: a pure graphOps function (graph -> graph) applied to the active board.
   * The canvas re-renders from this state; it never writes back.
   */
  const applyGraph = (fn: (g: graph.GraphState) => graph.GraphState) =>
    patchBoard((d) => {
      const next = fn({ nodes: d.paperNodes, edges: d.paperEdges });
      return { paperNodes: next.nodes, paperEdges: next.edges };
    });

  // App-level keyboard shortcuts (Excalidraw handles its own tools / undo / redo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setIsAddPaperModalOpen(true);
      } else if (e.key === '?') {
        setIsShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Esc cancels the edge flow from anywhere (including while a text field in the overlay has focus)
  const edgeFlowActive = isEdgeFlowActive(edgeFlow);
  useEffect(() => {
    if (!edgeFlowActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatchEdgeFlow({ type: 'cancel' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [edgeFlowActive]);

  // If a node picked in the flow disappears (deleted in the sidebar / inspector), abandon the flow
  useEffect(() => {
    const ids =
      edgeFlow.step === 'pick-target'
        ? [edgeFlow.sourceId]
        : edgeFlow.step === 'pick-type'
        ? [edgeFlow.sourceId, edgeFlow.targetId]
        : [];
    if (ids.some((id) => !currentDashboard.paperNodes.some((n) => n.id === id))) {
      dispatchEdgeFlow({ type: 'cancel' });
    }
  }, [edgeFlow, currentDashboard.paperNodes]);

  /* ------------------------------ files & tabs ------------------------------ */

  const handleOpenFile = (file: FileItem) => {
    if (!file.dashboardId) return;
    const existingTab = tabs.find((t) => t.id === file.dashboardId);
    if (existingTab) {
      switchTab(existingTab.id);
    } else {
      setTabs((prev) => [...prev, { id: file.dashboardId!, fileId: file.id, title: file.name }]);
      switchTab(file.dashboardId);
    }
  };

  const switchTab = (tabId: string) => {
    dispatchEdgeFlow({ type: 'cancel' }); // a half-finished edge belongs to the board it was started on
    setActiveTabId(tabId);
    setSelectedNodeId(null);
    setIsInspectorOpen(false);
  };

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      handleCreateFile(null, 'Scratchpad.excali');
      return;
    }
    const tabIndex = tabs.findIndex((t) => t.id === tabId);
    const updatedTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(updatedTabs);
    if (activeTabId === tabId) {
      switchTab(updatedTabs[Math.max(0, tabIndex - 1)].id);
    }
  };

  const handleCreateFile = (parentId: string | null = null, name?: string) => {
    const stamp = Date.now();
    const newDashId = `dash-${stamp}`;
    const newFileId = `file-${stamp}`;
    const fileName = name || `Research-Board-${Object.keys(dashboards).length + 1}.excali`;

    setFiles((prev) => [
      ...prev,
      { id: newFileId, name: fileName, isFolder: false, parentId, dashboardId: newDashId, colorTag: '#6366f1' },
    ]);
    setDashboards((prev) => ({
      ...prev,
      [newDashId]: {
        id: newDashId,
        title: fileName,
        updatedAt: new Date().toISOString(),
        gridType: 'dots',
        viewTransform: { x: 0, y: 0, zoom: 1 },
        elements: [],
        paperNodes: [],
        paperEdges: [],
      },
    }));
    setTabs((prev) => [...prev, { id: newDashId, fileId: newFileId, title: fileName }]);
    switchTab(newDashId);
  };

  const handleCreateFolder = (parentId: string | null = null, name?: string) => {
    setFiles((prev) => [
      ...prev,
      { id: `folder-${Date.now()}`, name: name || 'New Research Topic', isFolder: true, parentId },
    ]);
  };

  const handleDeleteFile = (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;

    if (file.dashboardId) {
      const dashId = file.dashboardId;
      const remaining = tabs.filter((t) => t.id !== dashId);
      setTabs(remaining);
      if (activeTabId === dashId && remaining.length > 0) switchTab(remaining[0].id);
    }
    setFiles((prev) => prev.filter((f) => f.id !== fileId && f.parentId !== fileId));
  };

  const handleRenameFile = (fileId: string, newName: string) => {
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, name: newName } : f)));
    const file = files.find((f) => f.id === fileId);
    if (file?.dashboardId) {
      const dashId = file.dashboardId;
      setTabs((prev) => prev.map((t) => (t.id === dashId ? { ...t, title: newName } : t)));
      patchBoard(() => ({ title: newName }), dashId);
    }
  };

  const handleRenameCurrentTitle = (newTitle: string) => {
    setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, title: newTitle } : t)));
    patchBoard(() => ({ title: newTitle }));
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) {
      setFiles((prev) => prev.map((f) => (f.id === activeTab.fileId ? { ...f, name: newTitle } : f)));
    }
  };

  /* ---------- events from the canvas (read-only: selection / open only, never graph edits) ---------- */

  // Single click only selects; the inspector opens on double-click (handleOpenNode).
  const handleCanvasSelectNode = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId === null) setIsInspectorOpen(false);
  };

  const handleOpenNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setIsInspectorOpen(true);
  };

  const removeNodes = (ids: string[]) => {
    applyGraph((g) => graph.removeNodes(g, ids));
    if (selectedNodeId && ids.includes(selectedNodeId)) {
      setSelectedNodeId(null);
      setIsInspectorOpen(false);
    }
  };

  const handleEdgesDeleted = (ids: string[]) => {
    applyGraph((g) => graph.removeEdges(g, ids));
  };

  // A node was dragged on the canvas: persist its new coordinates (positions only, structure untouched).
  const handleNodesMoved = (positions: Record<string, Point>) =>
    patchBoard((d) => ({
      paperNodes: d.paperNodes.map((n) => (positions[n.id] ? { ...n, ...positions[n.id] } : n)),
    }));

  const handleSceneChange = (sceneElements: any[]) => patchBoard(() => ({ sceneElements }));
  const handleViewChange = (viewTransform: ViewTransform) => patchBoard(() => ({ viewTransform }));

  /* ------------------------------- adding papers ------------------------------- */

  const viewportCenter = (): Point => canvasRef.current?.getViewportCenter() ?? { x: 300, y: 250 };

  const handleAddPaperNode = (paperData: Omit<ResearchPaperNode, 'id' | 'x' | 'y'>) => {
    const c = viewportCenter();
    const draft = { ...paperData, id: `paper-${Date.now()}`, x: 0, y: 0 } as ResearchPaperNode;
    const L = layoutCard(draft);
    const spot = findFreeSpot(currentDashboard.paperNodes, Math.round(c.x - L.width / 2), Math.round(c.y - L.height / 2), L.width, L.height);
    const newNode = { ...draft, x: spot.x, y: spot.y };

    applyGraph((g) => graph.addNode(g, newNode));
    setSelectedNodeId(newNode.id);
    setIsInspectorOpen(true);
  };

  const handleQuickAddPresetPaper = (presetKey: string) => {
    const preset = PRESET_RESEARCH_PAPERS.find((p) => p.key === presetKey);
    if (!preset) return;

    const c = viewportCenter();
    const draft: ResearchPaperNode = {
      id: `paper-${preset.key}-${Date.now()}`,
      title: preset.title,
      authors: preset.authors,
      year: preset.year,
      venue: preset.venue,
      abstract: `Key foundational research publication: ${preset.title}. Explored in depth on this board.`,
      keyInsights: [
        'Novel formulation addressing critical scaling bottlenecks',
        'State-of-the-art benchmark results with reduced overhead',
      ],
      tags: preset.tags,
      citationsCount: 15000,
      status: 'seminal',
      color: preset.color,
      x: 0,
      y: 0,
      width: 320,
      height: 195,
    };
    const L = layoutCard(draft);
    const spot = findFreeSpot(currentDashboard.paperNodes, Math.round(c.x - L.width / 2), Math.round(c.y - L.height / 2), L.width, L.height);
    const newNode = { ...draft, ...spot };

    applyGraph((g) => graph.addNode(g, newNode));
    setSelectedNodeId(newNode.id);
  };

  const handleAddConnectedPaper = (sourceNodeId: string) => {
    const source = currentDashboard.paperNodes.find((n) => n.id === sourceNodeId);
    if (!source) return;

    const draft: ResearchPaperNode = {
      id: `paper-related-${Date.now()}`,
      title: `Continuation of ${source.title.split(':')[0]}`,
      authors: 'Research Collaborators',
      year: typeof source.year === 'number' ? source.year + 1 : 2024,
      venue: 'NeurIPS',
      abstract: `Direct followup and experimental validation building on ${source.title}.`,
      keyInsights: ['Improved computational efficiency', 'Extended empirical evaluation'],
      tags: [...source.tags.slice(0, 2), 'Followup'],
      status: 'to-read',
      color: source.color,
      x: 0,
      y: 0,
      width: 320,
      height: 195,
    };
    const L = layoutCard(draft);
    const spot = findFreeSpot(currentDashboard.paperNodes, source.x + layoutCard(source).width + 80, source.y, L.width, L.height);
    const newNode = { ...draft, ...spot };
    applyGraph((g) =>
      graph.addEdge(graph.addNode(g, newNode), {
        sourceNodeId: source.id,
        targetNodeId: newNode.id,
        relationType: 'extends',
        label: RELATION_LABELS.extends,
      })
    );
    setSelectedNodeId(newNode.id);
  };

  /**
   * Turn a "linked paper" (from the right sidebar) into a card + an arrow to the paper it relates to.
   * (x, y) is the top-left corner of the new card.
   */
  const addLinkedPaper = (paper: any, x: number, y: number) => {
    const nodes = currentDashboard.paperNodes;
    const existing = nodes.find(
      (n) => n.id === paper.id || n.title.toLowerCase() === paper.title.toLowerCase()
    );
    if (existing) {
      handleLocateNode(existing.id);
      return;
    }

    const newNode: ResearchPaperNode = {
      id: paper.id || `node-${Date.now()}`,
      title: paper.title,
      authors: paper.authors || 'Unknown Authors',
      year: paper.year || new Date().getFullYear(),
      venue: paper.venue || 'ArXiv',
      abstract: paper.abstract || paper.relationDescription || '',
      keyInsights: paper.keyInsights || (paper.relationDescription ? [paper.relationDescription] : []),
      tags: paper.tags || ['Research'],
      arxivId: paper.arxivId,
      url: paper.url,
      citationsCount: paper.citationsCount,
      status: paper.status || 'to-read',
      color: paper.color || '#4f46e5',
      x: Math.round(x),
      y: Math.round(y),
      width: 320,
      height: 195,
    };

    // Which existing card does this paper relate to?
    // (the LinkedPaperItem field is `linkedToNodeId`; fall back to whatever is selected)
    const parent =
      nodes.find((n) => n.id === paper.linkedToNodeId) ||
      (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : undefined);

    const rel: RelationType = parent && paper.linkedToNodeId === parent.id ? paper.relationType || 'cites' : 'extends';
    applyGraph((g) => {
      const withNode = graph.addNode(g, newNode);
      return parent
        ? graph.addEdge(withNode, {
            sourceNodeId: parent.id,
            targetNodeId: newNode.id,
            relationType: rel,
            label: RELATION_LABELS[rel] || 'Related',
          })
        : withNode;
    });
    setSelectedNodeId(newNode.id);
  };

  // "Add as Node" button: place it to the right of its parent, on a free spot.
  const handleAddLinkedPaperAsNode = (paper: any) => {
    const nodes = currentDashboard.paperNodes;
    const L = layoutCard({ ...paper, width: 320 } as ResearchPaperNode);
    const parent =
      nodes.find((n) => n.id === paper.linkedToNodeId) ||
      (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : undefined);

    let spot: Point;
    if (parent) {
      spot = findFreeSpot(nodes, parent.x + layoutCard(parent).width + 80, parent.y, L.width, L.height);
    } else {
      const c = viewportCenter();
      spot = findFreeSpot(nodes, c.x - L.width / 2, c.y - L.height / 2, L.width, L.height);
    }
    addLinkedPaper(paper, spot.x, spot.y);
  };

  /* ------------------------------ inspector actions ------------------------------ */

  /** Every edge (inspector, "connected paper", graph sidebar) is created through graphOps. */
  const addEdge = (meta: EdgeMetadata) => applyGraph((g) => graph.addEdge(g, meta));

  const handleCreateEdge = (sourceId: string, targetId: string, relationType: RelationType) =>
    addEdge({ sourceNodeId: sourceId, targetNodeId: targetId, relationType });

  const handleDeleteEdge = (edgeId: string) => handleEdgesDeleted([edgeId]);

  /* ------------------------------ graph manager sidebar ------------------------------ */

  const handleGraphAddNode = (input: NewNodeInput) => {
    const draft = graph.createNode(input, { x: 0, y: 0 });
    let pos: Point;
    if (input.x !== undefined && input.y !== undefined) {
      pos = { x: input.x, y: input.y };
    } else {
      const c = viewportCenter();
      const L = layoutCard(draft);
      pos = findFreeSpot(currentDashboard.paperNodes, Math.round(c.x - L.width / 2), Math.round(c.y - L.height / 2), L.width, L.height);
    }
    const node = { ...draft, x: Math.round(pos.x), y: Math.round(pos.y) };
    applyGraph((g) => graph.addNode(g, node));
    setSelectedNodeId(node.id);
  };

  /* ------------------------------ add-edge flow ------------------------------ */

  // Step 4: the user picked a relationship -> generate the edge through graphOps. React state changes, the canvas
  // re-renders from it, and the adapter produces an arrow bound to both node ellipses (and locked).
  const handleChooseRelation = (relationType: RelationType, label?: string) => {
    if (edgeFlow.step !== 'pick-type') return;
    addEdge({
      sourceNodeId: edgeFlow.sourceId,
      targetNodeId: edgeFlow.targetId,
      relationType,
      label: label?.trim() || RELATION_LABELS[relationType],
    });
    dispatchEdgeFlow({ type: 'cancel' }); // back to idle
  };

  // A linked paper dragged from the sidebar and dropped on the canvas (point = top-left of the new node)
  const handleDropLinkedPaper = (paper: any, point: Point) => addLinkedPaper(paper, point.x, point.y);

  /* ---------------------------------- export / import ---------------------------------- */

  const handleExportPNG = () => {
    const name = `${currentDashboard.title.replace(/\.[^/.]+$/, '')}.png`;
    canvasRef.current?.exportPNG(name);
  };

  const handleExportJSON = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(currentDashboard, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', `${currentDashboard.title}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleImportJSON = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target?.result as string);
          if (imported.id && imported.paperNodes) {
            setDashboards((prev) => ({
              ...prev,
              [activeTabId]: {
                ...imported,
                id: activeTabId,
                title: imported.title || currentDashboard.title,
                revision: (prev[activeTabId]?.revision ?? 0) + 1, // forces the canvas to reload
              },
            }));
            setSelectedNodeId(null);
            setIsInspectorOpen(false);
          }
        } catch {
          alert('Invalid JSON file format');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const dashboardLinkedPapersCount = useMemo(
    () => getAllLinkedPapersForDashboard(currentDashboard.paperNodes).length,
    [currentDashboard.paperNodes]
  );

  function handleLocateNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    canvasRef.current?.locateNode(nodeId);
  }

  const selectedNode = currentDashboard.paperNodes.find((n) => n.id === selectedNodeId) || null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-slate-900 font-sans antialiased">
      {/* 1. Sidebar: file tree + preset paper hub */}
      {isSidebarOpen && (
        <Sidebar
          files={files}
          activeDashboardId={activeTabId}
          openTabDashboardIds={tabs.map((t) => t.id)}
          onOpenFile={handleOpenFile}
          onCreateFile={handleCreateFile}
          onCreateFolder={handleCreateFolder}
          onDeleteFile={handleDeleteFile}
          onRenameFile={handleRenameFile}
          onQuickAddPresetPaper={handleQuickAddPresetPaper}
        />
      )}

      {/* 2. Main work area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        <TopNav
          title={currentDashboard.title}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isGraphSidebarOpen={isGraphSidebarOpen}
          onToggleGraphSidebar={() => setIsGraphSidebarOpen(!isGraphSidebarOpen)}
          linkedPapersCount={dashboardLinkedPapersCount}
          onRenameTitle={handleRenameCurrentTitle}
          onExportPNG={handleExportPNG}
          onExportJSON={handleExportJSON}
          onImportJSON={handleImportJSON}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
        />

        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={switchTab}
          onCloseTab={handleCloseTab}
          onNewTab={() => handleCreateFile(null)}
        />

        <div className="flex-1 flex overflow-hidden relative">
          <main className="flex-1 relative overflow-hidden bg-slate-50" id="whiteboard-viewport-container">
            {/* key => every tab (and every JSON import) gets its own fresh Excalidraw instance */}
            <WhiteboardCanvas
              key={`${activeTabId}:${currentDashboard.revision ?? 0}`}
              ref={canvasRef}
              paperNodes={currentDashboard.paperNodes}
              paperEdges={currentDashboard.paperEdges}
              legacyElements={currentDashboard.elements}
              sceneElements={currentDashboard.sceneElements}
              viewTransform={currentDashboard.viewTransform}
              onSelectNode={handleCanvasSelectNode}
              onOpenNode={handleOpenNode}
              onNodesMoved={handleNodesMoved}
              onSceneChange={handleSceneChange}
              onViewChange={handleViewChange}
              isPickingNode={isPickingNode(edgeFlow)}
              onPickNode={(nodeId) => dispatchEdgeFlow({ type: 'pick-node', nodeId })}
              onDropLinkedPaper={handleDropLinkedPaper}
            />

            {/* Step prompts for the add-edge flow */}
            <EdgeFlowOverlay
              flow={edgeFlow}
              nodes={currentDashboard.paperNodes}
              edges={currentDashboard.paperEdges}
              onBack={() => dispatchEdgeFlow({ type: 'back' })}
              onCancel={() => dispatchEdgeFlow({ type: 'cancel' })}
              onChooseRelation={handleChooseRelation}
            />
          </main>

          {/* Merged sidebar: linked-paper discovery (drag & drop) + node / edge management */}
          <GraphSidebar
            isOpen={isGraphSidebarOpen}
            onClose={() => setIsGraphSidebarOpen(false)}
            nodes={currentDashboard.paperNodes}
            edges={currentDashboard.paperEdges}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleLocateNode}
            onLocateNode={handleLocateNode}
            onAddLinkedPaperAsNode={handleAddLinkedPaperAsNode}
            onAddNode={handleGraphAddNode}
            onDeleteNode={(id) => removeNodes([id])}
            onDeleteEdge={handleDeleteEdge}
            isEdgeFlowActive={edgeFlowActive}
            onStartAddEdge={() => dispatchEdgeFlow({ type: 'start' })}
            onCancelAddEdge={() => dispatchEdgeFlow({ type: 'cancel' })}
          />
        </div>
      </div>

      {/* 3. Paper inspector drawer (opens when a card is clicked) */}
      {isInspectorOpen && selectedNode && (
        <PaperInspector
          node={selectedNode}
          allNodes={currentDashboard.paperNodes}
          edges={currentDashboard.paperEdges}
          onUpdateNode={(updated) => applyGraph((g) => graph.updateNode(g, updated))}
          onDeleteNode={(id) => removeNodes([id])}
          onCreateEdge={handleCreateEdge}
          onDeleteEdge={handleDeleteEdge}
          onClose={() => {
            setIsInspectorOpen(false);
            setSelectedNodeId(null);
          }}
          onFocusNode={handleLocateNode}
          onAddConnectedPaper={handleAddConnectedPaper}
        />
      )}

      {/* 4. Add research paper modal */}
      <AddPaperModal
        isOpen={isAddPaperModalOpen}
        onClose={() => setIsAddPaperModalOpen(false)}
        onAddPaper={handleAddPaperNode}
      />

      {/* 5. Shortcuts modal */}
      <ShortcutsModal isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />
    </div>
  );
}
