import React, { useState } from 'react';
import { Bookmark, Highlighter, Trash2, X } from 'lucide-react';
import { TextAnnotation } from '../utils/textAnnotations';
import { t, UiLanguage } from '../utils/i18n';

export interface ReaderBookmark {
  spineIndex: number;
  page: number;
  pageCount?: number;
  textOffset?: number;
  originalPage?: number;
}

interface BookmarkItem extends ReaderBookmark {
  chapterLabel: string;
  bookPage: number;
  pageDisplay?: string;
  chapterPageDisplay?: string;
}

interface AnnotationItem extends TextAnnotation {
  chapterLabel: string;
  pageLabel?: string;
}

interface Props {
  isOpen: boolean;
  bookmarks: BookmarkItem[];
  annotations: AnnotationItem[];
  language?: UiLanguage;
  onClose: () => void;
  onSelect: (bookmark: ReaderBookmark) => void;
  onRemove: (bookmark: ReaderBookmark) => void;
  onSelectAnnotation: (annotation: TextAnnotation) => void;
  onRemoveAnnotation: (annotation: TextAnnotation) => void;
}

export const BookmarksModal: React.FC<Props> = ({
  isOpen,
  bookmarks,
  annotations,
  language = 'es',
  onClose,
  onSelect,
  onRemove,
  onSelectAnnotation,
  onRemoveAnnotation,
}) => {
  const [activeTab, setActiveTab] = useState<'bookmarks' | 'annotations'>(() =>
    bookmarks.length === 0 && annotations.length > 0 ? 'annotations' : 'bookmarks'
  );
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-items-title"
        className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <h2 id="saved-items-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t('bookmarks.title', language)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-area rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={t('nav.close', language)}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div role="tablist" aria-label={t('bookmarks.title', language)} className="grid grid-cols-2 gap-1 border-b border-zinc-200 p-2 dark:border-zinc-800">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'bookmarks'}
            onClick={() => setActiveTab('bookmarks')}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              activeTab === 'bookmarks'
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            <Bookmark className="h-4 w-4" />
            {t('bookmarks.tabBookmarks', language)}
            <span className="text-xs opacity-70">{bookmarks.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'annotations'}
            onClick={() => setActiveTab('annotations')}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              activeTab === 'annotations'
                ? 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            <Highlighter className="h-4 w-4" />
            {t('bookmarks.tabAnnotations', language)}
            <span className="text-xs opacity-70">{annotations.length}</span>
          </button>
        </div>

        {activeTab === 'bookmarks' ? (
          bookmarks.length ? (
            <ul role="tabpanel" className="space-y-2 overflow-y-auto p-3">
              {bookmarks.map((bookmark) => (
                <li
                  key={`${bookmark.spineIndex}:${bookmark.page}`}
                  className="flex items-center gap-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(bookmark)}
                    className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
                  >
                    <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {bookmark.chapterLabel}
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                      {bookmark.chapterPageDisplay || `${t('bookmarks.page', language)} ${bookmark.page + 1}`} · {bookmark.pageDisplay || `${t('bookmarks.page', language)} ${bookmark.bookPage}`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(bookmark)}
                    className="tap-area rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    aria-label={t('bookmarks.removeBookmark', language)}
                    title={t('common.delete', language)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p role="tabpanel" className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t('bookmarks.empty', language)}
            </p>
          )
        ) : annotations.length ? (
          <ul role="tabpanel" className="space-y-2 overflow-y-auto p-3">
            {annotations.map((annotation) => (
              <li
                key={annotation.id}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800"
              >
                <button
                  type="button"
                  onClick={() => onSelectAnnotation(annotation)}
                  className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
                >
                  <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    "{annotation.quote}"
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                    {annotation.chapterLabel} {annotation.pageLabel ? `· ${annotation.pageLabel}` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveAnnotation(annotation)}
                  className="tap-area rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                  aria-label={t('common.delete', language)}
                  title={t('common.delete', language)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p role="tabpanel" className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t('bookmarks.empty', language)}
          </p>
        )}
      </section>
    </div>
  );
};
