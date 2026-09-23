import React, { useState, useMemo } from 'react';
import {
  Network,
  X,
  Search,
  CheckCircle2,
  Plus,
  GripVertical,
  ExternalLink,
  ChevronRight,
  Filter,
  Sparkles,
  GitBranch,
  ArrowRight,
  Crosshair,
} from 'lucide-react';
import { ResearchPaperNode } from '../types';
import {
  LinkedPaperItem,
  getLinkedPapersForNode,
  getAllLinkedPapersForDashboard,
  isPaperOnDashboard,
} from '../data/linkedPapersData';

interface LinkedPapersSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  dashboardTitle: string;
  dashboardNodes: ResearchPaperNode[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onLocateNode: (nodeId: string) => void;
  onAddLinkedPaperAsNode: (paper: LinkedPaperItem) => void;
}

export const LinkedPapersSidebar: React.FC<LinkedPapersSidebarProps> = ({
  isOpen,
  onClose,
  dashboardTitle,
  dashboardNodes,
  selectedNodeId,
  onSelectNode,
  onLocateNode,
  onAddLinkedPaperAsNode,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'not-added' | 'added'>('all');
  const [customSelectedParentId, setCustomSelectedParentId] = useState<string | 'all'>('auto');

  // Determine which parent paper to focus on:
  // If user explicitly picked a parent in the dropdown, use that;
  // otherwise, if selectedNodeId is valid, focus on that node; otherwise 'all'.
  const effectiveFocusNodeId = useMemo(() => {
    if (customSelectedParentId !== 'auto') {
      return customSelectedParentId;
    }
    if (selectedNodeId && dashboardNodes.some((n) => n.id === selectedNodeId)) {
      return selectedNodeId;
    }
    return 'all';
  }, [customSelectedParentId, selectedNodeId, dashboardNodes]);

  // Retrieve the linked papers
  const linkedPapers = useMemo(() => {
    if (effectiveFocusNodeId === 'all') {
      return getAllLinkedPapersForDashboard(dashboardNodes);
    } else {
      const parentNode = dashboardNodes.find((n) => n.id === effectiveFocusNodeId);
      return getLinkedPapersForNode(effectiveFocusNodeId, parentNode?.title);
    }
  }, [effectiveFocusNodeId, dashboardNodes]);

  // Selected parent node info
  const selectedParentNode = useMemo(() => {
    if (effectiveFocusNodeId === 'all') return null;
    return dashboardNodes.find((n) => n.id === effectiveFocusNodeId) || null;
  }, [effectiveFocusNodeId, dashboardNodes]);

  // Filtered papers
  const filteredPapers = useMemo(() => {
    return linkedPapers.filter((paper) => {
      const onBoard = isPaperOnDashboard(paper, dashboardNodes);

      if (activeFilter === 'not-added' && onBoard) return false;
      if (activeFilter === 'added' && !onBoard) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        paper.title.toLowerCase().includes(q) ||
        paper.authors.toLowerCase().includes(q) ||
        paper.relationDescription.toLowerCase().includes(q) ||
        paper.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [linkedPapers, activeFilter, searchQuery, dashboardNodes]);

  // Counts for tabs
  const notAddedCount = useMemo(() => {
    return linkedPapers.filter((p) => !isPaperOnDashboard(p, dashboardNodes)).length;
  }, [linkedPapers, dashboardNodes]);

  const addedCount = useMemo(() => {
    return linkedPapers.filter((p) => isPaperOnDashboard(p, dashboardNodes)).length;
  }, [linkedPapers, dashboardNodes]);

  if (!isOpen) return null;

  return (
    <aside
      id="linked-papers-sidebar"
      className="w-80 sm:w-88 border-l border-slate-200 bg-white flex flex-col h-full flex-shrink-0 select-none shadow-lg z-20 relative"
    >
      {/* 1. Header */}
      <div className="p-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
            <Network className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <h2 className="text-xs font-bold text-slate-900">Linked Papers</h2>
              <span className="text-[10px] font-bold px-1.5 py-0.2 bg-indigo-100 text-indigo-700 rounded-full">
                {linkedPapers.length}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 truncate max-w-[190px]">
              Citations & Connected Literature
            </p>
          </div>
        </div>

        <button
          id="btn-close-linked-sidebar"
          onClick={onClose}
          title="Collapse Linked Papers"
          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/80 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Context Selector: Focus on specific paper or all dashboard papers */}
      <div className="p-2.5 bg-slate-100/70 border-b border-slate-200 space-y-2">
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Linked to Paper:
          </label>
          <select
            id="select-parent-paper"
            value={effectiveFocusNodeId}
            onChange={(e) => {
              const val = e.target.value;
              setCustomSelectedParentId(val);
              if (val !== 'all') {
                onSelectNode(val);
              }
            }}
            className="w-full py-1.5 px-2 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-800 shadow-2xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">✦ All Dashboard Papers ({dashboardNodes.length} nodes)</option>
            {dashboardNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title.length > 34 ? `${n.title.slice(0, 34)}...` : n.title} ({n.year})
              </option>
            ))}
          </select>
        </div>

        {selectedParentNode && (
          <div className="p-2 rounded-md bg-white border border-slate-200/90 shadow-2xs flex items-center justify-between">
            <div className="min-w-0 pr-2">
              <span className="text-[10px] font-medium text-indigo-600 block">Selected Focus Node:</span>
              <p className="text-xs font-semibold text-slate-900 truncate">
                {selectedParentNode.title}
              </p>
            </div>
            <button
              onClick={() => onLocateNode(selectedParentNode.id)}
              title="Locate on canvas"
              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors flex-shrink-0"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 3. Search & Filter Bar */}
      <div className="p-2.5 space-y-2 border-b border-slate-100">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <input
            id="input-search-linked-papers"
            type="text"
            placeholder="Search linked papers & tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Status Filter Pills */}
        <div className="grid grid-cols-3 gap-1 text-[10px] font-semibold">
          <button
            onClick={() => setActiveFilter('all')}
            className={`py-1 rounded-md transition-all text-center ${
              activeFilter === 'all'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({linkedPapers.length})
          </button>
          <button
            onClick={() => setActiveFilter('not-added')}
            className={`py-1 rounded-md transition-all text-center ${
              activeFilter === 'not-added'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
          >
            + Available ({notAddedCount})
          </button>
          <button
            onClick={() => setActiveFilter('added')}
            className={`py-1 rounded-md transition-all text-center ${
              activeFilter === 'added'
                ? 'bg-emerald-600 text-white shadow-2xs'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            ✓ On Canvas ({addedCount})
          </button>
        </div>
      </div>

      {/* Drag & Drop Instruction Helper Banner */}
      <div className="px-3 py-1.5 bg-indigo-50/70 border-b border-indigo-100 text-[10px] text-indigo-900 flex items-center justify-between">
        <span className="flex items-center space-x-1">
          <GripVertical className="w-3 h-3 text-indigo-500" />
          <span>Drag papers onto canvas to insert node & edge</span>
        </span>
      </div>

      {/* 4. List of Linked Papers */}
      <div
        id="linked-papers-list"
        className="flex-1 overflow-y-auto p-2.5 space-y-2.5"
      >
        {filteredPapers.map((paper) => {
          const isOnCanvas = isPaperOnDashboard(paper, dashboardNodes);
          const existingNode = isOnCanvas
            ? dashboardNodes.find((n) => n.id === paper.id || n.title === paper.title)
            : undefined;

          return (
            <div
              key={paper.id}
              id={`linked-paper-card-${paper.id}`}
              draggable={!isOnCanvas}
              onDragStart={(e) => {
                if (isOnCanvas) return;
                e.dataTransfer.setData('application/json', JSON.stringify(paper));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              className={`p-3 rounded-xl border transition-all duration-150 ${
                isOnCanvas
                  ? 'bg-emerald-50/40 border-emerald-200/90 shadow-2xs'
                  : 'bg-white hover:bg-indigo-50/40 border-slate-200 hover:border-indigo-300 shadow-xs hover:shadow-md cursor-grab active:cursor-grabbing group'
              }`}
            >
              {/* Header with Title & Accent */}
              <div className="flex items-start justify-between gap-1.5">
                <div className="flex items-center space-x-1.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: paper.color }}
                  />
                  <h4 className="text-xs font-bold text-slate-900 leading-snug line-clamp-2 group-hover:text-indigo-700 transition-colors">
                    {paper.title}
                  </h4>
                </div>

                {/* Clear Indication of In Dashboard or Not */}
                {isOnCanvas ? (
                  <span
                    title="Already added as a node on this canvas"
                    className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center space-x-1 shadow-2xs"
                  >
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>On Canvas</span>
                  </span>
                ) : (
                  <span
                    title="Drag and drop onto canvas"
                    className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 flex items-center space-x-0.5 group-hover:bg-blue-600 group-hover:text-white transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Available</span>
                  </span>
                )}
              </div>

              {/* Authors & Year & Venue */}
              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                <span className="truncate max-w-[160px]">{paper.authors}</span>
                <span className="font-mono text-slate-400 font-medium ml-1">
                  {paper.venue} ({paper.year})
                </span>
              </div>

              {/* Relationship Tag to Parent */}
              <div className="mt-2 p-1.5 rounded-md bg-slate-50 border border-slate-100 text-[10px] text-slate-700 space-y-0.5">
                <div className="flex items-center space-x-1 font-semibold text-indigo-700">
                  <GitBranch className="w-3 h-3 flex-shrink-0" />
                  <span className="capitalize">{paper.relationType.replace('-', ' ')}</span>
                  <span className="text-slate-400">→</span>
                  <span className="truncate text-slate-600 font-normal">
                    {paper.linkedToPaperTitle}
                  </span>
                </div>
                <p className="text-[10px] text-slate-600 leading-snug line-clamp-2">
                  {paper.relationDescription}
                </p>
              </div>

              {/* Actions Footer */}
              <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
                {isOnCanvas ? (
                  <button
                    onClick={() => {
                      if (existingNode) onLocateNode(existingNode.id);
                    }}
                    className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 flex items-center space-x-1 hover:underline cursor-pointer"
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>Locate on Canvas</span>
                  </button>
                ) : (
                  <div className="flex items-center space-x-1.5 w-full justify-between">
                    <span className="text-[10px] text-slate-400 flex items-center space-x-0.5">
                      <GripVertical className="w-3 h-3" />
                      <span>Drag to drop</span>
                    </span>
                    <button
                      onClick={() => onAddLinkedPaperAsNode(paper)}
                      className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[10px] font-bold flex items-center space-x-1 shadow-2xs transition-colors cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add as Node</span>
                    </button>
                  </div>
                )}

                {paper.arxivId && (
                  <a
                    href={`https://arxiv.org/abs/${paper.arxivId}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[9px] font-mono text-slate-400 hover:text-indigo-600 flex items-center space-x-0.5 ml-auto"
                    title="View arXiv"
                  >
                    <span>arXiv</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </div>
          );
        })}

        {filteredPapers.length === 0 && (
          <div className="p-6 text-center text-slate-400 text-xs space-y-1">
            <p className="font-semibold">No linked papers match query</p>
            <p className="text-[11px]">Try switching filters or search terms</p>
          </div>
        )}
      </div>

      {/* Bottom Summary Footer */}
      <div className="p-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
        <span className="flex items-center space-x-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>{addedCount} on canvas</span>
        </span>
        <span className="text-[10px] text-slate-400">
          {notAddedCount} available to add
        </span>
      </div>
    </aside>
  );
};
