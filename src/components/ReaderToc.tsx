import React from 'react';
import { TocItem } from '../types/epub';
import { X, BookOpen, ChevronRight, Home } from 'lucide-react';
import { formatPageDisplay } from '../utils/paginationDisplay';
import { t, UiLanguage } from '../utils/i18n';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  toc: TocItem[];
  currentSpineIndex: number;
  spineHrefs: string[];
  onSelectChapter: (href: string) => void;
  bookTitle: string;
  resolveSpineIndex: (href: string) => number;
  getGlobalPage: (spineIndex: number, page: number) => number;
  bookTotalPages: number;
  paginationMode: 'device' | 'printed' | 'percent';
  printedPages?: number;
  isBookPaginationReady: boolean;
  language?: UiLanguage;
}

export const ReaderToc: React.FC<Props> = ({
  isOpen,
  onClose,
  toc,
  currentSpineIndex,
  spineHrefs,
  onSelectChapter,
  bookTitle,
  resolveSpineIndex,
  getGlobalPage,
  bookTotalPages,
  paginationMode,
  printedPages,
  isBookPaginationReady,
  language = 'es',
}) => {
  if (!isOpen) return null;

  const currentHref = spineHrefs[currentSpineIndex] || '';

  const renderTocList = (items: TocItem[], depth = 0) => {
    return (
      <ul className={`space-y-1 ${depth > 0 ? 'ml-4 pl-2 border-l border-zinc-200 dark:border-zinc-800' : ''}`}>
        {items.map((item, idx) => {
          const itemHrefBase = item.href.split('#')[0];
          const isCurrent = currentHref.endsWith(itemHrefBase) || itemHrefBase.endsWith(currentHref);
          const spineIndex = resolveSpineIndex(item.href);
          const globalPage = spineIndex >= 0 ? getGlobalPage(spineIndex, 0) : 0;
          const pageLabel = isBookPaginationReady && spineIndex >= 0
            ? formatPageDisplay(globalPage, bookTotalPages, paginationMode, printedPages, language)
            : '';

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
                <div className="flex items-center justify-between min-w-0 flex-1 pr-2">
                  <span className="truncate">{item.label}</span>
                  {pageLabel && (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums shrink-0 ml-2">
                      {pageLabel}
                    </span>
                  )}
                </div>
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
              {bookTitle || t('toc.defaultTitle', language)}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors shrink-0"
            aria-label={t('nav.close', language)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* TOC List */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3">
            {t('toc.chapters', language)} ({toc.length})
          </div>

          {spineHrefs.length > 0 && (
            <div className="mb-3 pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  onSelectChapter(spineHrefs[0]);
                  onClose();
                }}
                className={`w-full text-left py-2.5 px-3 rounded-lg flex items-center justify-between text-sm transition-colors ${
                  currentSpineIndex === 0
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 font-semibold'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                }`}
              >
                <div className="flex items-center justify-between min-w-0 flex-1 pr-2">
                  <span className="truncate flex items-center gap-2">
                    <Home className="w-4 h-4 text-indigo-500 shrink-0" />
                    {t('reader.beginning', language)}
                  </span>
                  {isBookPaginationReady && (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums shrink-0 ml-2">
                      {formatPageDisplay(0, bookTotalPages, paginationMode, printedPages, language)}
                    </span>
                  )}
                </div>
              </button>
            </div>
          )}

          {toc.length > 0 ? (
            renderTocList(toc)
          ) : (
            <div className="text-center py-10 text-zinc-500 text-sm">
              {t('toc.empty', language)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
