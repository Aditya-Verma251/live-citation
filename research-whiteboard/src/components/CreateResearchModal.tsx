import React, { useState } from 'react';
import { FileText, Search, X, Sparkles, Loader2 } from 'lucide-react';
import type { ResearchInput, ResearchInputMode } from '../services/researchApi';

interface CreateResearchModalProps {
  isOpen: boolean;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: ResearchInput) => void;
}

export const CreateResearchModal: React.FC<CreateResearchModalProps> = ({
  isOpen,
  isSubmitting,
  error,
  onClose,
  onCreate,
}) => {
  const [mode, setMode] = useState<ResearchInputMode>('keyword');
  const [value, setValue] = useState('');

  if (!isOpen) return null;

  const placeholder = mode === 'keyword'
    ? 'e.g. Retrieval-Augmented Generation'
    : 'Paste a paper title, DOI, arXiv ID/URL, OpenAlex ID/URL, or PMID/PubMed URL';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim() || isSubmitting) return;
    onCreate({ mode, value: value.trim() });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(e) => {
      if (e.target === e.currentTarget && !isSubmitting) onClose();
    }}>
      <form onSubmit={submit} className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Create research dashboard</h2>
            <p className="mt-1 text-sm text-slate-500">Start from a topic or identify a specific research paper.</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} aria-label="Close" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setMode('keyword')} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${mode === 'keyword' ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${mode === 'keyword' ? 'bg-white' : 'bg-slate-100'}`}><Search className="h-4 w-4" /></span>
              <span><span className="block text-sm font-semibold">Keyword</span><span className="mt-0.5 block text-xs opacity-70">Explore a topic</span></span>
            </button>
            <button type="button" onClick={() => setMode('paper')} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${mode === 'paper' ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${mode === 'paper' ? 'bg-white' : 'bg-slate-100'}`}><FileText className="h-4 w-4" /></span>
              <span><span className="block text-sm font-semibold">Research paper</span><span className="mt-0.5 block text-xs opacity-70">Resolve a title or paper identifier</span></span>
            </button>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">{mode === 'keyword' ? 'Research keyword' : 'Paper reference'}</span>
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              disabled={isSubmitting}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50"
            />
          </label>

          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200/70 disabled:opacity-40">Cancel</button>
          <button type="submit" disabled={!value.trim() || isSubmitting} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
            {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Building dashboard…</> : <><Sparkles className="h-4 w-4" /> Create dashboard</>}
          </button>
        </div>
      </form>
    </div>
  );
};
