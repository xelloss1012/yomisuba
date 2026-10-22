import React, { useState } from 'react';
import { Bookmark, Check, Copy, Download, Highlighter, Search, StickyNote, Trash2, X } from 'lucide-react';
import { TextAnnotation } from '../utils/textAnnotations';
import { useT } from '../i18n/LanguageContext';
import { annotationsToMarkdown } from '../utils/annotationExport';
import { annotationMatches } from '../utils/noteSearch';
import { exportFileName, saveTextFile } from '../utils/exportFile';

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
  onClose: () => void;
  onSelect: (bookmark: ReaderBookmark) => void;
  onRemove: (bookmark: ReaderBookmark) => void;
  onSelectAnnotation: (annotation: TextAnnotation) => void;
  onRemoveAnnotation: (annotation: TextAnnotation) => void;
  /** Opens the note of an underlined passage to write or edit it. */
  onEditNote: (annotation: TextAnnotation) => void;
  /** The title of the book, for the exported notes. */
  bookTitle: string;
}

export const BookmarksModal: React.FC<Props> = ({
  isOpen,
  bookmarks,
  annotations,
  onClose,
  onSelect,
  onRemove,
  onSelectAnnotation,
  onRemoveAnnotation,
  onEditNote,
  bookTitle,
}) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [filter, setFilter] = useState('');
  // What the filter leaves is what is copied and saved.
  const shownAnnotations = annotations.filter((annotation) => annotationMatches(annotation, filter));

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(annotationsToMarkdown(bookTitle, shownAnnotations));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard not allowed: nothing to show, the list is still there to copy by hand.
    }
  };

  const saveAsFile = async () => {
    setExportFailed(false);
    try {
      await saveTextFile(
        exportFileName(bookTitle, t('notes.fileSuffix'), 'md'),
        annotationsToMarkdown(bookTitle, shownAnnotations),
        'text/markdown',
        t('export.shareTitle'),
      );
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (error) {
      // Cancelling the share sheet is not a failure.
      if (!(error instanceof Error && /cancel/i.test(error.message))) setExportFailed(true);
    }
  };
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
              {t('bookmarks.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-area rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={t('nav.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div role="tablist" aria-label={t('bookmarks.title')} className="grid grid-cols-2 gap-1 border-b border-zinc-200 p-2 dark:border-zinc-800">
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
            {t('bookmarks.tabBookmarks')}
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
            {t('bookmarks.tabAnnotations')}
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
                      {bookmark.chapterPageDisplay || `${t('bookmarks.page')} ${bookmark.page + 1}`} · {bookmark.pageDisplay || `${t('bookmarks.page')} ${bookmark.bookPage}`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(bookmark)}
                    className="tap-area rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    aria-label={t('bookmarks.removeBookmark')}
                    title={t('common.delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p role="tabpanel" className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t('bookmarks.empty')}
            </p>
          )
        ) : annotations.length ? (
          <div role="tabpanel" className="flex min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 px-3 pt-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-zinc-300 bg-white px-2.5 dark:border-zinc-700 dark:bg-zinc-950">
                <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                <input
                  type="search"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t('notes.filterPlaceholder')}
                  aria-label={t('notes.filterPlaceholder')}
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
                />
              </div>
              <button
                type="button"
                onClick={() => { void copyAll(); }}
                className="tap-area inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                title={t('notes.copyAll')}
                aria-label={t('notes.copyAll')}
              >
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => { void saveAsFile(); }}
                className="tap-area inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                title={t('notes.saveFile')}
                aria-label={t('notes.saveFile')}
              >
                {saved ? <Check className="h-4 w-4 text-emerald-500" /> : <Download className="h-4 w-4" />}
              </button>
            </div>
            {exportFailed && <p role="alert" className="px-4 pt-2 text-xs text-rose-600 dark:text-rose-400">{t('export.failed')}</p>}
            {shownAnnotations.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">{t('notes.noMatches')}</p>
            )}
          <ul className="space-y-2 overflow-y-auto p-3">
            {shownAnnotations.map((annotation) => (
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
                    {annotation.pageLabel ? annotation.pageLabel : annotation.chapterLabel}
                  </span>
                  {annotation.note && (
                    <span className="mt-1.5 block line-clamp-3 whitespace-pre-line border-l-2 border-amber-400 pl-2 text-xs text-zinc-700 dark:text-zinc-300">
                      {annotation.note}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onEditNote(annotation)}
                  className={`tap-area rounded-lg p-2 hover:bg-amber-50 dark:hover:bg-amber-950/30 ${annotation.note ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500'}`}
                  aria-label={annotation.note ? t('notes.edit') : t('notes.add')}
                  title={annotation.note ? t('notes.edit') : t('notes.add')}
                >
                  <StickyNote className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveAnnotation(annotation)}
                  className="tap-area rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                  aria-label={t('common.delete')}
                  title={t('common.delete')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          </div>
        ) : (
          <p role="tabpanel" className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t('bookmarks.empty')}
          </p>
        )}
      </section>
    </div>
  );
};
