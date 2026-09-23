import React, { useState } from 'react';
import { X, BookOpen, Sparkles, Plus, Award } from 'lucide-react';
import { ResearchPaperNode, PaperStatus } from '../types';

interface AddPaperModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddPaper: (paper: Omit<ResearchPaperNode, 'id' | 'x' | 'y'>) => void;
}

const TEMPLATE_PAPERS = [
  {
    title: 'Attention Is All You Need',
    authors: 'Vaswani et al.',
    year: 2017,
    venue: 'NeurIPS',
    arxivId: '1706.03762',
    color: '#4f46e5',
    tags: ['Transformer', 'Attention', 'Seminal'],
    abstract: 'Replaces recurrence and convolutions entirely with multi-head self-attention mechanisms.',
    keyInsights: ['Multi-Head Attention', 'Positional Encoding', 'Transformer Architecture'],
    status: 'seminal' as PaperStatus,
  },
  {
    title: 'Deep Residual Learning for Image Recognition (ResNet)',
    authors: 'He, Zhang, Ren, Sun',
    year: 2015,
    venue: 'CVPR',
    arxivId: '1512.03385',
    color: '#0284c7',
    tags: ['ResNet', 'Vision', 'Skip-Connections'],
    abstract: 'Presents residual learning framework to ease training of networks substantially deeper than previously used.',
    keyInsights: ['Identity shortcut mapping', 'Overcomes degradation problem in 100+ layer nets'],
    status: 'seminal' as PaperStatus,
  },
  {
    title: 'LoRA: Low-Rank Adaptation of Large Language Models',
    authors: 'Hu et al. (Microsoft)',
    year: 2021,
    venue: 'ICLR 2022',
    arxivId: '2106.09685',
    color: '#059669',
    tags: ['PEFT', 'LoRA', 'Efficiency'],
    abstract: 'Freezes pre-trained model weights and injects trainable rank decomposition matrices into each layer.',
    keyInsights: ['Low-rank intrinsic rank hypothesis', 'Drastic parameter reduction (10,000x fewer)'],
    status: 'read' as PaperStatus,
  },
  {
    title: 'Constitutional AI: Harmlessness from AI Feedback',
    authors: 'Bai et al. (Anthropic)',
    year: 2022,
    venue: 'arXiv',
    arxivId: '2212.08073',
    color: '#9333ea',
    tags: ['RLAIF', 'Alignment', 'Safety'],
    abstract: 'Train harmless AI assistant through self-improvement without human feedback on harms.',
    keyInsights: ['RL from AI Feedback (RLAIF)', 'Constitution-guided self-critique'],
    status: 'reading' as PaperStatus,
  },
];

export const AddPaperModal: React.FC<AddPaperModalProps> = ({
  isOpen,
  onClose,
  onAddPaper,
}) => {
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [venue, setVenue] = useState('arXiv');
  const [arxivId, setArxivId] = useState('');
  const [abstract, setAbstract] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [color, setColor] = useState('#4f46e5');
  const [status, setStatus] = useState<PaperStatus>('reading');
  const [insight1, setInsight1] = useState('');
  const [insight2, setInsight2] = useState('');

  if (!isOpen) return null;

  const handleSelectTemplate = (tmpl: typeof TEMPLATE_PAPERS[0]) => {
    setTitle(tmpl.title);
    setAuthors(tmpl.authors);
    setYear(String(tmpl.year));
    setVenue(tmpl.venue);
    setArxivId(tmpl.arxivId || '');
    setAbstract(tmpl.abstract);
    setColor(tmpl.color);
    setTagsInput(tmpl.tags.join(', '));
    setStatus(tmpl.status);
    setInsight1(tmpl.keyInsights[0] || '');
    setInsight2(tmpl.keyInsights[1] || '');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const keyInsights = [insight1.trim(), insight2.trim()].filter(Boolean);

    onAddPaper({
      title: title.trim(),
      authors: authors.trim() || 'Anonymous',
      year: parseInt(year) || new Date().getFullYear(),
      venue: venue.trim() || 'arXiv',
      arxivId: arxivId.trim() || undefined,
      abstract: abstract.trim() || 'Custom research paper added to graph whiteboard.',
      keyInsights: keyInsights.length > 0 ? keyInsights : ['Custom paper node contribution.'],
      tags: tags.length > 0 ? tags : ['Research'],
      citationsCount: 0,
      status,
      color,
      width: 320,
      height: 200,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Add Research Paper Node</h2>
              <p className="text-xs text-slate-500">Insert interactive paper graph card onto whiteboard</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Templates quick pick */}
        <div className="p-3 bg-indigo-50/60 border-b border-indigo-100">
          <p className="text-[11px] font-semibold text-indigo-900 mb-1.5 flex items-center">
            <Sparkles className="w-3 h-3 mr-1 text-indigo-600" />
            Or autofill with a seminal paper template:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_PAPERS.map((tmpl) => (
              <button
                key={tmpl.title}
                type="button"
                onClick={() => handleSelectTemplate(tmpl)}
                className="px-2 py-1 bg-white hover:bg-indigo-100/80 border border-indigo-200 text-indigo-800 rounded-md text-[11px] font-medium transition-colors text-left"
              >
                {tmpl.title.split(':')[0]} ({tmpl.year})
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 max-h-[65vh] overflow-y-auto">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Paper Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Attention Is All You Need"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-xs p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Authors</label>
              <input
                type="text"
                placeholder="Vaswani et al."
                value={authors}
                onChange={(e) => setAuthors(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Year</label>
              <input
                type="text"
                placeholder="2023"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Venue / Conf</label>
              <input
                type="text"
                placeholder="NeurIPS"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">ArXiv ID (Optional)</label>
              <input
                type="text"
                placeholder="1706.03762"
                value={arxivId}
                onChange={(e) => setArxivId(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as PaperStatus)}
                className="w-full text-xs p-2 border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="seminal">Seminal Paper</option>
                <option value="read">Read</option>
                <option value="reading">Reading</option>
                <option value="to-read">To Read</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Abstract / Key Idea</label>
            <textarea
              rows={2}
              placeholder="Summary of novel methodology, core theorem, or benchmark breakthroughs..."
              value={abstract}
              onChange={(e) => setAbstract(e.target.value)}
              className="w-full text-xs p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">Key Contributions (Bullets)</label>
            <input
              type="text"
              placeholder="Contribution 1: e.g. Replaces recurrence with O(N²) self-attention"
              value={insight1}
              onChange={(e) => setInsight1(e.target.value)}
              className="w-full text-xs p-1.5 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder="Contribution 2: e.g. Pre-trained representations transfer across GLUE"
              value={insight2}
              onChange={(e) => setInsight2(e.target.value)}
              className="w-full text-xs p-1.5 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tags (comma separated)
              </label>
              <input
                type="text"
                placeholder="Transformers, Attention, NLP"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Theme Color</label>
              <div className="flex items-center space-x-2 mt-1">
                {['#4f46e5', '#0284c7', '#059669', '#d97706', '#9333ea', '#e11d48'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{ backgroundColor: c }}
                    className={`w-6 h-6 rounded-full transition-all ${
                      color === c ? 'ring-2 ring-offset-2 ring-slate-800 scale-110' : 'opacity-80 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-slate-300 hover:bg-slate-100 rounded-md text-xs font-medium text-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-semibold shadow-sm transition-colors flex items-center space-x-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Insert Onto Whiteboard</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
