import React from 'react';
import { X, Plus, Layout, Sparkles } from 'lucide-react';
import { TabItem } from '../types';

interface TabBarProps {
  tabs: TabItem[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string, e: React.MouseEvent) => void;
  onNewTab: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
}) => {
  return (
    <div className="h-10 bg-slate-100 border-b border-slate-200 flex items-center px-2 select-none overflow-x-auto no-scrollbar">
      <div className="flex items-center space-x-1 flex-1 min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              id={`tab-${tab.id}`}
              onClick={() => onSelectTab(tab.id)}
              className={`group flex items-center h-8 px-3 rounded-t-md text-xs font-medium cursor-pointer border-t border-x transition-all duration-150 relative ${
                isActive
                  ? 'bg-white border-slate-200 border-b-white text-slate-900 shadow-2xs z-10'
                  : 'bg-slate-200/60 hover:bg-slate-200 border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layout
                className={`w-3.5 h-3.5 mr-1.5 flex-shrink-0 ${
                  isActive ? 'text-blue-600' : 'text-slate-400'
                }`}
              />
              <span className="truncate max-w-[140px] tracking-tight">{tab.title}</span>

              {tab.isDirty && (
                <span
                  title="Unsaved modifications"
                  className="w-1.5 h-1.5 rounded-full bg-amber-500 ml-1.5 flex-shrink-0"
                />
              )}

              <button
                id={`tab-close-${tab.id}`}
                title="Close Tab"
                onClick={(e) => onCloseTab(tab.id, e)}
                className={`ml-2 p-0.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-200/80 transition-colors ${
                  isActive ? 'opacity-80 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* Add Tab Button */}
        <button
          id="btn-add-tab"
          onClick={onNewTab}
          title="Create New Whiteboard Tab"
          className="p-1.5 hover:bg-slate-200 rounded-md text-slate-500 hover:text-slate-800 transition-colors flex items-center justify-center ml-1"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Excalidraw Style Badge */}
      <div className="flex items-center space-x-1 text-[11px] text-slate-500 font-medium px-2 py-0.5 rounded bg-white/70 border border-slate-200 shadow-2xs">
        <Sparkles className="w-3 h-3 text-indigo-500" />
        <span>Excalidraw Engine</span>
      </div>
    </div>
  );
};
