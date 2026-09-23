import React, { useState } from 'react';
import {
  ExternalLink,
  Info,
  Pin,
  PinOff,
  Award,
  BookOpen,
  GripHorizontal,
  ChevronDown,
} from 'lucide-react';
import { ResearchPaperNode, PaperStatus } from '../types';

interface ResearchPaperCardProps {
  node: ResearchPaperNode;
  isSelected: boolean;
  isConnectingSource: boolean;
  isConnectingTarget: boolean;
  zoom: number;
  onSelect: (nodeId: string, e: React.MouseEvent) => void;
  onOpenInspector: (nodeId: string, e: React.MouseEvent) => void;
  onStartDrag: (nodeId: string, e: React.MouseEvent) => void;
  onStartConnect: (nodeId: string, port: 'top' | 'bottom' | 'left' | 'right', e: React.MouseEvent) => void;
  onConnectDrop: (nodeId: string) => void;
}

export const ResearchPaperCard: React.FC<ResearchPaperCardProps> = ({
  node,
  isSelected,
  isConnectingSource,
  isConnectingTarget,
  zoom,
  onSelect,
  onOpenInspector,
  onStartDrag,
  onStartConnect,
  onConnectDrop,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  // Card is toggleable on hover or pinned open
  const isCardOpen = isHovered || isPinned;

  const getStatusBadge = (status: PaperStatus) => {
    switch (status) {
      case 'seminal':
        return (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 flex items-center shadow-2xs">
            <Award className="w-2.5 h-2.5 mr-0.5" /> Seminal
          </span>
        );
      case 'read':
        return (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
            Read
          </span>
        );
      case 'reading':
        return (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300">
            Reading
          </span>
        );
      case 'to-read':
        return (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300">
            To Read
          </span>
        );
    }
  };

  return (
    <div
      id={`paper-node-container-${node.id}`}
      style={{
        transform: `translate(${node.x}px, ${node.y}px)`,
        width: '210px',
        height: '38px',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseUp={() => onConnectDrop(node.id)}
      onClick={(e) => onSelect(node.id, e)}
      className={`absolute top-0 left-0 select-none ${
        isCardOpen ? 'z-40' : isSelected ? 'z-20' : 'z-10'
      }`}
    >
      {/* 1. Point Size with Label (Default Rest State) */}
      <div
        id={`paper-point-pill-${node.id}`}
        onMouseDown={(e) => onStartDrag(node.id, e)}
        className={`w-[210px] h-[38px] bg-white rounded-full flex items-center px-2 py-1 cursor-grab active:cursor-grabbing border transition-all duration-150 shadow-xs ${
          isSelected
            ? 'ring-2 ring-blue-600 border-blue-600 shadow-md'
            : isConnectingTarget
            ? 'ring-2 ring-emerald-500 border-emerald-500 scale-105 shadow-lg'
            : isConnectingSource
            ? 'ring-2 ring-indigo-400 border-indigo-400 opacity-90'
            : 'border-slate-200/90 hover:border-slate-300 hover:shadow-sm'
        }`}
        style={{
          borderLeft: `4px solid ${node.color}`,
        }}
      >
        {/* Point Size Indicator Dot */}
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mr-1.5 border"
          style={{
            backgroundColor: `${node.color}15`,
            borderColor: `${node.color}50`,
          }}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: node.color }}
          />
        </div>

        {/* Paper Title Label */}
        <span
          className="text-xs font-semibold text-slate-800 truncate flex-1 min-w-0"
          title={node.title}
        >
          {node.title}
        </span>

        {/* Year tag & Expand Indicator */}
        <div className="flex items-center space-x-1 ml-1 flex-shrink-0">
          <span className="font-mono text-[10px] text-slate-400 font-medium">
            {typeof node.year === 'number' ? `'${String(node.year).slice(-2)}` : node.year}
          </span>
          <ChevronDown
            className={`w-3 h-3 text-slate-400 transition-transform duration-150 ${
              isCardOpen ? 'rotate-180 text-blue-600' : ''
            }`}
          />
        </div>
      </div>

      {/* 2. Toggleable Card Showcase (Pops out when hovered or pinned open) */}
      {isCardOpen && (
        <div
          id={`paper-card-showcase-${node.id}`}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-[42px] left-0 w-[310px] bg-white rounded-xl shadow-2xl border border-slate-200/90 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Top Drag Handle & Controls */}
          <div
            onMouseDown={(e) => onStartDrag(node.id, e)}
            className="px-3 pt-2 pb-1.5 cursor-grab active:cursor-grabbing flex items-center justify-between border-b border-slate-100"
            style={{
              background: `linear-gradient(to right, ${node.color}12, #ffffff)`,
              borderTop: `3px solid ${node.color}`,
            }}
          >
            <div className="flex items-center space-x-1.5 min-w-0">
              <GripHorizontal className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: node.color }}
              />
              <span className="text-[10px] font-mono text-slate-500 truncate">
                {node.venue}
              </span>
            </div>

            <div className="flex items-center space-x-1 flex-shrink-0">
              {getStatusBadge(node.status)}

              {/* Pin / Toggle Card Button */}
              <button
                id={`btn-pin-${node.id}`}
                title={isPinned ? 'Unpin card' : 'Pin card open'}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPinned(!isPinned);
                }}
                className={`p-1 rounded transition-colors ${
                  isPinned
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                {isPinned ? <Pin className="w-3 h-3 fill-current" /> : <PinOff className="w-3 h-3" />}
              </button>

              {/* Inspect Details Button */}
              <button
                id={`btn-info-${node.id}`}
                title="Inspect Paper Details"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInspector(node.id, e);
                }}
                className="p-1 hover:bg-slate-200/80 rounded text-slate-500 hover:text-slate-800 transition-colors"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Card Body */}
          <div className="p-3">
            {/* Full Title */}
            <h3
              className="text-xs font-bold text-slate-900 leading-snug hover:text-blue-700 transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onOpenInspector(node.id, e);
              }}
            >
              {node.title}
            </h3>

            {/* Authors and Year */}
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span className="truncate max-w-[200px]">{node.authors}</span>
              <span className="font-mono text-slate-400 font-medium ml-1 flex-shrink-0">
                {node.year}
              </span>
            </div>

            {/* Abstract or Key Insight snippet */}
            {node.keyInsights && node.keyInsights.length > 0 ? (
              <div className="mt-2 text-[10px] text-slate-600 bg-slate-50 border border-slate-100 rounded p-1.5 line-clamp-2 leading-tight">
                <span className="font-semibold text-slate-700">• </span>
                {node.keyInsights[0]}
              </div>
            ) : (
              <p className="mt-2 text-[10px] text-slate-500 line-clamp-2 leading-tight">
                {node.abstract}
              </p>
            )}

            {/* Tags & arXiv Footer */}
            <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
              <div className="flex flex-wrap gap-1 max-w-[210px] overflow-hidden max-h-5">
                {node.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.2 rounded bg-slate-100 text-[9px] text-slate-600 font-medium truncate"
                  >
                    #{tag}
                  </span>
                ))}
                {node.tags.length > 3 && (
                  <span className="text-[9px] text-slate-400">+{node.tags.length - 3}</span>
                )}
              </div>

              {node.arxivId && (
                <a
                  href={`https://arxiv.org/abs/${node.arxivId}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] font-mono text-indigo-600 hover:text-indigo-800 flex items-center space-x-0.5 hover:underline"
                  title="Open in arXiv"
                >
                  <span>arXiv</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. Four Interactive Connection Ports (Top, Bottom, Left, Right) */}
      {/* Top Handle */}
      <div
        id={`port-top-${node.id}`}
        title="Drag to connect"
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartConnect(node.id, 'top', e);
        }}
        className={`absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-blue-500 shadow-xs flex items-center justify-center cursor-crosshair transition-all ${
          isCardOpen || isSelected || isConnectingSource
            ? 'opacity-100 scale-100'
            : 'opacity-0 scale-75'
        } hover:scale-125 hover:bg-blue-50 hover:border-blue-600 z-50`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
      </div>

      {/* Bottom Handle */}
      <div
        id={`port-bottom-${node.id}`}
        title="Drag to connect"
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartConnect(node.id, 'bottom', e);
        }}
        className={`absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-blue-500 shadow-xs flex items-center justify-center cursor-crosshair transition-all ${
          isCardOpen || isSelected || isConnectingSource
            ? 'opacity-100 scale-100'
            : 'opacity-0 scale-75'
        } hover:scale-125 hover:bg-blue-50 hover:border-blue-600 z-50`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
      </div>

      {/* Left Handle */}
      <div
        id={`port-left-${node.id}`}
        title="Drag to connect"
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartConnect(node.id, 'left', e);
        }}
        className={`absolute top-1/2 -left-2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-blue-500 shadow-xs flex items-center justify-center cursor-crosshair transition-all ${
          isCardOpen || isSelected || isConnectingSource
            ? 'opacity-100 scale-100'
            : 'opacity-0 scale-75'
        } hover:scale-125 hover:bg-blue-50 hover:border-blue-600 z-50`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
      </div>

      {/* Right Handle */}
      <div
        id={`port-right-${node.id}`}
        title="Drag to connect"
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartConnect(node.id, 'right', e);
        }}
        className={`absolute top-1/2 -right-2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-blue-500 shadow-xs flex items-center justify-center cursor-crosshair transition-all ${
          isCardOpen || isSelected || isConnectingSource
            ? 'opacity-100 scale-100'
            : 'opacity-0 scale-75'
        } hover:scale-125 hover:bg-blue-50 hover:border-blue-600 z-50`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
      </div>
    </div>
  );
};
