import React, { useState } from 'react';
import {
  X,
  ExternalLink,
  BookOpen,
  Calendar,
  Award,
  Tag,
  Link as LinkIcon,
  Trash2,
  Plus,
  ArrowRight,
  GitBranch,
  Edit3,
  CheckCircle2,
  Clock,
  Bookmark,
  Share2,
} from 'lucide-react';
import { ResearchPaperNode, ResearchPaperEdge, RelationType, PaperStatus } from '../types';

interface PaperInspectorProps {
  node: ResearchPaperNode | null;
  allNodes: ResearchPaperNode[];
  edges: ResearchPaperEdge[];
  onUpdateNode: (updated: ResearchPaperNode) => void;
  onDeleteNode: (nodeId: string) => void;
  onCreateEdge: (sourceId: string, targetId: string, relationType: RelationType) => void;
  onDeleteEdge: (edgeId: string) => void;
  onClose: () => void;
  onFocusNode: (nodeId: string) => void;
  onAddConnectedPaper: (sourceNodeId: string) => void;
}

const COLOR_OPTIONS = [
  { label: 'Indigo', value: '#4f46e5' },
  { label: 'Sky', value: '#0284c7' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Amber', value: '#d97706' },
  { label: 'Purple', value: '#9333ea' },
  { label: 'Rose', value: '#e11d48' },
  { label: 'Slate', value: '#475569' },
];

const RELATION_TYPES: { type: RelationType; label: string; desc: string }[] = [
  { type: 'extends', label: 'Extends / Builds Upon', desc: 'Direct architectural or algorithmic continuation' },
  { type: 'improves', label: 'Improves / Optimizes', desc: 'Increases efficiency, memory footprint, or speed' },
  { type: 'cites', label: 'Cites / References', desc: 'General bibliographic reference' },
  { type: 'theoretical-foundation', label: 'Theoretical Foundation', desc: 'Underpinning mathematical formulation' },
  { type: 'benchmarks', label: 'Benchmarks Against', desc: 'Comparative baseline or metric evaluation' },
  { type: 'contradicts', label: 'Contradicts / Challenges', desc: 'Challenged hypothesis or empirical counter-finding' },
];

export const PaperInspector: React.FC<PaperInspectorProps> = ({
  node,
  allNodes,
  edges,
  onUpdateNode,
  onDeleteNode,
  onCreateEdge,
  onDeleteEdge,
  onClose,
  onFocusNode,
  onAddConnectedPaper,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const [newInsightInput, setNewInsightInput] = useState('');
  const [targetPaperSelect, setTargetPaperSelect] = useState('');
  const [relationSelect, setRelationSelect] = useState<RelationType>('extends');

  if (!node) return null;

  // Filter edges for this node
  const outgoingEdges = edges.filter((e) => e.sourceNodeId === node.id);
  const incomingEdges = edges.filter((e) => e.targetNodeId === node.id);

  // Available target papers to connect to
  const availableTargets = allNodes.filter(
    (n) => n.id !== node.id && !outgoingEdges.some((e) => e.targetNodeId === n.id)
  );

  const handleAddTag = () => {
    if (!newTagInput.trim()) return;
    const tag = newTagInput.trim();
    if (!node.tags.includes(tag)) {
      onUpdateNode({ ...node, tags: [...node.tags, tag] });
    }
    setNewTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onUpdateNode({
      ...node,
      tags: node.tags.filter((t) => t !== tagToRemove),
    });
  };

  const handleAddInsight = () => {
    if (!newInsightInput.trim()) return;
    onUpdateNode({
      ...node,
      keyInsights: [...node.keyInsights, newInsightInput.trim()],
    });
    setNewInsightInput('');
  };

  const handleRemoveInsight = (index: number) => {
    onUpdateNode({
      ...node,
      keyInsights: node.keyInsights.filter((_, i) => i !== index),
    });
  };

  const handleCreateConnection = () => {
    if (!targetPaperSelect) return;
    onCreateEdge(node.id, targetPaperSelect, relationSelect);
    setTargetPaperSelect('');
  };

  const getStatusBadge = (status: PaperStatus) => {
    switch (status) {
      case 'seminal':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
            <Award className="w-3 h-3 mr-1" /> Seminal Paper
          </span>
        );
      case 'read':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Read
          </span>
        );
      case 'reading':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 border border-blue-300">
            <Clock className="w-3 h-3 mr-1" /> In Progress
          </span>
        );
      case 'to-read':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-300">
            <Bookmark className="w-3 h-3 mr-1" /> To Read
          </span>
        );
    }
  };

  return (
    <aside
      id="paper-inspector-panel"
      className="w-96 h-full bg-white border-l border-slate-200 shadow-xl flex flex-col z-20 overflow-hidden animate-in slide-in-from-right duration-200"
    >
      {/* Top Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
        <div className="flex items-center space-x-2 min-w-0">
          <div
            className="w-3.5 h-3.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: node.color }}
          />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Research Node Inspector
          </span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            id="inspector-toggle-edit"
            onClick={() => setIsEditing(!isEditing)}
            className={`p-1.5 rounded-md text-xs font-medium transition-colors flex items-center space-x-1 ${
              isEditing ? 'bg-blue-100 text-blue-800' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{isEditing ? 'Done' : 'Edit'}</span>
          </button>
          <button
            id="inspector-close-btn"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Scroll Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Title & Metadata */}
        <div>
          {isEditing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Paper Title
                </label>
                <textarea
                  value={node.title}
                  onChange={(e) => onUpdateNode({ ...node, title: e.target.value })}
                  rows={2}
                  className="w-full text-xs font-semibold p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Authors
                  </label>
                  <input
                    type="text"
                    value={node.authors}
                    onChange={(e) => onUpdateNode({ ...node, authors: e.target.value })}
                    className="w-full text-xs p-1.5 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Year
                  </label>
                  <input
                    type="text"
                    value={node.year}
                    onChange={(e) => onUpdateNode({ ...node, year: e.target.value })}
                    className="w-full text-xs p-1.5 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Venue / Conf
                  </label>
                  <input
                    type="text"
                    value={node.venue}
                    onChange={(e) => onUpdateNode({ ...node, venue: e.target.value })}
                    className="w-full text-xs p-1.5 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    ArXiv ID
                  </label>
                  <input
                    type="text"
                    value={node.arxivId || ''}
                    placeholder="e.g. 1706.03762"
                    onChange={(e) => onUpdateNode({ ...node, arxivId: e.target.value })}
                    className="w-full text-xs p-1.5 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-bold text-slate-900 leading-snug">{node.title}</h2>
              </div>
              <p className="text-xs text-slate-600 mt-1 font-medium">{node.authors}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-slate-500">
                <span className="flex items-center">
                  <Calendar className="w-3.5 h-3.5 mr-1 text-slate-400" />
                  {node.year}
                </span>
                <span>•</span>
                <span className="font-medium text-slate-700">{node.venue}</span>
                {node.citationsCount ? (
                  <>
                    <span>•</span>
                    <span className="text-indigo-600 font-semibold">
                      {node.citationsCount.toLocaleString()} citations
                    </span>
                  </>
                ) : null}
              </div>

              {node.arxivId && (
                <div className="mt-2.5">
                  <a
                    href={`https://arxiv.org/abs/${node.arxivId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center text-xs text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded transition-colors"
                  >
                    <span>arXiv:{node.arxivId}</span>
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status & Accent Color */}
        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700">Reading Status</span>
            {isEditing ? (
              <select
                value={node.status}
                onChange={(e) => onUpdateNode({ ...node, status: e.target.value as PaperStatus })}
                className="text-xs border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="seminal">Seminal Paper</option>
                <option value="read">Read</option>
                <option value="reading">In Progress</option>
                <option value="to-read">To Read</option>
              </select>
            ) : (
              getStatusBadge(node.status)
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
            <span className="text-xs font-medium text-slate-700">Card Theme Color</span>
            <div className="flex items-center space-x-1.5">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  title={c.label}
                  onClick={() => onUpdateNode({ ...node, color: c.value })}
                  style={{ backgroundColor: c.value }}
                  className={`w-4 h-4 rounded-full transition-transform ${
                    node.color === c.value ? 'ring-2 ring-offset-1 ring-slate-800 scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Abstract */}
        <div>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-1.5 flex items-center">
            <BookOpen className="w-3.5 h-3.5 mr-1 text-slate-500" />
            Abstract / Executive Summary
          </h3>
          {isEditing ? (
            <textarea
              value={node.abstract}
              onChange={(e) => onUpdateNode({ ...node, abstract: e.target.value })}
              rows={4}
              className="w-full text-xs text-slate-700 p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 leading-relaxed"
            />
          ) : (
            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50/60 p-2.5 rounded-lg border border-slate-100">
              {node.abstract || 'No abstract provided.'}
            </p>
          )}
        </div>

        {/* Key Insights & Contributions */}
        <div>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center">
            <Award className="w-3.5 h-3.5 mr-1 text-amber-500" />
            Core Insights & Contributions
          </h3>
          <ul className="space-y-1.5">
            {node.keyInsights.map((insight, idx) => (
              <li
                key={idx}
                className="text-xs text-slate-700 bg-amber-50/60 border border-amber-200/70 rounded-md p-2 flex items-start justify-between gap-1 group"
              >
                <span className="flex-1 leading-normal">• {insight}</span>
                {isEditing && (
                  <button
                    onClick={() => handleRemoveInsight(idx)}
                    className="text-slate-400 hover:text-red-600 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-2 flex items-center space-x-1">
            <input
              type="text"
              placeholder="Add key finding or insight..."
              value={newInsightInput}
              onChange={(e) => setNewInsightInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddInsight();
              }}
              className="flex-1 text-xs px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
            <button
              onClick={handleAddInsight}
              className="px-2 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-md text-xs font-medium"
            >
              Add
            </button>
          </div>
        </div>

        {/* Tags */}
        <div>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-1.5 flex items-center">
            <Tag className="w-3.5 h-3.5 mr-1 text-slate-500" />
            Tags & Research Domains
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {node.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200"
              >
                #{tag}
                {isEditing && (
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="ml-1 text-slate-400 hover:text-red-500"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </span>
            ))}
          </div>

          <div className="mt-2 flex items-center space-x-1">
            <input
              type="text"
              placeholder="Add tag (e.g. LLM, Vision)..."
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddTag();
              }}
              className="flex-1 text-xs px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleAddTag}
              className="px-2 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-md text-xs font-medium"
            >
              + Tag
            </button>
          </div>
        </div>

        {/* Dynamic Graph Relationships / Edges */}
        <div className="pt-3 border-t border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center">
              <GitBranch className="w-3.5 h-3.5 mr-1 text-blue-600" />
              Graph Relationships ({outgoingEdges.length + incomingEdges.length})
            </h3>
          </div>

          {/* Outgoing edges */}
          {outgoingEdges.length > 0 && (
            <div className="mb-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Outgoing Connections (From this paper)
              </p>
              {outgoingEdges.map((edge) => {
                const targetNode = allNodes.find((n) => n.id === edge.targetNodeId);
                if (!targetNode) return null;
                return (
                  <div
                    key={edge.id}
                    className="p-2 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs"
                  >
                    <div className="min-w-0 flex-1 mr-2">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-semibold text-blue-700 capitalize text-[11px]">
                          {edge.label || edge.relationType}
                        </span>
                        <ArrowRight className="w-3 h-3 text-slate-400" />
                      </div>
                      <button
                        onClick={() => onFocusNode(targetNode.id)}
                        className="text-slate-800 font-medium hover:text-blue-600 text-left truncate block mt-0.5"
                      >
                        {targetNode.title}
                      </button>
                    </div>
                    <button
                      onClick={() => onDeleteEdge(edge.id)}
                      className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
                      title="Remove Relationship"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Incoming edges */}
          {incomingEdges.length > 0 && (
            <div className="mb-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Incoming Connections (Referencing this paper)
              </p>
              {incomingEdges.map((edge) => {
                const sourceNode = allNodes.find((n) => n.id === edge.sourceNodeId);
                if (!sourceNode) return null;
                return (
                  <div
                    key={edge.id}
                    className="p-2 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs"
                  >
                    <div className="min-w-0 flex-1 mr-2">
                      <div className="flex items-center space-x-1.5">
                        <button
                          onClick={() => onFocusNode(sourceNode.id)}
                          className="text-slate-800 font-medium hover:text-blue-600 text-left truncate"
                        >
                          {sourceNode.title}
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500 capitalize mt-0.5">
                        rel: <span className="font-medium text-slate-700">{edge.label || edge.relationType}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => onDeleteEdge(edge.id)}
                      className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
                      title="Remove Relationship"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Connect to another paper UI */}
          {availableTargets.length > 0 && (
            <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-lg space-y-2 mt-2">
              <p className="text-xs font-semibold text-blue-900 flex items-center">
                <LinkIcon className="w-3 h-3 mr-1 text-blue-600" />
                Connect to Existing Node
              </p>
              <select
                value={targetPaperSelect}
                onChange={(e) => setTargetPaperSelect(e.target.value)}
                className="w-full text-xs p-1.5 bg-white border border-blue-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select paper to connect...</option>
                {availableTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.title} ({target.year})
                  </option>
                ))}
              </select>

              <select
                value={relationSelect}
                onChange={(e) => setRelationSelect(e.target.value as RelationType)}
                className="w-full text-xs p-1.5 bg-white border border-blue-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {RELATION_TYPES.map((r) => (
                  <option key={r.type} value={r.type}>
                    {r.label}
                  </option>
                ))}
              </select>

              <button
                disabled={!targetPaperSelect}
                onClick={handleCreateConnection}
                className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs font-medium transition-colors shadow-2xs"
              >
                Create Edge Connection
              </button>
            </div>
          )}

          {/* Quick Add Connected Paper button */}
          <div className="mt-3">
            <button
              onClick={() => onAddConnectedPaper(node.id)}
              className="w-full py-2 border border-dashed border-slate-300 hover:border-blue-400 bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 rounded-lg text-xs font-medium transition-colors flex items-center justify-center space-x-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Connected Paper Node</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Danger Action */}
      <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
        <button
          onClick={() => {
            if (window.confirm(`Delete "${node.title}" from this whiteboard?`)) {
              onDeleteNode(node.id);
            }
          }}
          className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 px-2 py-1.5 rounded transition-colors flex items-center space-x-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete Node</span>
        </button>
        <span className="text-[11px] text-slate-400 font-mono">
          ({Math.round(node.x)}, {Math.round(node.y)})
        </span>
      </div>
    </aside>
  );
};
