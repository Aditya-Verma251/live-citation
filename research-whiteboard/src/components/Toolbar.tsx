import React, { useState } from 'react';
import {
  MousePointer,
  Hand,
  Square,
  Diamond,
  Circle,
  ArrowUpRight,
  Minus,
  Pencil,
  Type,
  Eraser,
  Sparkles,
  BookOpen,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid,
  Sliders,
  Share2,
  FileDown,
  Layers,
  Wand2,
  Network,
} from 'lucide-react';
import { ToolType, FillStyle } from '../types';

interface ToolbarProps {
  activeTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
  strokeColor: string;
  onChangeStrokeColor: (color: string) => void;
  backgroundColor: string;
  onChangeBackgroundColor: (color: string) => void;
  strokeWidth: number;
  onChangeStrokeWidth: (width: number) => void;
  roughness: number;
  onChangeRoughness: (roughness: number) => void;
  fillStyle: FillStyle;
  onChangeFillStyle: (style: FillStyle) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  gridType: 'dots' | 'grid' | 'none';
  onToggleGrid: () => void;
  onAutoLayout: () => void;
  onOpenAddPaperModal: () => void;
  paperCount: number;
  edgeCount: number;
  isLinkedPapersOpen?: boolean;
  onToggleLinkedPapers?: () => void;
}

