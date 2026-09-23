import React from 'react';
import { X, GitBranch, Trash2, Check } from 'lucide-react';
import { ResearchPaperEdge, RelationType, ResearchPaperNode } from '../types';

interface EdgeEditorModalProps {
  edge: ResearchPaperEdge | null;
  sourceNode?: ResearchPaperNode;
  targetNode?: ResearchPaperNode;
  onUpdateEdge: (updated: ResearchPaperEdge) => void;
  onDeleteEdge: (edgeId: string) => void;
  onClose: () => void;
}

const RELATION_CHOICES: { type: RelationType; label: string }[] = [
  { type: 'extends', label: 'Extends / Builds Upon' },
  { type: 'improves', label: 'Improves / Optimizes Efficiency' },
  { type: 'cites', label: 'Cites / General Reference' },
  { type: 'theoretical-foundation', label: 'Theoretical Foundation' },
  { type: 'benchmarks', label: 'Benchmarks Against' },
  { type: 'contradicts', label: 'Contradicts / Challenges' },
];

export const EdgeEditorModal: React.FC<EdgeEditorModalProps> = ({
  edge,
  sourceNode,
  targetNode,
  onUpdateEdge,
  onDeleteEdge,
  onClose,
}) => {
  if (!edge) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-2xs p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-md bg-blue-600 text-white flex items-center justify-center shadow-2xs">
              <GitBranch className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900">Edit Relationship Edge</h3>
              <p className="text-[10px] text-slate-500">Research relationship between nodes</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3.5 text-xs">
          {/* Source and Target context */}
          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-slate-700 space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">From:</span>
              <span className="font-semibold text-slate-800 truncate max-w-[200px]">
                {sourceNode?.title || 'Source'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">To:</span>
              <span className="font-semibold text-slate-800 truncate max-w-[200px]">
                {targetNode?.title || 'Target'}
              </span>
            </div>
          </div>

          {/* Relation Type */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Relationship Type
            </label>
            <div className="space-y-1">
              {RELATION_CHOICES.map((r) => (
                <button
                  key={r.type}
                  type="button"
                  onClick={() => onUpdateEdge({ ...edge, relationType: r.type, label: r.label })}
                  className={`w-full p-2 text-left rounded-md border flex items-center justify-between transition-colors ${
                    edge.relationType === r.type
                      ? 'border-blue-500 bg-blue-50/70 text-blue-900 font-medium'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <span>{r.label}</span>
                  {edge.relationType === r.type && <Check className="w-3.5 h-3.5 text-blue-600" />}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Label */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Custom Pill Label
            </label>
            <input
              type="text"
              value={edge.label || ''}
              placeholder="e.g. Bidirectional Stack"
              onChange={(e) => onUpdateEdge({ ...edge, label: e.target.value })}
              className="w-full text-xs p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Style Line */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Line Style</label>
              <select
                value={edge.style}
                onChange={(e) =>
                  onUpdateEdge({ ...edge, style: e.target.value as 'solid' | 'dashed' | 'dotted' })
                }
                className="w-full text-xs p-1.5 border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="solid">Solid (Strong)</option>
                <option value="dashed">Dashed (Inferred)</option>
                <option value="dotted">Dotted (Loose)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Color</label>
              <div className="flex items-center space-x-1.5 mt-1">
                {['#4f46e5', '#0284c7', '#059669', '#d97706', '#9333ea', '#e11d48'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onUpdateEdge({ ...edge, color: c })}
                    style={{ backgroundColor: c }}
                    className={`w-5 h-5 rounded-full transition-transform ${
                      edge.color === c ? 'ring-2 ring-offset-1 ring-slate-800 scale-110' : 'opacity-80'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Bottom actions */}
          <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
            <button
              onClick={() => {
                onDeleteEdge(edge.id);
                onClose();
              }}
              className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 px-2 py-1.5 rounded transition-colors flex items-center space-x-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Edge</span>
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-slate-900 text-white hover:bg-slate-800 rounded-md text-xs font-medium"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
