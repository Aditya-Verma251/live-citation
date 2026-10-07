import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, Crosshair, ArrowRight, GitBranch } from 'lucide-react';
import type { PaperEdge, PaperNode } from '../types';
import { edgeProblem, type NewNodeInput } from '../utils/graphOps';

interface GraphManagerSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: PaperNode[];
  edges: PaperEdge[];
  selectedNodeId: string | null;
  /** Select + scroll the canvas to a node. */
  onLocateNode: (nodeId: string) => void;
  onAddNode: (input: NewNodeInput) => void;
  onDeleteNode: (nodeId: string) => void;
  onAddEdge: (sourceNodeId: string, targetNodeId: string, label: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}

const LABEL_SUGGESTIONS = ['Cites', 'Extends', 'Improves', 'Contradicts', 'Benchmarks', 'Foundation'];

const inputCls =
  'w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelCls = 'block text-[11px] font-medium text-slate-600 mb-1';

/**
 * The ONLY place the graph is edited. The canvas is a read-only view of what this panel changes.
 */
export const GraphManagerSidebar: React.FC<GraphManagerSidebarProps> = ({
  isOpen,
  onClose,
  nodes,
  edges,
  selectedNodeId,
  onLocateNode,
  onAddNode,
  onDeleteNode,
  onAddEdge,
  onDeleteEdge,
}) => {
  /* ---- add node form ---- */
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [abstract, setAbstract] = useState('');
  const [xStr, setXStr] = useState('');
  const [yStr, setYStr] = useState('');

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
    setTitle('');
    setAuthors('');
    setAbstract('');
    setXStr('');
    setYStr('');
  };

  /* ---- add edge form ---- */
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [edgeLabel, setEdgeLabel] = useState('');

  // Forget picks whose node was deleted
  useEffect(() => {
    if (sourceId && !nodes.some((n) => n.id === sourceId)) setSourceId('');
    if (targetId && !nodes.some((n) => n.id === targetId)) setTargetId('');
  }, [nodes, sourceId, targetId]);

  const problem = useMemo(
    () => edgeProblem({ nodes, edges }, sourceId, targetId, edgeLabel),
    [nodes, edges, sourceId, targetId, edgeLabel]
  );
  const showProblem = problem && sourceId && targetId; // don't nag before both are picked

  const submitEdge = (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) return;
    onAddEdge(sourceId, targetId, edgeLabel.trim());
    setEdgeLabel('');
  };

  /* ---- two-step delete ---- */
  const [confirmNodeId, setConfirmNodeId] = useState<string | null>(null);
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;
  const degree = (id: string) => edges.filter((e) => e.sourceNodeId === id || e.targetNodeId === id).length;

  if (!isOpen) return null;

  return (
    <aside className="w-80 shrink-0 h-full bg-white border-l border-slate-200 flex flex-col z-20">
      <div className="h-11 px-3 flex items-center justify-between border-b border-slate-200">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <GitBranch size={15} className="text-indigo-600" />
          Graph
          <span className="text-[11px] font-normal text-slate-400">
            {nodes.length} nodes · {edges.length} edges
          </span>
        </div>
        <button onClick={onClose} aria-label="Close graph panel" className="p-1 rounded hover:bg-slate-100 text-slate-500">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {/* ------------------------------ NODES ------------------------------ */}
        <section className="p-3 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Nodes</h3>

          <form onSubmit={submitNode} className="space-y-2 rounded-lg border border-slate-200 p-2.5 bg-slate-50/60">
            <label className="block">
              <span className={labelCls}>Title *</span>
              <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Attention Is All You Need" />
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
            <button
              type="submit"
              disabled={!title.trim()}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={13} /> Add node
            </button>
          </form>

          {nodes.length === 0 ? (
            <p className="text-xs text-slate-400">No nodes yet.</p>
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
                      <div className="font-medium text-slate-800 truncate" title={n.title}>{n.title}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {n.authors} · {degree(n.id)} edge{degree(n.id) === 1 ? '' : 's'}
                      </div>
                    </div>
                    <button onClick={() => onLocateNode(n.id)} title="Show on canvas" aria-label="Show on canvas" className="p-1 rounded hover:bg-slate-100 text-slate-500">
                      <Crosshair size={13} />
                    </button>
                    <button onClick={() => setConfirmNodeId(n.id)} title="Delete node" aria-label="Delete node" className="p-1 rounded hover:bg-rose-50 text-slate-500 hover:text-rose-600">
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

        {/* ------------------------------ EDGES ------------------------------ */}
        <section className="p-3 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Edges</h3>

          <form onSubmit={submitEdge} className="space-y-2 rounded-lg border border-slate-200 p-2.5 bg-slate-50/60">
            {nodes.length < 2 ? (
              <p className="text-xs text-slate-400">Add at least two nodes to connect them.</p>
            ) : (
              <>
                <label className="block">
                  <span className={labelCls}>Source</span>
                  <select className={inputCls} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                    <option value="">Select a node…</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>{n.title}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={labelCls}>Target</span>
                  <select className={inputCls} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                    <option value="">Select a node…</option>
                    {nodes.filter((n) => n.id !== sourceId).map((n) => (
                      <option key={n.id} value={n.id}>{n.title}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={labelCls}>Relationship</span>
                  <input className={inputCls} value={edgeLabel} onChange={(e) => setEdgeLabel(e.target.value)} placeholder="e.g. Cites, Contradicts…" />
                </label>
                <div className="flex flex-wrap gap-1">
                  {LABEL_SUGGESTIONS.map((s) => (
                    <button type="button" key={s} onClick={() => setEdgeLabel(s)} className="px-1.5 py-0.5 rounded-full border border-slate-200 text-[10px] text-slate-600 hover:bg-white">
                      {s}
                    </button>
                  ))}
                </div>
                {showProblem && <p className="text-[11px] text-amber-600">{problem}</p>}
                <button
                  type="submit"
                  disabled={!!problem}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={13} /> Create edge
                </button>
              </>
            )}
          </form>

          {edges.length === 0 ? (
            <p className="text-xs text-slate-400">No edges yet.</p>
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
                  <button onClick={() => onDeleteEdge(e.id)} title="Delete edge" aria-label="Delete edge" className="p-1 rounded hover:bg-rose-50 text-slate-500 hover:text-rose-600">
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
};
