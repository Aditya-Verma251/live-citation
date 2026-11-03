import React from 'react';
import { X } from 'lucide-react';

export interface HoverCardPaper {
  title: string;
  authors: string;
  year?: number | string;
  venue?: string;
  abstract?: string;
}

interface HoverCardProps {
  paper: HoverCardPaper;
  /** Position inside the canvas container, in CSS px (e.g. the click point). */
  left: number;
  top: number;
  /** Container size, used to keep the card inside the canvas. */
  containerWidth: number;
  containerHeight: number;
  /** true = opened by a click (interactive, has buttons); false = transient hover preview. */
  pinned?: boolean;
  onOpenDetails?: () => void;
  onClose?: () => void;
}

const CARD_W = 280;
const CARD_H_GUESS = 170;
const OFFSET = 12;

/** Lightweight HTML card absolutely positioned over the Excalidraw canvas. */
export const HoverCard: React.FC<HoverCardProps> = ({
  paper,
  left,
  top,
  containerWidth,
  containerHeight,
  pinned = false,
  onOpenDetails,
  onClose,
}) => {
  const x = Math.max(8, Math.min(left + OFFSET, containerWidth - CARD_W - 8));
  // Flip above the point when there's no room below.
  const below = top + OFFSET + CARD_H_GUESS < containerHeight;
  const y = below ? top + OFFSET : Math.max(8, top - OFFSET - CARD_H_GUESS);

  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: CARD_W,
        zIndex: 7,
        pointerEvents: pinned ? 'auto' : 'none',
      }}
      className="rounded-lg bg-white border border-slate-200 shadow-lg p-3 text-xs text-slate-600"
    >
      {pinned && onClose && (
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-slate-100 text-slate-400"
        >
          <X size={12} />
        </button>
      )}

      <div className="text-sm font-semibold text-slate-900 leading-snug pr-4">{paper.title}</div>
      <div className="mt-0.5">{paper.authors}</div>
      {(paper.year || paper.venue) && (
        <div className="mt-0.5 text-slate-500">{[paper.year, paper.venue].filter(Boolean).join(' · ')}</div>
      )}
      {paper.abstract && (
        <div className="mt-2 text-slate-500 leading-snug">
          {paper.abstract.length > 150 ? paper.abstract.slice(0, 149).trimEnd() + '…' : paper.abstract}
        </div>
      )}

      {pinned && onOpenDetails ? (
        <button
          onClick={onOpenDetails}
          className="mt-2 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
        >
          Open details →
        </button>
      ) : (
        <div className="mt-2 text-[10px] text-slate-400">Click to pin · double-click to open details</div>
      )}
    </div>
  );
};
