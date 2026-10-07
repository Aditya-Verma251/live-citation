import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Network,
  X,
  Search,
  CheckCircle2,
  Plus,
  GripVertical,
  ExternalLink,
  GitBranch,
  ArrowRight,
  Crosshair,
  Trash2,
  Link2,
} from 'lucide-react';
import type { ResearchPaperEdge, ResearchPaperNode } from '../types';
import {
  LinkedPaperItem,
  getLinkedPapersForNode,
  getAllLinkedPapersForDashboard,
  isPaperOnDashboard,
} from '../data/linkedPapersData';
import type { NewNodeInput } from '../utils/graphOps';
import { LINKED_PAPER_MIME } from '../utils/dnd';

/**
 * ONE sidebar for everything that edits or feeds the graph. It replaces the old LinkedPapersSidebar and
 * GraphManagerSidebar:
 *
 *   header      title + counts + close
 *   actions     [+ New node]  [Add edge]            <- explicit node creation / interactive edge flow
 *   tab Papers  linked-paper discovery: focus picker, search, filters, DRAGGABLE cards (+ "Add as Node")
 *   tab Graph   every node (locate / delete) and every edge (delete)
 */
interface GraphSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: ResearchPaperNode[];
  edges: ResearchPaperEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  /** Select + scroll the canvas to a node. */
  onLocateNode: (nodeId: string) => void;
  /** "Add as Node" button on a linked-paper card (drag & drop goes straight to the canvas instead). */
  onAddLinkedPaperAsNode: (paper: LinkedPaperItem) => void;
  /** Create a brand-new node from the "New node" form. */
  onAddNode: (input: NewNodeInput) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  /** Edge flow (state lives in App; the prompts are drawn over the canvas). */
  isEdgeFlowActive: boolean;
  onStartAddEdge: () => void;
  onCancelAddEdge: () => void;
}

type Tab = 'papers' | 'graph';
type PaperFilter = 'all' | 'not-added' | 'added';

const inputCls =
  'w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelCls = 'block text-[11px] font-medium text-slate-600 mb-1';