const STROKE_COLORS = ['#1e293b', '#e11d48', '#d97706', '#059669', '#0284c7', '#4f46e5', '#9333ea'];
const BG_COLORS = [
  'transparent',
  '#ffffff',
  '#f8fafc',
  '#eff6ff',
  '#f0fdf4',
  '#fffbeb',
  '#faf5ff',
  '#fff1f2',
];

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  onSelectTool,
  strokeColor,
  onChangeStrokeColor,
  backgroundColor,
  onChangeBackgroundColor,
  strokeWidth,
  onChangeStrokeWidth,
  roughness,
  onChangeRoughness,
  fillStyle,
  onChangeFillStyle,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  gridType,
  onToggleGrid,
  onAutoLayout,
  onOpenAddPaperModal,
  paperCount,
  edgeCount,
  isLinkedPapersOpen,
  onToggleLinkedPapers,
}) => {
  const [showPropsPanel, setShowPropsPanel] = useState(false);

  const tools: { type: ToolType; label: string; icon: React.ReactNode; shortcut: string }[] = [
    { type: 'select', label: 'Select', icon: <MousePointer className="w-4 h-4" />, shortcut: 'V' },
    { type: 'hand', label: 'Hand (Pan)', icon: <Hand className="w-4 h-4" />, shortcut: 'H' },
    { type: 'rectangle', label: 'Rectangle', icon: <Square className="w-4 h-4" />, shortcut: 'R' },
    { type: 'diamond', label: 'Diamond', icon: <Diamond className="w-4 h-4" />, shortcut: 'D' },
    { type: 'ellipse', label: 'Ellipse', icon: <Circle className="w-4 h-4" />, shortcut: 'O' },
    { type: 'arrow', label: 'Arrow', icon: <ArrowUpRight className="w-4 h-4" />, shortcut: 'A' },
    { type: 'line', label: 'Line', icon: <Minus className="w-4 h-4" />, shortcut: 'L' },
    { type: 'draw', label: 'Draw', icon: <Pencil className="w-4 h-4" />, shortcut: 'P' },
    { type: 'text', label: 'Text', icon: <Type className="w-4 h-4" />, shortcut: 'T' },
    { type: 'eraser', label: 'Eraser', icon: <Eraser className="w-4 h-4" />, shortcut: 'E' },
  ];

  return (
    <>
      {/* Top Floating Main Tool Bar */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 p-1.5 bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-slate-200/90 select-none">
        {/* Undo / Redo */}
        <div className="flex items-center space-x-0.5 pr-1.5 border-r border-slate-200">
          <button
            id="toolbar-btn-undo"
            title="Undo (Ctrl+Z)"
            disabled={!canUndo}
            onClick={onUndo}
            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 rounded-lg transition-colors"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            id="toolbar-btn-redo"
            title="Redo (Ctrl+Y)"
            disabled={!canRedo}
            onClick={onRedo}
            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 rounded-lg transition-colors"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        {/* Standard Excalidraw Drawing Tools */}
        <div className="flex items-center space-x-1">
          {tools.map((t) => (
            <button
              key={t.type}
              id={`tool-btn-${t.type}`}
              title={`${t.label} (${t.shortcut})`}
              onClick={() => onSelectTool(t.type)}
              className={`p-2 rounded-lg transition-all flex items-center justify-center relative ${
                activeTool === t.type
                  ? 'bg-blue-600 text-white shadow-xs font-semibold'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {t.icon}
              <span className="sr-only">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Custom Research Paper Node Creation Button */}
        <div className="pl-1.5 border-l border-slate-200 flex items-center space-x-1.5">
          <button
            id="btn-insert-paper-node"
            onClick={onOpenAddPaperModal}
            title="Add Research Paper Node"
            className="px-2.5 py-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center space-x-1.5 transition-all"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>+ Paper Node</span>
          </button>

          {/* Auto Layout button */}
          <button
            id="btn-auto-layout-graph"
            onClick={onAutoLayout}
            title="Auto-organize research graph chronologically"
            className="p-2 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Auto-Align</span>
          </button>
        </div>

        {/* Styling properties toggle */}
        <div className="pl-1 border-l border-slate-200">
          <button
            id="toolbar-btn-props-toggle"
            title="Style & Stroke Properties"
            onClick={() => setShowPropsPanel(!showPropsPanel)}
            className={`p-2 rounded-lg transition-colors ${
              showPropsPanel ? 'bg-slate-200 text-slate-900' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Sliders className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Floating Style Properties Drawer */}
      {showPropsPanel && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-white/95 backdrop-blur-md rounded-xl shadow-xl border border-slate-200 p-3 space-y-2.5 select-none animate-in fade-in slide-in-from-top-2 duration-150 w-72">
          {/* Stroke Color */}
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Stroke Color
            </span>
            <div className="flex items-center space-x-1.5">
              {STROKE_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => onChangeStrokeColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-5 h-5 rounded-md transition-transform ${
                    strokeColor === c ? 'ring-2 ring-blue-500 scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Background Color */}
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Background Fill
            </span>
            <div className="flex items-center space-x-1.5">
              {BG_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => onChangeBackgroundColor(c)}
                  style={{ backgroundColor: c === 'transparent' ? '#ffffff' : c }}
                  className={`w-5 h-5 rounded-md border border-slate-300 transition-transform ${
                    backgroundColor === c ? 'ring-2 ring-blue-500 scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                  title={c}
                >
                  {c === 'transparent' && <span className="text-[9px] text-red-500 font-bold">/</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Fill Style */}
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Fill Style
            </span>
            <div className="grid grid-cols-4 gap-1 text-[11px]">
              {(['hachure', 'cross-hatch', 'solid', 'none'] as FillStyle[]).map((style) => (
                <button
                  key={style}
                  onClick={() => onChangeFillStyle(style)}
                  className={`py-1 rounded capitalize border transition-colors ${
                    fillStyle === style
                      ? 'bg-blue-50 border-blue-400 text-blue-700 font-semibold'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {style === 'cross-hatch' ? 'Cross' : style}
                </button>
              ))}
            </div>
          </div>

          {/* Stroke Width */}
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Stroke Width
            </span>
            <div className="grid grid-cols-3 gap-1 text-[11px]">
              {[1, 2, 4].map((w) => (
                <button
                  key={w}
                  onClick={() => onChangeStrokeWidth(w)}
                  className={`py-1 rounded border flex items-center justify-center transition-colors ${
                    strokeWidth === w
                      ? 'bg-blue-50 border-blue-400 text-blue-700 font-semibold'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className="w-4 bg-current rounded"
                    style={{ height: `${w}px` }}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Roughness */}
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Roughness (Sloppiness)
            </span>
            <div className="grid grid-cols-3 gap-1 text-[11px]">
              {[
                { label: 'Clean', val: 0.5 },
                { label: 'Artist', val: 1.4 },
                { label: 'Sketch', val: 2.2 },
              ].map((r) => (
                <button
                  key={r.label}
                  onClick={() => onChangeRoughness(r.val)}
                  className={`py-1 rounded border transition-colors ${
                    Math.abs(roughness - r.val) < 0.2
                      ? 'bg-blue-50 border-blue-400 text-blue-700 font-semibold'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom-Left Zoom & Grid Controls */}
      <div className="absolute bottom-4 left-4 z-20 flex items-center space-x-1.5 p-1 bg-white/90 backdrop-blur-md rounded-xl shadow-md border border-slate-200 text-xs select-none">
        <button
          id="btn-zoom-out"
          onClick={onZoomOut}
          title="Zoom Out"
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>

        <button
          id="btn-reset-zoom"
          onClick={onResetZoom}
          title="Reset Zoom (100%)"
          className="px-2 py-1 text-slate-700 hover:text-slate-900 font-mono text-[11px] font-semibold hover:bg-slate-100 rounded-lg"
        >
          {Math.round(zoom * 100)}%
        </button>

        <button
          id="btn-zoom-in"
          onClick={onZoomIn}
          title="Zoom In"
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-4 bg-slate-200 mx-0.5" />

        <button
          id="btn-toggle-grid"
          onClick={onToggleGrid}
          title={`Toggle Grid (Current: ${gridType})`}
          className={`p-1.5 rounded-lg transition-colors ${
            gridType !== 'none'
              ? 'text-blue-600 bg-blue-50'
              : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Grid className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Bottom-Right Graph Stats Badge & Linked Papers Trigger */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center space-x-2 px-2.5 py-1.5 bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200 text-[11px] text-slate-600 select-none">
        <span className="flex items-center space-x-1 font-medium text-slate-800">
          <BookOpen className="w-3 h-3 text-indigo-600" />
          <span>{paperCount} Papers</span>
        </span>
        <span className="text-slate-300">•</span>
        <span className="flex items-center space-x-1 font-medium text-slate-800">
          <Share2 className="w-3 h-3 text-blue-600" />
          <span>{edgeCount} Edges</span>
        </span>

        {onToggleLinkedPapers && (
          <>
            <span className="text-slate-300">•</span>
            <button
              id="btn-toolbar-toggle-linked"
              onClick={onToggleLinkedPapers}
              title={isLinkedPapersOpen ? 'Hide Linked Papers' : 'Show Linked Papers'}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md font-semibold transition-colors cursor-pointer ${
                isLinkedPapersOpen
                  ? 'bg-indigo-100 text-indigo-800'
                  : 'text-indigo-600 hover:bg-indigo-50'
              }`}
            >
              <Network className="w-3 h-3" />
              <span>Linked Papers</span>
            </button>
          </>
        )}
      </div>
    </>
  );
};
