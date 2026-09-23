import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  INITIAL_FILES,
  INITIAL_DASHBOARDS,
} from './data/initialData';
import {
  FileItem,
  TabItem,
  DashboardData,
  ToolType,
  FillStyle,
  ResearchPaperNode,
  ResearchPaperEdge,
  WhiteboardElement,
  RelationType,
  ViewTransform,
  Point,
} from './types';
import { Sidebar, PRESET_RESEARCH_PAPERS } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { TopNav } from './components/TopNav';
import { Toolbar } from './components/Toolbar';
import { WhiteboardCanvas } from './components/WhiteboardCanvas';
import { PaperInspector } from './components/PaperInspector';
import { LinkedPapersSidebar } from './components/LinkedPapersSidebar';
import { AddPaperModal } from './components/AddPaperModal';
import { EdgeEditorModal } from './components/EdgeEditorModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { autoLayoutResearchGraph } from './utils/graphLayout';
import {
  getAllLinkedPapersForDashboard,
  LinkedPaperItem,
} from './data/linkedPapersData';

export default function App() {
  // File System State
  const [files, setFiles] = useState<FileItem[]>(INITIAL_FILES);
  const [dashboards, setDashboards] = useState<Record<string, DashboardData>>(INITIAL_DASHBOARDS);

  // Tabs State (browser-style tabs)
  const [tabs, setTabs] = useState<TabItem[]>([
    { id: 'dash-1', fileId: 'file-1', title: 'Transformer Lineage.excali' },
    { id: 'dash-2', fileId: 'file-2', title: 'Diffusion & Generative.excali' },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('dash-1');

  // UI Panels State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isLinkedPapersOpen, setIsLinkedPapersOpen] = useState(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isAddPaperModalOpen, setIsAddPaperModalOpen] = useState(false);
  const [isEdgeEditorModalOpen, setIsEdgeEditorModalOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  // Selection State
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Whiteboard Tool & Styling State
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [strokeColor, setStrokeColor] = useState<string>('#1e293b');
  const [backgroundColor, setBackgroundColor] = useState<string>('transparent');
  const [strokeWidth, setStrokeWidth] = useState<number>(2);
  const [roughness, setRoughness] = useState<number>(1.2);
  const [fillStyle, setFillStyle] = useState<FillStyle>('hachure');

  // History Undo/Redo Stacks per dashboard
  const [history, setHistory] = useState<Record<string, { past: DashboardData[]; future: DashboardData[] }>>({});

  // Active Dashboard Data
  const currentDashboard = useMemo(() => {
    return dashboards[activeTabId] || {
      id: activeTabId,
      title: 'Untitled Whiteboard.excali',
      elements: [],
      paperNodes: [],
      paperEdges: [],
      viewTransform: { x: 100, y: 100, zoom: 1.0 },
      gridType: 'dots',
      updatedAt: new Date().toISOString(),
    };
  }, [dashboards, activeTabId]);

  // Record history snapshot for active dashboard
  const recordHistory = useCallback(() => {
    setHistory((prev) => {
      const currentStack = prev[activeTabId] || { past: [], future: [] };
      return {
        ...prev,
        [activeTabId]: {
          past: [...currentStack.past.slice(-30), currentDashboard],
          future: [],
        },
      };
    });
  }, [activeTabId, currentDashboard]);

  // Undo Handler
  const handleUndo = useCallback(() => {
    const currentStack = history[activeTabId];
    if (!currentStack || currentStack.past.length === 0) return;

    const previous = currentStack.past[currentStack.past.length - 1];
    const newPast = currentStack.past.slice(0, -1);

    setHistory((prev) => ({
      ...prev,
      [activeTabId]: {
        past: newPast,
        future: [currentDashboard, ...(prev[activeTabId]?.future || [])],
      },
    }));

    setDashboards((prev) => ({
      ...prev,
      [activeTabId]: previous,
    }));
  }, [activeTabId, currentDashboard, history]);

  // Redo Handler
  const handleRedo = useCallback(() => {
    const currentStack = history[activeTabId];
    if (!currentStack || currentStack.future.length === 0) return;

    const next = currentStack.future[0];
    const newFuture = currentStack.future.slice(1);

    setHistory((prev) => ({
      ...prev,
      [activeTabId]: {
        past: [...(prev[activeTabId]?.past || []), currentDashboard],
        future: newFuture,
      },
    }));

    setDashboards((prev) => ({
      ...prev,
      [activeTabId]: next,
    }));
  }, [activeTabId, currentDashboard, history]);

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (e.target as HTMLElement).tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') {
        return;
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Delete selected node or edge
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) {
          handleDeleteNode(selectedNodeId);
        } else if (selectedEdgeId) {
          handleDeleteEdge(selectedEdgeId);
        }
        return;
      }

      // Tool selection shortcuts
      switch (e.key.toLowerCase()) {
        case 'v':
          setActiveTool('select');
          break;
        case 'h':
          setActiveTool('hand');
          break;
        case 'r':
          setActiveTool('rectangle');
          break;
        case 'd':
          setActiveTool('diamond');
          break;
        case 'o':
          setActiveTool('ellipse');
          break;
        case 'a':
          setActiveTool('arrow');
          break;
        case 'l':
          setActiveTool('line');
          break;
        case 'p':
          setActiveTool('draw');
          break;
        case 't':
          setActiveTool('text');
          break;
        case 'e':
          setActiveTool('eraser');
          break;
        case 'n':
          setIsAddPaperModalOpen(true);
          break;
        case '?':
          setIsShortcutsOpen(true);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, selectedEdgeId, handleUndo, handleRedo]);

  // Open file from Sidebar: if already in tabs, switch to that tab; otherwise open as a new tab!
  const handleOpenFile = (file: FileItem) => {
    if (!file.dashboardId) return;

    const existingTab = tabs.find((t) => t.id === file.dashboardId);
    if (existingTab) {
      setActiveTabId(existingTab.id);
    } else {
      const newTab: TabItem = {
        id: file.dashboardId,
        fileId: file.id,
        title: file.name,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    }
  };

  // Close Tab
  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      // If closing the last tab, create an empty scratchpad
      handleCreateFile(null, 'Scratchpad.excali');
      return;
    }

    const tabIndex = tabs.findIndex((t) => t.id === tabId);
    const updatedTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(updatedTabs);

    if (activeTabId === tabId) {
      const nextIndex = Math.max(0, tabIndex - 1);
      setActiveTabId(updatedTabs[nextIndex].id);
    }
  };

  // Create new Whiteboard File
  const handleCreateFile = (parentId: string | null = null, name?: string) => {
    const newDashId = `dash-${Date.now()}`;
    const newFileId = `file-${Date.now()}`;
    const fileName = name || `Research-Board-${Object.keys(dashboards).length + 1}.excali`;

    const newFile: FileItem = {
      id: newFileId,
      name: fileName,
      isFolder: false,
      parentId,
      dashboardId: newDashId,
      colorTag: '#6366f1',
    };

    const newDashboard: DashboardData = {
      id: newDashId,
      title: fileName,
      updatedAt: new Date().toISOString(),
      gridType: 'dots',
      viewTransform: { x: 120, y: 120, zoom: 1.0 },
      elements: [],
      paperNodes: [],
      paperEdges: [],
    };

    setFiles((prev) => [...prev, newFile]);
    setDashboards((prev) => ({ ...prev, [newDashId]: newDashboard }));

    // Open as tab immediately
    setTabs((prev) => [...prev, { id: newDashId, fileId: newFileId, title: fileName }]);
    setActiveTabId(newDashId);
  };

  // Create new folder
  const handleCreateFolder = (parentId: string | null = null, name?: string) => {
    const newFolder: FileItem = {
      id: `folder-${Date.now()}`,
      name: name || 'New Research Topic',
      isFolder: true,
      parentId,
    };
    setFiles((prev) => [...prev, newFolder]);
  };

  // Delete file or folder
  const handleDeleteFile = (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;

    if (file.dashboardId) {
      const dashId = file.dashboardId;
      setTabs((prev) => prev.filter((t) => t.id !== dashId));
      if (activeTabId === dashId) {
        const remaining = tabs.filter((t) => t.id !== dashId);
        if (remaining.length > 0) {
          setActiveTabId(remaining[0].id);
        }
      }
    }

    setFiles((prev) => prev.filter((f) => f.id !== fileId && f.parentId !== fileId));
  };

  // Rename File / Dashboard
  const handleRenameFile = (fileId: string, newName: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, name: newName } : f))
    );

    const file = files.find((f) => f.id === fileId);
    if (file && file.dashboardId) {
      const dashId = file.dashboardId;
      setTabs((prev) =>
        prev.map((t) => (t.id === dashId ? { ...t, title: newName } : t))
      );
      setDashboards((prev) => ({
        ...prev,
        [dashId]: { ...prev[dashId], title: newName },
      }));
    }
  };

  // Rename current board from top navigation
  const handleRenameCurrentTitle = (newTitle: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, title: newTitle } : t))
    );
    setDashboards((prev) => ({
      ...prev,
      [activeTabId]: { ...prev[activeTabId], title: newTitle },
    }));

    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) {
      setFiles((prev) =>
        prev.map((f) => (f.id === activeTab.fileId ? { ...f, name: newTitle } : f))
      );
    }
  };

  // Update elements on active dashboard
  const handleUpdateElements = (newElements: WhiteboardElement[]) => {
    setDashboards((prev) => ({
      ...prev,
      [activeTabId]: {
        ...currentDashboard,
        elements: newElements,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  // Update paper nodes
  const handleUpdateNodes = (newNodes: ResearchPaperNode[]) => {
    setDashboards((prev) => ({
      ...prev,
      [activeTabId]: {
        ...currentDashboard,
        paperNodes: newNodes,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  // Update paper edges
  const handleUpdateEdges = (newEdges: ResearchPaperEdge[]) => {
    setDashboards((prev) => ({
      ...prev,
      [activeTabId]: {
        ...currentDashboard,
        paperEdges: newEdges,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  // Update view transform (pan, zoom)
  const handleChangeViewTransform = (transform: ViewTransform) => {
    setDashboards((prev) => ({
      ...prev,
      [activeTabId]: {
        ...currentDashboard,
        viewTransform: transform,
      },
    }));
  };

  // Toggle Grid
  const handleToggleGrid = () => {
    const nextGrid: 'dots' | 'grid' | 'none' =
      currentDashboard.gridType === 'dots'
        ? 'grid'
        : currentDashboard.gridType === 'grid'
        ? 'none'
        : 'dots';

    setDashboards((prev) => ({
      ...prev,
      [activeTabId]: {
        ...currentDashboard,
        gridType: nextGrid,
      },
    }));
  };

  // Zoom controls
  const handleZoomIn = () => {
    const newZoom = Math.min(currentDashboard.viewTransform.zoom * 1.15, 3.0);
    handleChangeViewTransform({ ...currentDashboard.viewTransform, zoom: newZoom });
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(currentDashboard.viewTransform.zoom / 1.15, 0.25);
    handleChangeViewTransform({ ...currentDashboard.viewTransform, zoom: newZoom });
  };

  const handleResetZoom = () => {
    handleChangeViewTransform({ ...currentDashboard.viewTransform, zoom: 1.0 });
  };

  // Add Paper Node
  const handleAddPaperNode = (
    paperData: Omit<ResearchPaperNode, 'id' | 'x' | 'y'>
  ) => {
    recordHistory();
    // Center in current view
    const view = currentDashboard.viewTransform;
    const centerX = (-view.x + window.innerWidth / 2) / view.zoom - 160;
    const centerY = (-view.y + window.innerHeight / 2) / view.zoom - 100;

    const newNode: ResearchPaperNode = {
      ...paperData,
      id: `paper-${Date.now()}`,
      x: Math.round(centerX),
      y: Math.round(centerY),
    };

    const updatedNodes = [...currentDashboard.paperNodes, newNode];
    handleUpdateNodes(updatedNodes);
    setSelectedNodeId(newNode.id);
    setIsInspectorOpen(true);
  };

  // Quick add from preset library
  const handleQuickAddPresetPaper = (presetKey: string) => {
    const preset = PRESET_RESEARCH_PAPERS.find((p) => p.key === presetKey);
    if (!preset) return;

    recordHistory();
    const view = currentDashboard.viewTransform;
    const centerX = (-view.x + window.innerWidth / 2) / view.zoom - 160;
    const centerY = (-view.y + window.innerHeight / 2) / view.zoom - 100;

    const newNode: ResearchPaperNode = {
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
      x: Math.round(centerX + (Math.random() * 60 - 30)),
      y: Math.round(centerY + (Math.random() * 60 - 30)),
      width: 320,
      height: 195,
    };

    handleUpdateNodes([...currentDashboard.paperNodes, newNode]);
    setSelectedNodeId(newNode.id);
  };

  // Add Connected Paper action from Inspector
  const handleAddConnectedPaper = (sourceNodeId: string) => {
    const sourceNode = currentDashboard.paperNodes.find((n) => n.id === sourceNodeId);
    if (!sourceNode) return;

    recordHistory();
    const newNode: ResearchPaperNode = {
      id: `paper-related-${Date.now()}`,
      title: `Continuation of ${sourceNode.title.split(':')[0]}`,
      authors: 'Research Collaborators',
      year: typeof sourceNode.year === 'number' ? sourceNode.year + 1 : 2024,
      venue: 'NeurIPS',
      abstract: `Direct followup and experimental validation building on ${sourceNode.title}.`,
      keyInsights: ['Improved computational efficiency', 'Extended empirical evaluation'],
      tags: [...sourceNode.tags.slice(0, 2), 'Followup'],
      status: 'to-read',
      color: sourceNode.color,
      x: sourceNode.x + 380,
      y: sourceNode.y + 40,
      width: 320,
      height: 195,
    };

    const newEdge: ResearchPaperEdge = {
      id: `edge-${Date.now()}`,
      sourceNodeId: sourceNode.id,
      targetNodeId: newNode.id,
      relationType: 'extends',
      label: 'Builds Upon',
      style: 'solid',
      color: sourceNode.color,
    };

    handleUpdateNodes([...currentDashboard.paperNodes, newNode]);
    handleUpdateEdges([...currentDashboard.paperEdges, newEdge]);
    setSelectedNodeId(newNode.id);
  };

  // Delete Node & connected edges
  const handleDeleteNode = (nodeId: string) => {
    recordHistory();
    const updatedNodes = currentDashboard.paperNodes.filter((n) => n.id !== nodeId);
    const updatedEdges = currentDashboard.paperEdges.filter(
      (e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId
    );
    handleUpdateNodes(updatedNodes);
    handleUpdateEdges(updatedEdges);
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
      setIsInspectorOpen(false);
    }
  };

  // Create Edge
  const handleCreateEdge = (
    sourceId: string,
    targetId: string,
    relationType: RelationType
  ) => {
    recordHistory();
    const newEdge: ResearchPaperEdge = {
      id: `edge-${Date.now()}`,
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      relationType,
      label: relationType.replace('-', ' '),
      style: relationType === 'improves' ? 'dashed' : 'solid',
      color: '#4f46e5',
    };
    handleUpdateEdges([...currentDashboard.paperEdges, newEdge]);
  };

  // Delete Edge
  const handleDeleteEdge = (edgeId: string) => {
    recordHistory();
    const updatedEdges = currentDashboard.paperEdges.filter((e) => e.id !== edgeId);
    handleUpdateEdges(updatedEdges);
    if (selectedEdgeId === edgeId) {
      setSelectedEdgeId(null);
      setIsEdgeEditorModalOpen(false);
    }
  };

  // Auto layout research graph chronologically
  const handleAutoLayout = () => {
    recordHistory();
    const laidOutNodes = autoLayoutResearchGraph(
      currentDashboard.paperNodes,
      currentDashboard.paperEdges
    );
    handleUpdateNodes(laidOutNodes);
  };

  // Export current canvas as PNG
  const handleExportPNG = () => {
    const canvas = document.querySelector('#whiteboard-viewport-container canvas') as HTMLCanvasElement;
    if (!canvas) return;

    // Create a download link
    const link = document.createElement('a');
    link.download = `${currentDashboard.title.replace(/\.[^/.]+$/, '')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // Export JSON
  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(currentDashboard, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${currentDashboard.title}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Import JSON
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
            recordHistory();
            setDashboards((prev) => ({
              ...prev,
              [activeTabId]: {
                ...imported,
                id: activeTabId,
                title: imported.title || currentDashboard.title,
              },
            }));
          }
        } catch (err) {
          alert('Invalid JSON file format');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // Count of total linked papers available for current dashboard
  const dashboardLinkedPapersCount = useMemo(() => {
    return getAllLinkedPapersForDashboard(currentDashboard.paperNodes).length;
  }, [currentDashboard.paperNodes]);

  // Locate a node on canvas and center the viewport on it
  const handleLocateNode = (nodeId: string) => {
    const node = currentDashboard.paperNodes.find((n) => n.id === nodeId);
    if (!node) return;
    setSelectedNodeId(nodeId);

    const container = document.getElementById('whiteboard-viewport-container');
    const width = container ? container.clientWidth : 800;
    const height = container ? container.clientHeight : 600;
    const zoom = currentDashboard.viewTransform.zoom;

    const targetX = width / 2 - (node.x + 105) * zoom;
    const targetY = height / 2 - (node.y + 19) * zoom;

    handleChangeViewTransform({
      x: targetX,
      y: targetY,
      zoom,
    });
  };

  // Drop linked paper onto canvas as a new node
  const handleDropLinkedPaper = (paper: any, worldPos: Point) => {
    recordHistory();
    // Check if paper is already in this dashboard
    const existing = currentDashboard.paperNodes.find(
      (n) => n.id === paper.id || n.title.toLowerCase() === paper.title.toLowerCase()
    );
    if (existing) {
      handleLocateNode(existing.id);
      return;
    }

    const newNodeId = paper.id || `node-${Date.now()}`;
    const newNode: ResearchPaperNode = {
      id: newNodeId,
      title: paper.title,
      authors: paper.authors || 'Unknown Authors',
      year: paper.year || new Date().getFullYear(),
      venue: paper.venue || 'ArXiv',
      abstract: paper.abstract || paper.relationDescription || '',
      keyInsights: paper.keyInsights || [paper.relationDescription],
      tags: paper.tags || ['Research'],
      arxivId: paper.arxivId,
      status: paper.status || 'to-read',
      color: paper.color || '#4f46e5',
      x: worldPos.x - 105,
      y: worldPos.y - 19,
      width: 210,
      height: 38,
    };

    const newEdges = [...currentDashboard.paperEdges];

    // If this paper is linked to an existing node on the canvas, auto-create edge
    if (paper.linkedToPaperId) {
      const parentNode = currentDashboard.paperNodes.find((n) => n.id === paper.linkedToPaperId);
      if (parentNode) {
        newEdges.push({
          id: `edge-${Date.now()}`,
          sourceNodeId: parentNode.id,
          targetNodeId: newNode.id,
          relationType: paper.relationType || 'cites',
          label: paper.relationType ? paper.relationType.replace('-', ' ') : 'cites',
          style: 'solid',
          color: parentNode.color,
        });
      }
    } else if (selectedNodeId) {
      const parentNode = currentDashboard.paperNodes.find((n) => n.id === selectedNodeId);
      if (parentNode) {
        newEdges.push({
          id: `edge-${Date.now()}`,
          sourceNodeId: parentNode.id,
          targetNodeId: newNode.id,
          relationType: 'extends',
          label: 'Builds Upon',
          style: 'solid',
          color: parentNode.color,
        });
      }
    }

    handleUpdateNodes([...currentDashboard.paperNodes, newNode]);
    handleUpdateEdges(newEdges);
    setSelectedNodeId(newNode.id);
  };

  // Add linked paper via button click
  const handleAddLinkedPaperAsNode = (paper: any) => {
    let spawnX = 300;
    let spawnY = 250;
    const parentNode =
      currentDashboard.paperNodes.find((n) => n.id === paper.linkedToPaperId) ||
      (selectedNodeId ? currentDashboard.paperNodes.find((n) => n.id === selectedNodeId) : null);

    if (parentNode) {
      spawnX = parentNode.x + 280;
      spawnY = parentNode.y + (Math.random() * 80 - 40);
    } else if (currentDashboard.paperNodes.length > 0) {
      const last = currentDashboard.paperNodes[currentDashboard.paperNodes.length - 1];
      spawnX = last.x + 260;
      spawnY = last.y + 40;
    }

    handleDropLinkedPaper(paper, { x: spawnX, y: spawnY });
  };

  const selectedNode = currentDashboard.paperNodes.find((n) => n.id === selectedNodeId) || null;
  const selectedEdge = currentDashboard.paperEdges.find((e) => e.id === selectedEdgeId) || null;
  const edgeSourceNode = selectedEdge ? currentDashboard.paperNodes.find((n) => n.id === selectedEdge.sourceNodeId) : undefined;
  const edgeTargetNode = selectedEdge ? currentDashboard.paperNodes.find((n) => n.id === selectedEdge.targetNodeId) : undefined;

  const currentHistoryStack = history[activeTabId] || { past: [], future: [] };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-slate-900 font-sans antialiased">
      {/* 1. Sidebar with File System Tree and Preset Paper Hub */}
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

      {/* 2. Main Work Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        {/* Top Navigation */}
        <TopNav
          title={currentDashboard.title}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isLinkedPapersOpen={isLinkedPapersOpen}
          onToggleLinkedPapers={() => setIsLinkedPapersOpen(!isLinkedPapersOpen)}
          linkedPapersCount={dashboardLinkedPapersCount}
          onRenameTitle={handleRenameCurrentTitle}
          onExportPNG={handleExportPNG}
          onExportJSON={handleExportJSON}
          onImportJSON={handleImportJSON}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
        />

        {/* Tab Bar for Open Whiteboards */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={(tabId) => {
            setActiveTabId(tabId);
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
          }}
          onCloseTab={handleCloseTab}
          onNewTab={() => handleCreateFile(null)}
        />

        {/* Canvas & Linked Papers Flex Area */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Canvas Area with Floating Excalidraw Toolbar */}
          <main className="flex-1 relative overflow-hidden bg-slate-50">
            {/* Excalidraw Toolbar */}
            <Toolbar
              activeTool={activeTool}
              onSelectTool={setActiveTool}
              strokeColor={strokeColor}
              onChangeStrokeColor={setStrokeColor}
              backgroundColor={backgroundColor}
              onChangeBackgroundColor={setBackgroundColor}
              strokeWidth={strokeWidth}
              onChangeStrokeWidth={setStrokeWidth}
              roughness={roughness}
              onChangeRoughness={setRoughness}
              fillStyle={fillStyle}
              onChangeFillStyle={setFillStyle}
              zoom={currentDashboard.viewTransform.zoom}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onResetZoom={handleResetZoom}
              canUndo={currentHistoryStack.past.length > 0}
              canRedo={currentHistoryStack.future.length > 0}
              onUndo={handleUndo}
              onRedo={handleRedo}
              gridType={currentDashboard.gridType}
              onToggleGrid={handleToggleGrid}
              onAutoLayout={handleAutoLayout}
              onOpenAddPaperModal={() => setIsAddPaperModalOpen(true)}
              paperCount={currentDashboard.paperNodes.length}
              edgeCount={currentDashboard.paperEdges.length}
              isLinkedPapersOpen={isLinkedPapersOpen}
              onToggleLinkedPapers={() => setIsLinkedPapersOpen(!isLinkedPapersOpen)}
            />

            {/* Core Whiteboard Canvas */}
            <WhiteboardCanvas
              elements={currentDashboard.elements}
              paperNodes={currentDashboard.paperNodes}
              paperEdges={currentDashboard.paperEdges}
              activeTool={activeTool}
              strokeColor={strokeColor}
              backgroundColor={backgroundColor}
              strokeWidth={strokeWidth}
              roughness={roughness}
              fillStyle={fillStyle}
              viewTransform={currentDashboard.viewTransform}
              gridType={currentDashboard.gridType}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={selectedEdgeId}
              onUpdateElements={handleUpdateElements}
              onUpdateNodes={handleUpdateNodes}
              onUpdateEdges={handleUpdateEdges}
              onSelectNode={(nodeId) => {
                setSelectedNodeId(nodeId);
                if (nodeId) setIsInspectorOpen(true);
              }}
              onSelectEdge={(edgeId) => {
                setSelectedEdgeId(edgeId);
                if (edgeId) setIsEdgeEditorModalOpen(true);
              }}
              onOpenInspector={(nodeId) => {
                setSelectedNodeId(nodeId);
                setIsInspectorOpen(true);
              }}
              onChangeViewTransform={handleChangeViewTransform}
              onRecordHistory={recordHistory}
              onDropPaperNode={handleDropLinkedPaper}
            />
          </main>

          {/* Dedicated Linked Papers Sidebar for current dashboard */}
          <LinkedPapersSidebar
            isOpen={isLinkedPapersOpen}
            onClose={() => setIsLinkedPapersOpen(false)}
            dashboardTitle={currentDashboard.title}
            dashboardNodes={currentDashboard.paperNodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={(nodeId) => {
              setSelectedNodeId(nodeId);
              handleLocateNode(nodeId);
            }}
            onLocateNode={handleLocateNode}
            onAddLinkedPaperAsNode={handleAddLinkedPaperAsNode}
          />
        </div>
      </div>

      {/* 3. Paper Inspector Drawer (when a node is selected) */}
      {isInspectorOpen && selectedNode && (
        <PaperInspector
          node={selectedNode}
          allNodes={currentDashboard.paperNodes}
          edges={currentDashboard.paperEdges}
          onUpdateNode={(updated) => {
            recordHistory();
            handleUpdateNodes(
              currentDashboard.paperNodes.map((n) => (n.id === updated.id ? updated : n))
            );
          }}
          onDeleteNode={handleDeleteNode}
          onCreateEdge={handleCreateEdge}
          onDeleteEdge={handleDeleteEdge}
          onClose={() => {
            setIsInspectorOpen(false);
            setSelectedNodeId(null);
          }}
          onFocusNode={(nodeId) => {
            setSelectedNodeId(nodeId);
          }}
          onAddConnectedPaper={handleAddConnectedPaper}
        />
      )}

      {/* 4. Add Research Paper Modal */}
      <AddPaperModal
        isOpen={isAddPaperModalOpen}
        onClose={() => setIsAddPaperModalOpen(false)}
        onAddPaper={handleAddPaperNode}
      />

      {/* 5. Edge Editor Modal */}
      {isEdgeEditorModalOpen && selectedEdge && (
        <EdgeEditorModal
          edge={selectedEdge}
          sourceNode={edgeSourceNode}
          targetNode={edgeTargetNode}
          onUpdateEdge={(updated) => {
            recordHistory();
            handleUpdateEdges(
              currentDashboard.paperEdges.map((e) => (e.id === updated.id ? updated : e))
            );
          }}
          onDeleteEdge={handleDeleteEdge}
          onClose={() => {
            setIsEdgeEditorModalOpen(false);
            setSelectedEdgeId(null);
          }}
        />
      )}

      {/* 6. Shortcuts & Interaction Guide Modal */}
      <ShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </div>
  );
}
