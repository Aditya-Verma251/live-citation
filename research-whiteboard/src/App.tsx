import React, { useState, useEffect, useMemo, useReducer, useRef } from 'react';
import { INITIAL_FILES, INITIAL_DASHBOARDS } from './data/initialData';
import {
  FileItem,
  TabItem,
  DashboardData,
  ResearchPaperNode,
  ResearchPaperEdge,
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
import { CreateResearchModal } from './components/CreateResearchModal';
import { getProjectData, startResearchAndWait, findWhiteboardRelationships, type ResearchInput, type WhiteboardRelationshipScanResult } from './services/researchApi';
import { mapResearchGraph } from './services/researchMappers';
import { getAllLinkedPapersForDashboard } from './data/linkedPapersData';
import { layoutCard } from './utils/excalidrawAdapter';
import { isSameScholarlyPaper, withCanonicalPaperId } from './utils/paperIdentifiers';
import { EDGE_FLOW_IDLE, edgeFlowReducer, isEdgeFlowActive, isPickingNode } from './utils/edgeFlow';
import * as graph from './utils/graphOps';
import { RELATION_LABELS, type NewNodeInput } from './utils/graphOps';

const EMPTY_VIEW: ViewTransform = { x: 100, y: 100, zoom: 1 };

type RelationshipScanFeedback = {
  dashboardId: string;
  status: 'checking' | 'complete' | 'error';
  message: string;
  checkedCount?: number;
  connectionCount?: number;
  connectedPaperCount?: number;
  result?: WhiteboardRelationshipScanResult;
};

const RELATIONSHIP_DIAGNOSTIC_LABELS: Record<string, string> = {
  similar_research_focus: 'Similar research focus',
  similar_methodology: 'Similar methodology',
  shared_research_gap: 'Shared research gap',
  potentially_addresses_gap_a_to_b: 'Existing paper gap → new paper',
  potentially_addresses_gap_b_to_a: 'New paper gap → existing paper',
  potentially_conflicting_findings: 'Potentially conflicting findings',
};

const AUTO_RELATION_PRESENTATION: Record<string, { relationType: RelationType; label: string }> = {
  similar_research_focus: { relationType: 'custom', label: 'Similar research focus' },
  similar_methodology: { relationType: 'custom', label: 'Similar methodology' },
  shared_research_gap: { relationType: 'custom', label: 'Shared research gap' },
  potentially_addresses_gap: { relationType: 'improves', label: 'May address research gap' },
  potentially_conflicting_findings: { relationType: 'contradicts', label: 'Potentially conflicting findings' },
};

const autoRelationshipKey = (edge: Pick<ResearchPaperEdge, 'sourceNodeId' | 'targetNodeId' | 'backendRelationType'>) =>
  `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.backendRelationType || ''}`;

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
  const [isResearchModalOpen, setIsResearchModalOpen] = useState(false);
  const [isResearchCreating, setIsResearchCreating] = useState(false);
  const [researchCreateError, setResearchCreateError] = useState<string | null>(null);
  const [relationshipScanFeedback, setRelationshipScanFeedback] = useState<RelationshipScanFeedback | null>(null);
  const relationshipScanSequence = useRef(0);

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

  // Research dashboards expose two independent graph views while keeping one canonical node
  // set and one persisted edge set. The citation view includes OpenAlex citations and related-work
  // links; the relationships view contains only content-inferred relationships.
  const citationGraphEdges = useMemo(
    () => currentDashboard.paperEdges.filter((edge) => edge.graphKind === 'citation' || (!edge.graphKind && edge.relationType === 'cites')),
    [currentDashboard.paperEdges],
  );
  const identifiedRelationshipEdges = useMemo(
    () => currentDashboard.paperEdges.filter((edge) => edge.graphKind === 'identified' || (!edge.graphKind && edge.relationType !== 'cites')),
    [currentDashboard.paperEdges],
  );
  const activeResearchGraphView = currentDashboard.researchGraphView ?? 'citations';
  const visibleGraphEdges = currentDashboard.researchProjectId
    ? (activeResearchGraphView === 'citations' ? citationGraphEdges : identifiedRelationshipEdges)
    : currentDashboard.paperEdges;

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

  /** Start a backend research job, load its graph data, and open it as a new whiteboard tab. */
  const handleCreateResearchDashboard = async (input: ResearchInput) => {
    setIsResearchCreating(true);
    setResearchCreateError(null);
    try {
      // POST /api/research returns a queued job_id, not a project_id.
      // Poll GET /api/jobs/{job_id} until the pipeline creates the project.
      const completedJob = await startResearchAndWait(input);
      const projectId = completedJob.project_id;
      const result = await getProjectData(projectId);
      const { nodes, edges } = mapResearchGraph(result.papers, result.graph, result.relationships);
      if (nodes.length === 0) {
        throw new Error('The project was created, but no papers were found in the papers/graph response. Check the response shape in src/services/researchMappers.ts.');
      }

      const stamp = Date.now();
      const dashboardId = `research-${projectId}-${stamp}`;
      const fileId = `file-${stamp}`;
      const resolvedPaperTitle = result.summary?.resolved_paper?.title
        || result.summary?.input_resolution?.resolved_paper?.title;
      const titleSource = resolvedPaperTitle || input.value;
      const safeTitle = titleSource.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 54) || 'Research project';
      const fileName = `${safeTitle}.excali`;
      const dashboard: DashboardData = {
        id: dashboardId,
        title: fileName,
        updatedAt: new Date().toISOString(),
        gridType: 'dots',
        viewTransform: { x: 0, y: 0, zoom: 1 },
        elements: [],
        paperNodes: nodes,
        paperEdges: edges,
        researchProjectId: projectId,
        researchGraphView: 'citations',
        researchSummary: result.summary,
        researchGaps: result.gaps,
      };

      setFiles((prev) => [...prev, {
        id: fileId,
        name: fileName,
        isFolder: false,
        parentId: null,
        dashboardId,
        colorTag: '#6366f1',
      }]);
      setDashboards((prev) => ({ ...prev, [dashboardId]: dashboard }));
      setTabs((prev) => [...prev, { id: dashboardId, fileId, title: fileName }]);
      switchTab(dashboardId);
      setIsResearchModalOpen(false);
    } catch (error) {
      setResearchCreateError(error instanceof Error ? error.message : 'Could not create the research dashboard.');
    } finally {
      setIsResearchCreating(false);
    }
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

  /**
   * The single insertion path for every new paper node. The node is added
   * immediately, then the offline backend compares it with every paper that
   * was already on this whiteboard and returns inferred edges.
   */
  const addNodeAndScanRelationships = (
    newNode: ResearchPaperNode,
    initialEdges: EdgeMetadata[] = [],
  ) => {
    const boardId = activeTabId;
    const boardSnapshot = dashboards[boardId] || currentDashboard;
    const normalizedNode = withCanonicalPaperId(newNode);
    const existingMatch = boardSnapshot.paperNodes.find((paper) =>
      paper.id === normalizedNode.id || isSameScholarlyPaper(paper, normalizedNode),
    );
    if (existingMatch) {
      setSelectedNodeId(existingMatch.id);
      setRelationshipScanFeedback({
        dashboardId: boardId,
        status: 'complete',
        checkedCount: 0,
        connectionCount: 0,
        message: `This paper is already on the whiteboard (${existingMatch.canonicalId || existingMatch.doi || existingMatch.pmid || existingMatch.arxivId || existingMatch.openAlexId || existingMatch.title}). Selected the existing node instead of adding a duplicate.`,
      });
      return;
    }

    const requestSequence = ++relationshipScanSequence.current;
    const existingNodes = boardSnapshot.paperNodes.filter((paper) => paper.id !== normalizedNode.id);
    const existingEdges = boardSnapshot.paperEdges;

    setDashboards((prev) => {
      const board = prev[boardId];
      if (!board || board.paperNodes.some((paper) => paper.id === normalizedNode.id)) return prev;
      let nextGraph = graph.addNode({ nodes: board.paperNodes, edges: board.paperEdges }, normalizedNode);
      for (const edge of initialEdges) nextGraph = graph.addEdge(nextGraph, edge);
      return {
        ...prev,
        [boardId]: {
          ...board,
          paperNodes: nextGraph.nodes,
          paperEdges: nextGraph.edges,
          updatedAt: new Date().toISOString(),
        },
      };
    });

    setSelectedNodeId(normalizedNode.id);

    if (existingNodes.length === 0) {
      setRelationshipScanFeedback({
        dashboardId: boardId,
        status: 'complete',
        checkedCount: 0,
        connectionCount: 0,
        message: 'Paper added. Add another paper to discover relationships on this whiteboard.',
      });
      return;
    }

    setRelationshipScanFeedback({
      dashboardId: boardId,
      status: 'checking',
      checkedCount: existingNodes.length,
      message: `Paper added. Checking its relationship with ${existingNodes.length} existing paper(s)…`,
    });

    findWhiteboardRelationships(normalizedNode, existingNodes, existingEdges)
      .then((result) => {
        const mappedEdges: ResearchPaperEdge[] = result.edges.map((edge) => {
          const presentation = AUTO_RELATION_PRESENTATION[edge.type] || {
            relationType: 'custom' as RelationType,
            label: edge.type.replace(/[_-]+/g, ' '),
          };
          return {
            id: `auto-${edge.id}`,
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
            relationType: presentation.relationType,
            label: presentation.label,
            description: edge.explanation,
            graphKind: 'identified',
            backendRelationType: edge.type,
            backendEdgeKind: edge.kind || 'inferred_research',
            score: edge.score,
            confidenceLabel: edge.confidence_label,
            requiresHumanReview: edge.requires_human_review !== false,
            sharedTerms: edge.shared_terms || [],
            evidence: edge.evidence,
          };
        });

        setDashboards((prev) => {
          const board = prev[boardId];
          if (!board) return prev;
          const existingKeys = new Set(
            board.paperEdges
              .filter((edge) => edge.backendRelationType)
              .map((edge) => autoRelationshipKey(edge)),
          );
          const additions = mappedEdges.filter((edge) => {
            const exists = existingKeys.has(autoRelationshipKey(edge));
            if (!exists) existingKeys.add(autoRelationshipKey(edge));
            return !exists &&
              board.paperNodes.some((node) => node.id === edge.sourceNodeId) &&
              board.paperNodes.some((node) => node.id === edge.targetNodeId);
          });
          return {
            ...prev,
            [boardId]: {
              ...board,
              paperEdges: [...board.paperEdges, ...additions],
              researchGraphView: additions.length > 0 && board.researchProjectId
                ? 'relationships'
                : board.researchGraphView,
              updatedAt: new Date().toISOString(),
            },
          };
        });

        if (requestSequence === relationshipScanSequence.current) {
          setRelationshipScanFeedback({
            dashboardId: boardId,
            status: 'complete',
            checkedCount: result.checked_count,
            connectionCount: result.connection_count,
            connectedPaperCount: result.connected_paper_count,
            message: result.message,
          });
        }
      })
      .catch((error) => {
        if (requestSequence !== relationshipScanSequence.current) return;
        const detail = error instanceof Error ? error.message : String(error);
        setRelationshipScanFeedback({
          dashboardId: boardId,
          status: 'error',
          checkedCount: existingNodes.length,
          connectionCount: 0,
          message: `Paper was added, but its relationship scan failed: ${detail}`,
        });
      });
  };

  /* ------------------------------- adding papers ------------------------------- */

  const viewportCenter = (): Point => canvasRef.current?.getViewportCenter() ?? { x: 300, y: 250 };

  const handleAddPaperNode = (paperData: Omit<ResearchPaperNode, 'id' | 'x' | 'y'>) => {
    const c = viewportCenter();
    const draft = { ...paperData, id: `paper-${Date.now()}`, x: 0, y: 0 } as ResearchPaperNode;
    const L = layoutCard(draft);
    const spot = findFreeSpot(currentDashboard.paperNodes, Math.round(c.x - L.width / 2), Math.round(c.y - L.height / 2), L.width, L.height);
    const newNode = { ...draft, x: spot.x, y: spot.y };

    addNodeAndScanRelationships(newNode);
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

    addNodeAndScanRelationships(newNode);
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
    addNodeAndScanRelationships(newNode, [{
      sourceNodeId: source.id,
      targetNodeId: newNode.id,
      relationType: 'extends',
      label: RELATION_LABELS.extends,
    }]);
  };

  /**
   * Turn a "linked paper" (from the right sidebar) into a card + an arrow to the paper it relates to.
   * (x, y) is the top-left corner of the new card.
   */
  const addLinkedPaper = (paper: any, x: number, y: number) => {
    const nodes = currentDashboard.paperNodes;
    const existing = nodes.find(
      (n) => n.id === paper.id || isSameScholarlyPaper(n, paper) || n.title.trim().toLowerCase() === String(paper.title || '').trim().toLowerCase()
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
      keyInsights: paper.keyInsights || paper.key_findings || (paper.relationDescription ? [paper.relationDescription] : []),
      conclusion: paper.conclusion || paper.analysis?.conclusion,
      keyFindings: paper.keyFindings || paper.key_findings || paper.analysis?.key_findings,
      researchProblem: paper.researchProblem || paper.research_problem || paper.analysis?.research_problem,
      researchObjective: paper.researchObjective || paper.research_objective || paper.analysis?.research_objective,
      researchQuestions: paper.researchQuestions || paper.research_questions || paper.analysis?.research_questions,
      researchGaps: paper.researchGaps || paper.research_gaps || paper.analysis?.research_gaps,
      limitations: paper.limitations || paper.analysis?.limitations,
      futureWork: paper.futureWork || paper.future_work || paper.analysis?.future_work,
      methodology: paper.methodology || paper.analysis?.methodology,
      datasets: paper.datasets || paper.analysis?.datasets,
      methodConcepts: paper.methodConcepts || paper.method_concepts || paper.analysis?.method_concepts,
      evaluationMetrics: paper.evaluationMetrics || paper.evaluation_metrics || paper.analysis?.evaluation_metrics,
      contributions: paper.contributions || paper.analysis?.contributions,
      researchProfile: paper.researchProfile || paper.research_profile || paper.analysis?.research_profile,
      researchProfileCompleteness: paper.researchProfileCompleteness || paper.research_profile_completeness,
      tags: paper.tags || ['Research'],
      arxivId: paper.arxivId || paper.arxiv_id,
      canonicalId: paper.canonicalId || paper.canonical_id,
      doi: paper.doi,
      pmid: paper.pmid || paper.identifiers?.pmid,
      openAlexId: paper.openAlexId || paper.openalex_id || paper.identifiers?.openalex,
      identifiers: paper.identifiers,
      identifierType: paper.identifierType || paper.identifier_type,
      identifierValue: paper.identifierValue || paper.identifier_value,
      url: paper.url || paper.landing_page_url || paper.pdf_url,
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
    const initialEdges: EdgeMetadata[] = parent ? [{
      sourceNodeId: parent.id,
      targetNodeId: newNode.id,
      relationType: rel,
      label: RELATION_LABELS[rel] || 'Related',
    }] : [];
    addNodeAndScanRelationships(newNode, initialEdges);
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
    addNodeAndScanRelationships(node);
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
          onCreateDashboard={() => { setResearchCreateError(null); setIsResearchModalOpen(true); }}
        />

        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={switchTab}
          onCloseTab={handleCloseTab}
          onNewTab={() => handleCreateFile(null)}
        />

        <div className="flex-1 flex overflow-hidden relative">
          <main className="flex-1 relative overflow-hidden bg-slate-50 flex flex-col" id="whiteboard-viewport-container">
            {currentDashboard.researchProjectId && (
              <div className="h-12 shrink-0 flex items-center gap-2 border-b border-slate-200 bg-white px-3 sm:px-4">
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => patchBoard(() => ({ researchGraphView: 'citations' }))}
                    aria-pressed={activeResearchGraphView === 'citations'}
                    className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-semibold transition-colors ${
                      activeResearchGraphView === 'citations'
                        ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-slate-500" />
                    Citation network
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-600">
                      {citationGraphEdges.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => patchBoard(() => ({ researchGraphView: 'relationships' }))}
                    aria-pressed={activeResearchGraphView === 'relationships'}
                    className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-semibold transition-colors ${
                      activeResearchGraphView === 'relationships'
                        ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-indigo-500" />
                    Identified relationships
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-600">
                      {identifiedRelationshipEdges.length}
                    </span>
                  </button>
                </div>
                <span className="ml-auto hidden text-[10px] text-slate-400 sm:block">
                  {activeResearchGraphView === 'citations'
                    ? 'OpenAlex citations and related-work links'
                    : 'Content-inferred relationship types'}
                </span>
              </div>
            )}

            <div className="relative min-h-0 flex-1">
              {/* Each graph view uses the same resolved paper nodes but a disjoint edge set. */}
              <WhiteboardCanvas
                key={`${activeTabId}:${currentDashboard.revision ?? 0}`}
                ref={canvasRef}
                paperNodes={currentDashboard.paperNodes}
                paperEdges={visibleGraphEdges}
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

              {currentDashboard.researchProjectId && visibleGraphEdges.length === 0 && (
                <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-center text-xs text-slate-500 shadow-sm">
                  {activeResearchGraphView === 'citations'
                    ? 'No citation or related-work edges were returned for this project.'
                    : 'No content-inferred relationships were identified for this project.'}
                </div>
              )}

              {/* Step prompts for the add-edge flow */}
              <EdgeFlowOverlay
                flow={edgeFlow}
                nodes={currentDashboard.paperNodes}
                edges={visibleGraphEdges}
                onBack={() => dispatchEdgeFlow({ type: 'back' })}
                onCancel={() => dispatchEdgeFlow({ type: 'cancel' })}
                onChooseRelation={handleChooseRelation}
              />
            </div>
          </main>

          {/* Merged sidebar: linked-paper discovery (drag & drop) + node / edge management */}
          <GraphSidebar
            isOpen={isGraphSidebarOpen}
            onClose={() => setIsGraphSidebarOpen(false)}
            nodes={currentDashboard.paperNodes}
            edges={visibleGraphEdges}
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
          edges={visibleGraphEdges}
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

      {relationshipScanFeedback?.dashboardId === activeTabId && (
        <div className="fixed bottom-5 right-5 z-[80] w-[min(92vw,390px)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="flex items-start gap-2">
            <div className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
              relationshipScanFeedback.status === 'checking' ? 'animate-pulse bg-indigo-500' :
              relationshipScanFeedback.status === 'error' ? 'bg-rose-500' : 'bg-emerald-500'
            }`} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-900">
                {relationshipScanFeedback.status === 'checking'
                  ? 'Checking paper relationships'
                  : relationshipScanFeedback.status === 'error'
                    ? 'Relationship check needs attention'
                    : 'Relationship check complete'}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {relationshipScanFeedback.message}
              </p>
              {relationshipScanFeedback.status === 'complete' && relationshipScanFeedback.connectionCount !== undefined && (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-2 text-[10px] font-medium text-slate-700">
                    <span className="rounded bg-emerald-50 px-2 py-1">{relationshipScanFeedback.connectionCount} new connection(s)</span>
                    {relationshipScanFeedback.checkedCount !== undefined && (
                      <span className="rounded bg-slate-100 px-2 py-1">{relationshipScanFeedback.checkedCount} paper(s) checked</span>
                    )}
                    {relationshipScanFeedback.result?.duplicate_edge_count ? (
                      <span className="rounded bg-amber-50 px-2 py-1">{relationshipScanFeedback.result.duplicate_edge_count} duplicate(s) skipped</span>
                    ) : null}
                  </div>

                  {relationshipScanFeedback.result?.relationship_type_counts && Object.keys(relationshipScanFeedback.result.relationship_type_counts).length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Connections by type</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(relationshipScanFeedback.result.relationship_type_counts).map(([type, count]) => (
                          <span key={type} className="rounded bg-white px-2 py-1 text-[10px] text-slate-700 border border-slate-200">
                            {type.replace(/[_-]+/g, ' ')}: <strong>{count}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {relationshipScanFeedback.result?.category_diagnostics && (
                    <div className="rounded-lg border border-slate-200 bg-white p-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Comparison coverage by category</div>
                      <div className="space-y-1.5">
                        {Object.entries(relationshipScanFeedback.result.category_diagnostics).map(([type, diagnostic]) => (
                          <div key={type} className="flex items-center justify-between gap-2 text-[10px]">
                            <span className="min-w-0 text-slate-600">{RELATIONSHIP_DIAGNOSTIC_LABELS[type] || type.replace(/[_-]+/g, ' ')}</span>
                            <span className="shrink-0 text-right tabular-nums text-slate-700">
                              <span className="block">{diagnostic.eligible}/{diagnostic.compared} eligible · {diagnostic.passed} passed</span>
                              <span className="block text-[9px] text-slate-400">{diagnostic.below_threshold} below threshold · {diagnostic.ineligible} missing data</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {relationshipScanFeedback.result?.new_paper_profile_coverage && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-semibold uppercase tracking-wide text-slate-500">New paper information coverage</span>
                        <strong className="text-slate-800">{relationshipScanFeedback.result.new_paper_profile_coverage.percent ?? 0}%</strong>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, relationshipScanFeedback.result.new_paper_profile_coverage.percent ?? 0))}%` }} />
                      </div>
                      {relationshipScanFeedback.result.coverage_summary?.new_paper_missing_dimensions?.length ? (
                        <p className="mt-1 text-[10px] text-amber-700">Missing: {relationshipScanFeedback.result.coverage_summary.new_paper_missing_dimensions.join(', ').replace(/_/g, ' ')}.</p>
                      ) : (
                        <p className="mt-1 text-[10px] text-emerald-700">All primary comparison dimensions have some information.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setRelationshipScanFeedback(null)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Dismiss relationship feedback"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* 4. Add research paper modal */}
      <AddPaperModal
        isOpen={isAddPaperModalOpen}
        onClose={() => setIsAddPaperModalOpen(false)}
        onAddPaper={handleAddPaperNode}
      />

      {/* 5. Create a dashboard by starting a backend research project */}
      <CreateResearchModal
        isOpen={isResearchModalOpen}
        isSubmitting={isResearchCreating}
        error={researchCreateError}
        onClose={() => setIsResearchModalOpen(false)}
        onCreate={handleCreateResearchDashboard}
      />

      {/* 6. Shortcuts modal */}
      <ShortcutsModal isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />
    </div>
  );
}
