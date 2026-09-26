import React from 'react';
import { Bookmark, Trash2, X } from 'lucide-react';

export interface ReaderBookmark {
  spineIndex: number;
  page: number;
}

interface BookmarkItem extends ReaderBookmark {
  chapterLabel: string;
  bookPage: number;
}

interface Props {
  isOpen: boolean;
  bookmarks: BookmarkItem[];
  onClose: () => void;
  onSelect: (bookmark: ReaderBookmark) => void;
  onRemove: (bookmark: ReaderBookmark) => void;
}

export const BookmarksModal: React.FC<Props> = ({
  isOpen,
  bookmarks,
  onClose,
  onSelect,
  onRemove,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="bookmarks-title"
        className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Bookmark className="h-5 w-5 fill-amber-500 text-amber-600 dark:text-amber-400" />
            <h2 id="bookmarks-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Marcadores
            </h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {bookmarks.length}
            </span>
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

        {bookmarks.length ? (
          <ul className="space-y-2 overflow-y-auto p-3">
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
          <p className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Todavía no hay marcadores. Usa el botón de marcador para guardar la página actual.
          </p>
        )}
      </section>
    </div>
  );
};
