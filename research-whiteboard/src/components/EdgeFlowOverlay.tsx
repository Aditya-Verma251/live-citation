import React, { useState } from 'react';
import { ArrowRight, ArrowLeft, X, MousePointerClick } from 'lucide-react';
import type { PaperEdge, PaperNode, RelationType } from '../types';
import { RELATION_LABELS, edgeProblem, inferRelationType } from '../utils/graphOps';
import { getArrowLook } from '../utils/excalidrawAdapter';
import type { EdgeFlowState } from '../utils/edgeFlow';

interface EdgeFlowOverlayProps {
  flow: EdgeFlowState;
  nodes: PaperNode[];
  edges: PaperEdge[];
  onBack: () => void;
  onCancel: () => void;
  /** Step 3 result. `label` is only set when the user typed a custom one. */
  onChooseRelation: (relationType: RelationType, label?: string) => void;
}

const RELATION_ORDER: Exclude<RelationType, 'custom'>[] = [
  'cites',
  'extends',
  'improves',
  'contradicts',
  'benchmarks',
  'theoretical-foundation',
];

const colorOf = (relationType: RelationType) =>
  getArrowLook({ id: '', sourceNodeId: '', targetNodeId: '', relationType }).strokeColor;

const StepDots: React.FC<{ current: 1 | 2 | 3 }> = ({ current }) => (
  <div className="flex items-center gap-1" aria-hidden>
    {[1, 2, 3].map((n) => (
      <span
        key={n}
        className={`h-1.5 rounded-full transition-all ${
          n === current ? 'w-5 bg-indigo-600' : n < current ? 'w-1.5 bg-indigo-300' : 'w-1.5 bg-slate-200'
        }`}
      />
    ))}
  </div>
);

export const EdgeFlowOverlay: React.FC<EdgeFlowOverlayProps> = ({
  flow,
  nodes,
  edges,
  onBack,
  onCancel,
  onChooseRelation,
}) => {
  const [customLabel, setCustomLabel] = useState('');
  if (flow.step === 'idle') return null;

  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;

  const step: 1 | 2 | 3 = flow.step === 'pick-source' ? 1 : flow.step === 'pick-target' ? 2 : 3;
  const heading =
    step === 1 ? 'Click the source node' : step === 2 ? 'Click the destination node' : 'Choose the relationship';

  return (
    <div
      role="dialog"
      aria-label="Add edge"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-[min(460px,calc(100%-24px))] rounded-xl border border-indigo-200 bg-white shadow-xl"
    >
      {/* header */}
      <div className="flex items-center justify-between gap-3 px-3.5 pt-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-600">
            <span>Step {step} of 3</span>
            <StepDots current={step} />
          </div>
          <h3 className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-slate-900">
            {step < 3 && <MousePointerClick size={14} className="text-indigo-600" />}
            {heading}
          </h3>
        </div>
        <button
          onClick={onCancel}
          aria-label="Cancel adding edge"
          title="Cancel (Esc)"
          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
        >
          <X size={15} />
        </button>
      </div>

      {/* body */}
      <div className="px-3.5 pb-3 pt-2 space-y-2">
        {flow.step === 'pick-source' && (
          <p className="text-xs text-slate-500">The arrow will start at this paper. Press Esc to cancel.</p>
        )}

        {flow.step === 'pick-target' && (
          <>
            <p className="text-xs text-slate-500">
              From <span className="font-semibold text-slate-800">{titleOf(flow.sourceId)}</span> to…
            </p>
            {flow.error && <p className="text-xs text-amber-600">{flow.error}</p>}
          </>
        )}

        {flow.step === 'pick-type' && (
          <>
            <p className="flex items-center gap-1.5 text-xs text-slate-600 min-w-0">
              <span className="truncate font-semibold text-slate-800" title={titleOf(flow.sourceId)}>
                {titleOf(flow.sourceId)}
              </span>
              <ArrowRight size={12} className="shrink-0 text-slate-400" />
              <span className="truncate font-semibold text-slate-800" title={titleOf(flow.targetId)}>
                {titleOf(flow.targetId)}
              </span>
            </p>

            <div className="grid grid-cols-2 gap-1.5">
              {RELATION_ORDER.map((type) => {
                const taken = edgeProblem(
                  { nodes, edges },
                  flow.sourceId,
                  flow.targetId,
                  RELATION_LABELS[type]
                );
                return (
                  <button
                    key={type}
                    disabled={!!taken}
                    title={taken ?? undefined}
                    onClick={() => onChooseRelation(type)}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-slate-200"
                  >
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: colorOf(type) }} />
                    {RELATION_LABELS[type]}
                  </button>
                );
              })}
            </div>

            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const label = customLabel.trim();
                if (!label) return;
                onChooseRelation(inferRelationType(label), label);
                setCustomLabel('');
              }}
            >
              <input
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="…or type a custom label"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={!customLabel.trim()}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </form>
          </>
        )}

        {step > 1 && (
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft size={11} /> Back
          </button>
        )}
      </div>
    </div>
  );
};
