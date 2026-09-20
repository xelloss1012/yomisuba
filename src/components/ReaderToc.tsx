import React from 'react';
import { TocItem } from '../types/epub';
import { X, BookOpen, ChevronRight } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  toc: TocItem[];
  currentSpineIndex: number;
  spineHrefs: string[];
  onSelectChapter: (href: string) => void;
  bookTitle: string;
}

export const ReaderToc: React.FC<Props> = ({
  isOpen,
  onClose,
  toc,
  currentSpineIndex,
  spineHrefs,
  onSelectChapter,
  bookTitle,
}) => {
  if (!isOpen) return null;

  const currentHref = spineHrefs[currentSpineIndex] || '';

  const renderTocList = (items: TocItem[], depth = 0) => {
    return (
      <ul className={`space-y-1 ${depth > 0 ? 'ml-4 pl-2 border-l border-zinc-200 dark:border-zinc-800' : ''}`}>
        {items.map((item, idx) => {
          const itemHrefBase = item.href.split('#')[0];
          const isCurrent = currentHref.endsWith(itemHrefBase) || itemHrefBase.endsWith(currentHref);

          return (
            <li key={item.id || idx}>
              <button
                type="button"
                onClick={() => {
                  onSelectChapter(item.href);
                  onClose();
                }}
                className={`w-full text-left py-2.5 px-3 rounded-lg flex items-center justify-between text-sm transition-colors ${
                  isCurrent
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 font-semibold'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                }`}
              >
                <span className="truncate pr-2">{item.label}</span>
                {item.subitems && item.subitems.length > 0 ? (
                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                ) : null}
              </button>
              {item.subitems && item.subitems.length > 0 && renderTocList(item.subitems, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-sm h-full bg-white dark:bg-zinc-900 shadow-2xl border-r border-zinc-200 dark:border-zinc-800 flex flex-col transform transition-transform"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {bookTitle || 'Índice de Contenidos'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* TOC List */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3">
            Capítulos ({toc.length})
          </div>
          {toc.length > 0 ? (
            renderTocList(toc)
          ) : (
            <div className="text-center py-10 text-zinc-500 text-sm">
              No se encontraron capítulos en el índice.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
