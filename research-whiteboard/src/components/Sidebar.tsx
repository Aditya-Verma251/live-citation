import React, { useState } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  Plus,
  ChevronRight,
  ChevronDown,
  Trash2,
  Edit2,
  BookOpen,
  Network,
  Sparkles,
  Layers,
  Search,
  ExternalLink,
} from 'lucide-react';
import { FileItem } from '../types';

interface SidebarProps {
  files: FileItem[];
  activeDashboardId: string | null;
  openTabDashboardIds: string[];
  onOpenFile: (file: FileItem) => void;
  onCreateFile: (parentId: string | null, name?: string) => void;
  onCreateFolder: (parentId: string | null, name?: string) => void;
  onDeleteFile: (fileId: string) => void;
  onRenameFile: (fileId: string, newName: string) => void;
  onQuickAddPresetPaper: (presetKey: string) => void;
}

export const PRESET_RESEARCH_PAPERS = [
  {
    key: 'lora',
    title: 'LoRA: Low-Rank Adaptation of Large Language Models',
    authors: 'Hu et al. (Microsoft)',
    year: 2021,
    venue: 'ICLR 2022',
    color: '#0284c7',
    tags: ['PEFT', 'Efficiency', 'Finetuning'],
  },
  {
    key: 'resnet',
    title: 'Deep Residual Learning for Image Recognition',
    authors: 'He, Zhang, Ren, Sun (MSRA)',
    year: 2015,
    venue: 'CVPR 2016',
    color: '#4f46e5',
    tags: ['ResNet', 'Skip-Connections', 'Vision'],
  },
  {
    key: 'adam',
    title: 'Adam: A Method for Stochastic Optimization',
    authors: 'Kingma & Ba',
    year: 2014,
    venue: 'ICLR 2015',
    color: '#d97706',
    tags: ['Optimizer', 'Adaptive Gradients', 'Foundational'],
  },
  {
    key: 'clip',
    title: 'Learning Transferable Visual Models From Natural Language Supervision',
    authors: 'Radford et al. (OpenAI)',
    year: 2021,
    venue: 'ICML 2021',
    color: '#ec4899',
    tags: ['CLIP', 'Multimodal', 'Contrastive'],
  },
  {
    key: 'dpo',
    title: 'Direct Preference Optimization: Your Language Model is Secretly a Reward Model',
    authors: 'Rafailov et al. (Stanford)',
    year: 2023,
    venue: 'NeurIPS 2023',
    color: '#8b5cf6',
    tags: ['Alignment', 'DPO', 'RLHF Alternative'],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  files,
  activeDashboardId,
  openTabDashboardIds,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  onQuickAddPresetPaper,
}) => {
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSidebarTab, setActiveSidebarTab] = useState<'files' | 'library'>('files');

  const toggleFolder = (folderId: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
  };

  const handleStartRename = (file: FileItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingFileId(file.id);
    setEditingName(file.name);
  };

  const handleSaveRename = (fileId: string) => {
    if (editingName.trim()) {
      onRenameFile(fileId, editingName.trim());
    }
    setEditingFileId(null);
  };

  // Group files by parent
  const rootItems = files.filter(
    (f) =>
      f.parentId === null &&
      (searchQuery ? f.name.toLowerCase().includes(searchQuery.toLowerCase()) : true)
  );

  const getChildren = (parentId: string) => {
    return files.filter(
      (f) =>
        f.parentId === parentId &&
        (searchQuery ? f.name.toLowerCase().includes(searchQuery.toLowerCase()) : true)
    );
  };

  const renderItem = (item: FileItem, depth: number = 0) => {
    const isFolder = item.isFolder;
    const isCollapsed = collapsedFolders[item.id];
    const children = isFolder ? getChildren(item.id) : [];
    const isActive = item.dashboardId === activeDashboardId;
    const isOpenTab = item.dashboardId && openTabDashboardIds.includes(item.dashboardId);

    return (
      <div key={item.id} className="select-none">
        <div
          id={`sidebar-item-${item.id}`}
          onClick={() => {
            if (isFolder) {
              toggleFolder(item.id);
            } else {
              onOpenFile(item);
            }
          }}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          className={`group flex items-center justify-between py-1.5 pr-2 rounded-md text-sm cursor-pointer transition-colors duration-150 ${
            isActive
              ? 'bg-blue-50 text-blue-800 font-medium'
              : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <div className="flex items-center min-w-0 flex-1 mr-1">
            {isFolder ? (
              <span className="mr-1.5 text-slate-400 group-hover:text-slate-600">
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </span>
            ) : (
              <span
                className="w-2 h-2 rounded-full mr-2.5 flex-shrink-0"
                style={{ backgroundColor: item.colorTag || '#94a3b8' }}
              />
            )}

            {isFolder ? (
              isCollapsed ? (
                <Folder className="w-4 h-4 mr-2 text-amber-500 flex-shrink-0" />
              ) : (
                <FolderOpen className="w-4 h-4 mr-2 text-amber-500 flex-shrink-0" />
              )
            ) : (
              <FileText className={`w-3.5 h-3.5 mr-2 flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
            )}

            {editingFileId === item.id ? (
              <input
                id={`rename-input-${item.id}`}
                autoFocus
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={() => handleSaveRename(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename(item.id);
                  if (e.key === 'Escape') setEditingFileId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white px-1 py-0.5 border border-blue-400 rounded text-xs w-full outline-none"
              />
            ) : (
              <span className="truncate text-xs tracking-tight">{item.name}</span>
            )}
          </div>

          {/* Right badges & actions */}
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            {isFolder && (
              <button
                id={`btn-add-to-folder-${item.id}`}
                title="New file in folder"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateFile(item.id);
                }}
                className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-800"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
            <button
              id={`btn-rename-${item.id}`}
              title="Rename"
              onClick={(e) => handleStartRename(item, e)}
              className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-800"
            >
              <Edit2 className="w-3 h-3" />
            </button>
            <button
              id={`btn-delete-${item.id}`}
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete "${item.name}"?`)) {
                  onDeleteFile(item.id);
                }
              }}
              className="p-1 hover:bg-red-100 rounded text-slate-400 hover:text-red-600"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>

          {isOpenTab && !isActive && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-blue-400 ml-1 group-hover:hidden"
              title="Tab open"
            />
          )}
        </div>

        {isFolder && !isCollapsed && (
          <div className="space-y-0.5">
            {children.map((child) => renderItem(child, depth + 1))}
            {children.length === 0 && (
              <div
                style={{ paddingLeft: `${(depth + 1) * 14 + 20}px` }}
                className="text-[11px] text-slate-400 py-1 italic"
              >
                Empty folder
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-64 h-full bg-slate-50/90 border-r border-slate-200 flex flex-col flex-shrink-0 select-none">
      {/* Top Header */}
      <div className="p-3 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
            <Network className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-semibold text-slate-900 leading-tight">Research Boards</h2>
            <p className="text-[10px] text-slate-500">Excalidraw & Graph Canvas</p>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          <button
            id="sidebar-new-file-btn"
            onClick={() => onCreateFile(null)}
            title="New Whiteboard File"
            className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-slate-200/70 rounded-md transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            id="sidebar-new-folder-btn"
            onClick={() => onCreateFolder(null)}
            title="New Folder"
            className="p-1.5 text-slate-600 hover:text-amber-600 hover:bg-slate-200/70 rounded-md transition-colors"
          >
            <Folder className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs: Files vs Preset Research Library */}
      <div className="grid grid-cols-2 p-1.5 bg-slate-100/80 mx-2 mt-2 rounded-lg text-xs font-medium">
        <button
          id="tab-view-files"
          onClick={() => setActiveSidebarTab('files')}
          className={`py-1 rounded-md flex items-center justify-center space-x-1.5 transition-all ${
            activeSidebarTab === 'files'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Files</span>
        </button>
        <button
          id="tab-view-library"
          onClick={() => setActiveSidebarTab('library')}
          className={`py-1 rounded-md flex items-center justify-center space-x-1.5 transition-all ${
            activeSidebarTab === 'library'
              ? 'bg-white text-blue-700 shadow-xs'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Paper Hub</span>
        </button>
      </div>

      {activeSidebarTab === 'files' ? (
        <>
          {/* Search Box */}
          <div className="p-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                id="sidebar-search-files"
                type="text"
                placeholder="Search boards..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* File Tree List */}
          <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
            {rootItems.map((item) => renderItem(item, 0))}
            {rootItems.length === 0 && (
              <div className="text-center py-6 text-slate-400 text-xs">
                {searchQuery ? 'No matching boards' : 'No whiteboard files yet'}
              </div>
            )}
          </div>

          {/* Bottom helper info */}
          <div className="p-3 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between">
            <span className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
              <span>{openTabDashboardIds.length} tab(s) active</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">ExcaliGraph</span>
          </div>
        </>
      ) : (
        /* Paper Hub Tab: Curated Foundational Papers to Quick-Add to Active Canvas */
        <div className="flex-1 flex flex-col p-2 overflow-y-auto">
          <div className="mb-2">
            <p className="text-[11px] font-medium text-slate-700">Quick-Add Paper Nodes</p>
            <p className="text-[10px] text-slate-500">
              Click to insert onto active whiteboard with full metadata & connection handles:
            </p>
          </div>

          <div className="space-y-2 flex-1">
            {PRESET_RESEARCH_PAPERS.map((paper) => (
              <div
                key={paper.key}
                id={`preset-paper-${paper.key}`}
                onClick={() => onQuickAddPresetPaper(paper.key)}
                className="p-2 bg-white hover:bg-blue-50/60 border border-slate-200 hover:border-blue-300 rounded-lg cursor-pointer transition-all duration-150 group shadow-2xs"
              >
                <div className="flex items-start justify-between gap-1">
                  <h4 className="text-xs font-semibold text-slate-900 group-hover:text-blue-700 line-clamp-2">
                    {paper.title}
                  </h4>
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
                    style={{ backgroundColor: paper.color }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                  <span>{paper.authors}</span>
                  <span className="font-mono text-slate-400">{paper.year}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {paper.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded bg-slate-100 text-[9px] text-slate-600 font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 p-2 bg-blue-50/70 border border-blue-200 rounded-lg text-[10px] text-blue-800 flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
            <span>Click any preset above to add directly to current canvas</span>
          </div>
        </div>
      )}
    </aside>
  );
};
