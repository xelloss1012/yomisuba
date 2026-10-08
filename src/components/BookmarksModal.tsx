import React, { useState } from 'react';
import { Bookmark, Highlighter, Trash2, X } from 'lucide-react';
import { TextAnnotation } from '../utils/textAnnotations';

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
              Guardados
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-area rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Cerrar marcadores"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div role="tablist" aria-label="Elementos guardados" className="grid grid-cols-2 gap-1 border-b border-zinc-200 p-2 dark:border-zinc-800">
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
            Marcadores
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
            Subrayados
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
                      Página {bookmark.page + 1} del capítulo · Página {bookmark.bookPage} del libro
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(bookmark)}
                    className="tap-area rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    aria-label={`Eliminar marcador de página ${bookmark.bookPage}`}
                    title="Eliminar marcador"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p role="tabpanel" className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Todavía no hay marcadores. Usa el botón de marcador para guardar la página actual.
            </p>
          )
        ) : annotations.length ? (
          <ul role="tabpanel" className="space-y-2 overflow-y-auto p-3">
            {annotations.map((annotation) => {
              const excerpt = annotation.quote.trim().replace(/\s+/g, ' ');
              return (
                <li
                  key={annotation.id}
                  className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-2 dark:border-indigo-900 dark:bg-indigo-950/20"
                >
                  <button
                    type="button"
                    onClick={() => onSelectAnnotation(annotation)}
                    className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left hover:bg-indigo-100/70 dark:hover:bg-indigo-900/40"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                      <Highlighter className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{annotation.chapterLabel}</span>
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-zinc-800 dark:text-zinc-100">
                      <span className="rounded bg-indigo-200/80 px-0.5 dark:bg-indigo-800/70">
                        {excerpt.slice(0, 180)}
                        {excerpt.length > 180 ? '…' : ''}
                      </span>
                    </span>
                    {annotation.pageLabel && (
                      <span className="mt-1.5 block text-xs text-zinc-500 dark:text-zinc-400">
                        {annotation.pageLabel}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveAnnotation(annotation)}
                    className="tap-area rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    aria-label={`Eliminar subrayado: ${annotation.quote.slice(0, 40)}`}
                    title="Eliminar subrayado"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p role="tabpanel" className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Todavía no hay frases subrayadas. Selecciona un texto y pulsa «Subrayar».
          </p>
        )}
      </section>
    </div>
  );
};