export const GraphSidebar: React.FC<GraphSidebarProps> = ({
  isOpen,
  onClose,
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onLocateNode,
  onAddLinkedPaperAsNode,
  onAddNode,
  onDeleteNode,
  onDeleteEdge,
  isEdgeFlowActive,
  onStartAddEdge,
  onCancelAddEdge,
}) => {
  const [tab, setTab] = useState<Tab>('papers');

  /* ================================ new node ================================ */
  const [isNodeFormOpen, setIsNodeFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [abstract, setAbstract] = useState('');
  const [xStr, setXStr] = useState('');
  const [yStr, setYStr] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isNodeFormOpen) titleInputRef.current?.focus();
  }, [isNodeFormOpen]);

  const resetNodeForm = () => {
    setTitle('');
    setAuthors('');
    setAbstract('');
    setXStr('');
    setYStr('');
  };

  const submitNode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const x = xStr.trim() === '' ? NaN : Number(xStr);
    const y = yStr.trim() === '' ? NaN : Number(yStr);
    onAddNode({
      title,
      authors,
      abstract,
      ...(Number.isFinite(x) && Number.isFinite(y) ? { x, y } : {}),
    });
    resetNodeForm();
    setIsNodeFormOpen(false);
  };

  /* ============================ linked papers tab ============================ */
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<PaperFilter>('all');
  const [customSelectedParentId, setCustomSelectedParentId] = useState<string>('auto');

  // When a node is selected on the canvas, go back to following the canvas selection
  useEffect(() => {
    setCustomSelectedParentId('auto');
  }, [selectedNodeId]);

  // Which parent paper to focus on: the dropdown pick, else the canvas selection, else everything.
  const effectiveFocusNodeId = useMemo(() => {
    if (customSelectedParentId !== 'auto') return customSelectedParentId;
    if (selectedNodeId && nodes.some((n) => n.id === selectedNodeId)) return selectedNodeId;
    return 'all';
  }, [customSelectedParentId, selectedNodeId, nodes]);

  const linkedPapers = useMemo(() => {
    if (effectiveFocusNodeId === 'all') return getAllLinkedPapersForDashboard(nodes);
    const parent = nodes.find((n) => n.id === effectiveFocusNodeId);
    return getLinkedPapersForNode(effectiveFocusNodeId, parent?.title);
  }, [effectiveFocusNodeId, nodes]);

  const selectedParentNode = useMemo(
    () => (effectiveFocusNodeId === 'all' ? null : nodes.find((n) => n.id === effectiveFocusNodeId) || null),
    [effectiveFocusNodeId, nodes]
  );

  const filteredPapers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return linkedPapers.filter((paper) => {
      const onBoard = isPaperOnDashboard(paper, nodes);
      if (activeFilter === 'not-added' && onBoard) return false;
      if (activeFilter === 'added' && !onBoard) return false;
      if (!q) return true;
      return (
        paper.title.toLowerCase().includes(q) ||
        paper.authors.toLowerCase().includes(q) ||
        paper.relationDescription.toLowerCase().includes(q) ||
        paper.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [linkedPapers, activeFilter, searchQuery, nodes]);

  const addedCount = useMemo(() => linkedPapers.filter((p) => isPaperOnDashboard(p, nodes)).length, [linkedPapers, nodes]);
  const notAddedCount = linkedPapers.length - addedCount;

  /** Drag source: the canvas reads this payload in its onDrop handler and creates the node (+ edge to its parent). */
  const handlePaperDragStart = (e: React.DragEvent, paper: LinkedPaperItem) => {
    e.dataTransfer.setData(LINKED_PAPER_MIME, JSON.stringify(paper));
    e.dataTransfer.setData('text/plain', paper.title); // harmless fallback for other drop targets
    e.dataTransfer.effectAllowed = 'copy';
  };

  /* ================================ graph tab ================================ */
  const [confirmNodeId, setConfirmNodeId] = useState<string | null>(null);
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;
  const degree = (id: string) => edges.filter((e) => e.sourceNodeId === id || e.targetNodeId === id).length;

  if (!isOpen) return null;

  const canAddEdge = nodes.length >= 2;

  return (
    <aside
      id="graph-sidebar"
      className="w-80 shrink-0 h-full bg-white border-l border-slate-200 flex flex-col z-20 select-none shadow-lg"
    >
      {/* ------------------------------ header ------------------------------ */}
      <div className="p-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
            <Network className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-slate-900">Papers & Graph</h2>
            <p className="text-[10px] text-slate-500">
              {nodes.length} nodes · {edges.length} edges
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close sidebar"
          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/80 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* --------------------------- primary actions --------------------------- */}
      <div className="p-2.5 border-b border-slate-200 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            id="btn-new-node"
            onClick={() => setIsNodeFormOpen((v) => !v)}
            aria-expanded={isNodeFormOpen}
            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              isNodeFormOpen
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-300'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 border border-indigo-600'
            }`}
          >
            <Plus size={13} /> New node
          </button>

          {isEdgeFlowActive ? (
            <button
              id="btn-add-edge"
              onClick={onCancelAddEdge}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100"
            >
              <X size={13} /> Cancel edge
            </button>
          ) : (
            <button
              id="btn-add-edge"
              onClick={onStartAddEdge}
              disabled={!canAddEdge}
              title={canAddEdge ? 'Click a source node, a destination node, then pick the relationship' : 'Add at least two nodes first'}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Link2 size={13} /> Add edge
            </button>
          )}
        </div>

        {isNodeFormOpen && (
          <form onSubmit={submitNode} className="space-y-2 rounded-lg border border-slate-200 p-2.5 bg-slate-50/60">
            <label className="block">
              <span className={labelCls}>Title *</span>
              <input
                ref={titleInputRef}
                className={inputCls}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Attention Is All You Need"
              />
            </label>
            <label className="block">
              <span className={labelCls}>Authors</span>
              <input className={inputCls} value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="Vaswani et al." />
            </label>
            <label className="block">
              <span className={labelCls}>Abstract</span>
              <textarea className={inputCls + ' resize-none'} rows={3} value={abstract} onChange={(e) => setAbstract(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={labelCls}>X (optional)</span>
                <input className={inputCls} type="number" value={xStr} onChange={(e) => setXStr(e.target.value)} />
              </label>
              <label className="block">
                <span className={labelCls}>Y (optional)</span>
                <input className={inputCls} type="number" value={yStr} onChange={(e) => setYStr(e.target.value)} />
              </label>
            </div>
            <p className="text-[10px] text-slate-400">Leave X / Y empty to place it at the centre of the view.</p>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!title.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={13} /> Add to graph
              </button>
              <button
                type="button"
                onClick={() => {
                  resetNodeForm();
                  setIsNodeFormOpen(false);
                }}
                className="px-3 py-1.5 rounded-md border border-slate-300 text-xs text-slate-600 hover:bg-white"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* --------------------------------- tabs --------------------------------- */}
      <div role="tablist" className="grid grid-cols-2 border-b border-slate-200 text-xs font-semibold">
        {(
          [
            ['papers', `Linked papers (${linkedPapers.length})`],
            ['graph', `Nodes & edges (${nodes.length + edges.length})`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`py-2 border-b-2 transition-colors ${
              tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ============================ TAB: linked papers ============================ */}
      {tab === 'papers' && (
        <>
          <div className="p-2.5 bg-slate-100/70 border-b border-slate-200 space-y-2">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Linked to paper:
              </label>
              <select
                id="select-parent-paper"
                value={effectiveFocusNodeId}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomSelectedParentId(val);
                  if (val !== 'all') onSelectNode(val);
                }}
                className="w-full py-1.5 px-2 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              >
                <option value="all">✦ All papers on this board ({nodes.length} nodes)</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title.length > 34 ? `${n.title.slice(0, 34)}...` : n.title} ({n.year})
                  </option>
                ))}
              </select>
            </div>

            {selectedParentNode && (
              <div className="p-2 rounded-md bg-white border border-slate-200/90 flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <span className="text-[10px] font-medium text-indigo-600 block">Focus node:</span>
                  <p className="text-xs font-semibold text-slate-900 truncate">{selectedParentNode.title}</p>
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
            <div className="grid grid-cols-3 gap-1 text-[10px] font-semibold">
              {(
                [
                  ['all', `All (${linkedPapers.length})`, 'bg-slate-900 text-white', 'bg-slate-100 text-slate-600 hover:bg-slate-200'],
                  ['not-added', `+ Available (${notAddedCount})`, 'bg-blue-600 text-white', 'bg-blue-50 text-blue-700 hover:bg-blue-100'],
                  ['added', `✓ On canvas (${addedCount})`, 'bg-emerald-600 text-white', 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'],
                ] as [PaperFilter, string, string, string][]
              ).map(([id, label, on, off]) => (
                <button
                  key={id}
                  onClick={() => setActiveFilter(id)}
                  className={`py-1 rounded-md transition-all text-center ${activeFilter === id ? on : off}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-3 py-1.5 bg-indigo-50/70 border-b border-indigo-100 text-[10px] text-indigo-900 flex items-center gap-1">
            <GripVertical className="w-3 h-3 text-indigo-500" />
            <span>Drag a paper onto the canvas to add it as a node</span>
          </div>

          <div id="linked-papers-list" className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
            {filteredPapers.map((paper) => {
              const isOnCanvas = isPaperOnDashboard(paper, nodes);
              const existingNode = isOnCanvas
                ? nodes.find((n) => n.id === paper.id || n.title === paper.title)
                : undefined;

              return (
                <div
                  key={paper.id}
                  id={`linked-paper-card-${paper.id}`}
                  draggable={!isOnCanvas}
                  onDragStart={(e) => handlePaperDragStart(e, paper)}
                  className={`p-3 rounded-xl border transition-all duration-150 ${
                    isOnCanvas
                      ? 'bg-emerald-50/40 border-emerald-200/90'
                      : 'bg-white hover:bg-indigo-50/40 border-slate-200 hover:border-indigo-300 hover:shadow-md group cursor-grab active:cursor-grabbing'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: paper.color }} />
                      <h4 className="text-xs font-bold text-slate-900 leading-snug line-clamp-2 group-hover:text-indigo-700 transition-colors">
                        {paper.title}
                      </h4>
                    </div>
                    {isOnCanvas ? (
                      <span
                        title="Already added as a node on this canvas"
                        className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        On canvas
                      </span>
                    ) : (
                      <span
                        title="Drag and drop onto canvas"
                        className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-0.5 group-hover:bg-blue-600 group-hover:text-white transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        Available
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                    <span className="truncate max-w-[130px]">{paper.authors}</span>
                    <span className="font-mono text-slate-400 font-medium ml-1">
                      {paper.venue} ({paper.year})
                    </span>
                  </div>

                  <div className="mt-2 p-1.5 rounded-md bg-slate-50 border border-slate-100 text-[10px] text-slate-700 space-y-0.5">
                    <div className="flex items-center gap-1 font-semibold text-indigo-700">
                      <GitBranch className="w-3 h-3 flex-shrink-0" />
                      <span className="capitalize">{paper.relationType.replace('-', ' ')}</span>
                      <span className="text-slate-400">→</span>
                      <span className="truncate text-slate-600 font-normal">{paper.linkedToPaperTitle}</span>
                    </div>
                    <p className="text-[10px] text-slate-600 leading-snug line-clamp-2">{paper.relationDescription}</p>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
                    {isOnCanvas ? (
                      <button
                        onClick={() => existingNode && onLocateNode(existingNode.id)}
                        className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 hover:underline"
                      >
                        <Crosshair className="w-3 h-3" />
                        Locate on canvas
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-between">
                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                          <GripVertical className="w-3 h-3" />
                          Drag to drop
                        </span>
                        <button
                          onClick={() => onAddLinkedPaperAsNode(paper)}
                          className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[10px] font-bold flex items-center gap-1 transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                          Add as node
                        </button>
                      </div>
                    )}

                    {paper.arxivId && (
                      <a
                        href={`https://arxiv.org/abs/${paper.arxivId}`}
                        target="_blank"
                        rel="noreferrer"
                        draggable={false}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[9px] font-mono text-slate-400 hover:text-indigo-600 flex items-center gap-0.5 flex-shrink-0"
                        title="View arXiv"
                      >
                        arXiv
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}

            {filteredPapers.length === 0 && (
              <div className="p-6 text-center text-slate-400 text-xs space-y-1">
                <p className="font-semibold">No linked papers match</p>
                <p className="text-[11px]">Try switching filters or search terms</p>
              </div>
            )}
          </div>

          <div className="p-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              {addedCount} on canvas
            </span>
            <span className="text-[10px] text-slate-400">{notAddedCount} available to add</span>
          </div>
        </>
      )}

      {/* ============================ TAB: nodes & edges ============================ */}
      {tab === 'graph' && (
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          <section className="p-3 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Nodes</h3>
            {nodes.length === 0 ? (
              <p className="text-xs text-slate-400">No nodes yet. Use “New node” or drag a linked paper onto the canvas.</p>
            ) : (
              <ul className="space-y-1">
                {nodes.map((n) => (
                  <li
                    key={n.id}
                    className={`rounded-md border px-2 py-1.5 text-xs ${
                      n.id === selectedNodeId ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-800 truncate" title={n.title}>
                          {n.title}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {n.authors} · {degree(n.id)} edge{degree(n.id) === 1 ? '' : 's'}
                        </div>
                      </div>
                      <button
                        onClick={() => onLocateNode(n.id)}
                        title="Show on canvas"
                        aria-label="Show on canvas"
                        className="p-1 rounded hover:bg-slate-100 text-slate-500"
                      >
                        <Crosshair size={13} />
                      </button>
                      <button
                        onClick={() => setConfirmNodeId(n.id)}
                        title="Delete node"
                        aria-label="Delete node"
                        className="p-1 rounded hover:bg-rose-50 text-slate-500 hover:text-rose-600"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {confirmNodeId === n.id && (
                      <div className="mt-1.5 flex items-center justify-between gap-2 rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                        <span>
                          Delete{degree(n.id) > 0 ? ` with ${degree(n.id)} edge${degree(n.id) === 1 ? '' : 's'}` : ''}?
                        </span>
                        <span className="flex gap-1">
                          <button
                            onClick={() => {
                              onDeleteNode(n.id);
                              setConfirmNodeId(null);
                            }}
                            className="px-1.5 py-0.5 rounded bg-rose-600 text-white"
                          >
                            Delete
                          </button>
                          <button onClick={() => setConfirmNodeId(null)} className="px-1.5 py-0.5 rounded bg-white border border-rose-200">
                            Keep
                          </button>
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="p-3 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Edges</h3>
            {edges.length === 0 ? (
              <p className="text-xs text-slate-400">No edges yet. Use “Add edge” to connect two nodes.</p>
            ) : (
              <ul className="space-y-1">
                {edges.map((e) => (
                  <li key={e.id} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 text-slate-700">
                        <span className="truncate" title={titleOf(e.sourceNodeId)}>{titleOf(e.sourceNodeId)}</span>
                        <ArrowRight size={11} className="shrink-0 text-slate-400" />
                        <span className="truncate" title={titleOf(e.targetNodeId)}>{titleOf(e.targetNodeId)}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">{e.label || e.relationType}</div>
                    </div>
                    <button
                      onClick={() => onDeleteEdge(e.id)}
                      title="Delete edge"
                      aria-label="Delete edge"
                      className="p-1 rounded hover:bg-rose-50 text-slate-500 hover:text-rose-600"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </aside>
  );
};
