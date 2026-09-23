import React, { useState } from 'react';
import {
  Sidebar as SidebarIcon,
  Download,
  Upload,
  Image,
  HelpCircle,
  Share2,
  Edit2,
  Check,
  Sparkles,
  Network,
} from 'lucide-react';

interface TopNavProps {
  title: string;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  isLinkedPapersOpen: boolean;
  onToggleLinkedPapers: () => void;
  linkedPapersCount?: number;
  onRenameTitle: (newTitle: string) => void;
  onExportPNG: () => void;
  onExportJSON: () => void;
  onImportJSON: () => void;
  onOpenShortcuts: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  title,
  isSidebarOpen,
  onToggleSidebar,
  isLinkedPapersOpen,
  onToggleLinkedPapers,
  linkedPapersCount,
  onRenameTitle,
  onExportPNG,
  onExportJSON,
  onImportJSON,
  onOpenShortcuts,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title);

  const handleSave = () => {
    if (editedTitle.trim()) {
      onRenameTitle(editedTitle.trim());
    }
    setIsEditing(false);
  };

  return (
    <header className="h-12 bg-white border-b border-slate-200 px-3 flex items-center justify-between z-30 select-none">
      {/* Left section: Sidebar toggle & Title */}
      <div className="flex items-center space-x-3 min-w-0">
        <button
          id="btn-toggle-sidebar"
          onClick={onToggleSidebar}
          title={isSidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
          className={`p-1.5 rounded-lg border transition-colors ${
            isSidebarOpen
              ? 'bg-slate-100 border-slate-300 text-slate-800'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <SidebarIcon className="w-4 h-4" />
        </button>

        <div className="flex items-center space-x-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
            <Network className="w-3.5 h-3.5" />
          </div>

          {isEditing ? (
            <div className="flex items-center space-x-1">
              <input
                type="text"
                autoFocus
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={handleSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
                className="text-xs font-semibold px-2 py-0.5 border border-blue-500 rounded bg-white outline-none"
              />
              <button
                onClick={handleSave}
                className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div
              className="flex items-center space-x-1.5 cursor-pointer group"
              onClick={() => {
                setEditedTitle(title);
                setIsEditing(true);
              }}
              title="Click to rename"
            >
              <h1 className="text-xs font-semibold text-slate-900 truncate max-w-[260px]">
                {title}
              </h1>
              <Edit2 className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
        </div>
      </div>

      {/* Right section: Action Buttons */}
      <div className="flex items-center space-x-1.5">
        <button
          id="btn-toggle-linked-papers"
          onClick={onToggleLinkedPapers}
          title={isLinkedPapersOpen ? 'Hide Linked Papers Panel' : 'Show Linked Papers Panel'}
          className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
            isLinkedPapersOpen
              ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-2xs'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Network className="w-3.5 h-3.5 text-indigo-600" />
          <span className="hidden md:inline">Linked Papers</span>
          {linkedPapersCount !== undefined && linkedPapersCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-100 text-indigo-700 font-bold">
              {linkedPapersCount}
            </span>
          )}
        </button>

        <div className="w-px h-4 bg-slate-200 mx-0.5" />

        <button
          id="btn-export-png"
          onClick={onExportPNG}
          title="Export Canvas as PNG Image"
          className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5"
        >
          <Image className="w-3.5 h-3.5 text-slate-500" />
          <span className="hidden sm:inline">Export PNG</span>
        </button>

        <button
          id="btn-export-json"
          onClick={onExportJSON}
          title="Download Board as JSON"
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-transparent hover:border-slate-200 transition-colors"
        >
          <Download className="w-4 h-4" />
        </button>

        <button
          id="btn-import-json"
          onClick={onImportJSON}
          title="Import Board JSON"
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-transparent hover:border-slate-200 transition-colors"
        >
          <Upload className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-slate-200 mx-1" />

        <button
          id="btn-shortcuts-guide"
          onClick={onOpenShortcuts}
          title="Keyboard Shortcuts & Help"
          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
