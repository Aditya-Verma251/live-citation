import React from 'react';
import { X, Keyboard, Sparkles, BookOpen, GitBranch, Layers, Move } from 'lucide-react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Keyboard className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Whiteboard & Research Graph Guide</h2>
              <p className="text-xs text-slate-500">Master tools, node connections, and canvas controls</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto text-xs text-slate-700">
          {/* Key Feature: Research Graph Objects */}
          <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg space-y-1.5">
            <h3 className="font-bold text-indigo-950 flex items-center text-xs">
              <BookOpen className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
              Custom Research Paper Graph Objects
            </h3>
            <p className="text-[11px] text-indigo-900 leading-relaxed">
              • <strong>Reposition:</strong> Click and drag any paper card header to move it across the canvas.
            </p>
            <p className="text-[11px] text-indigo-900 leading-relaxed">
              • <strong>Create Connections:</strong> Hover over a paper card to reveal the 4 port handles (●). Drag from any port onto another paper node to create a dynamic relationship edge!
            </p>
            <p className="text-[11px] text-indigo-900 leading-relaxed">
              • <strong>Inspect & Edit:</strong> Click the info (ⓘ) icon or click any node to view full details (abstract, authors, arXiv links, tags, and incoming/outgoing citation relationships).
            </p>
            <p className="text-[11px] text-indigo-900 leading-relaxed">
              • <strong>Auto-Align:</strong> Click the "Auto-Align" wand button to organize papers chronologically by year.
            </p>
          </div>

          {/* Canvas Navigation */}
          <div>
            <h3 className="font-bold text-slate-900 mb-2 flex items-center">
              <Move className="w-3.5 h-3.5 mr-1.5 text-slate-600" />
              Canvas Navigation
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-slate-50 rounded border border-slate-200 flex items-center justify-between">
                <span>Pan Canvas</span>
                <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px]">
                  Space + Drag
                </kbd>
              </div>
              <div className="p-2 bg-slate-50 rounded border border-slate-200 flex items-center justify-between">
                <span>Zoom In / Out</span>
                <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px]">
                  Ctrl + Wheel
                </kbd>
              </div>
              <div className="p-2 bg-slate-50 rounded border border-slate-200 flex items-center justify-between">
                <span>Undo</span>
                <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px]">
                  Ctrl + Z
                </kbd>
              </div>
              <div className="p-2 bg-slate-50 rounded border border-slate-200 flex items-center justify-between">
                <span>Redo</span>
                <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px]">
                  Ctrl + Y
                </kbd>
              </div>
            </div>
          </div>

          {/* Excalidraw Tool Shortcuts */}
          <div>
            <h3 className="font-bold text-slate-900 mb-2 flex items-center">
              <Layers className="w-3.5 h-3.5 mr-1.5 text-slate-600" />
              Whiteboard Tools & Shortcuts
            </h3>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {[
                { name: 'Select & Move', key: 'V' },
                { name: 'Hand (Pan)', key: 'H' },
                { name: 'Rectangle', key: 'R' },
                { name: 'Diamond', key: 'D' },
                { name: 'Ellipse', key: 'O' },
                { name: 'Arrow', key: 'A' },
                { name: 'Line', key: 'L' },
                { name: 'Draw / Pencil', key: 'P' },
                { name: 'Text', key: 'T' },
                { name: 'Eraser', key: 'E' },
              ].map((item) => (
                <div
                  key={item.name}
                  className="p-1.5 bg-slate-50 rounded border border-slate-200 flex items-center justify-between"
                >
                  <span className="text-slate-600">{item.name}</span>
                  <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px] text-slate-800">
                    {item.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar & Multi-Tab System */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <h4 className="font-semibold text-slate-900">Sidebar & Multi-Dashboard Tabs</h4>
            <p className="text-[11px] text-slate-600 leading-normal">
              Clicking any board file in the sidebar opens it as a dedicated tab (or switches to it if already open). Each tab maintains its own independent canvas state, nodes, edges, and viewport transform!
            </p>
          </div>
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 text-right">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
