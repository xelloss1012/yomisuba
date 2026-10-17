import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import { useLanguage, useT } from '../i18n/LanguageContext';
import { RecentBook } from '../utils/recentBooks';
import {
  downloadLibraryBook,
  fetchLibraryCatalog,
  genresInCatalog,
  LIBRARY_ATTRIBUTION_URL,
  libraryDescription,
  libraryFileUrl,
  LibraryBook,
  LibraryGenre,
} from '../utils/libraryCatalog';

interface Props {
  isOpen: boolean;
  recentBooks: RecentBook[];
  isLoading: boolean;
  onClose: () => void;
  onOpenRecent: (book: RecentBook) => void;
  onFileLoaded: (file: File) => void;
}

const formatSize = (bytes: number) =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;

const DifficultyDots: React.FC<{ level: number }> = ({ level }) => (
  <span aria-hidden="true" className="inline-flex gap-0.5">
    {[1, 2, 3, 4, 5].map((dot) => (
      <span
        key={dot}
        className={`h-1.5 w-1.5 rounded-full ${dot <= level ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}
      />
    ))}
  </span>
);

export const BookLibraryModal: React.FC<Props> = ({
  isOpen,
  recentBooks,
  isLoading,
  onClose,
  onOpenRecent,
  onFileLoaded,
}) => {
  const t = useT();
  const language = useLanguage();
  const [books, setBooks] = useState<LibraryBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [genre, setGenre] = useState<'all' | LibraryGenre>('all');
  const [downloading, setDownloading] = useState<{ slug: string; percent: number } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const loadCatalog = useCallback((signal?: AbortSignal) => {
    setError(null);
    setBooks(null);
    fetchLibraryCatalog(signal)
      .then(setBooks)
      .catch((reason: unknown) => {
        if (signal?.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  useEffect(() => {
    if (!isOpen || books) return undefined;
    const controller = new AbortController();
    loadCatalog(controller.signal);
    return () => controller.abort();
  }, [isOpen, books, loadCatalog]);

  const genres = useMemo(() => (books ? genresInCatalog(books) : []), [books]);
  const visible = useMemo(
    () => (books || []).filter((book) => genre === 'all' || book.genres.includes(genre)),
    [books, genre],
  );
  // A book already imported or downloaded opens from the local library.
  const localCopy = useCallback(
    (book: LibraryBook) => recentBooks.find((recent) => recent.title === book.title && recent.creator === book.author),
    [recentBooks],
  );

  if (!isOpen) return null;

  const download = async (book: LibraryBook) => {
    setDownloadError(null);
    setDownloading({ slug: book.slug, percent: 0 });
    try {
      const file = await downloadLibraryBook(book, (loaded, total) =>
        setDownloading({ slug: book.slug, percent: Math.round((loaded / total) * 100) }));
      onClose();
      onFileLoaded(file);
    } catch (reason) {
      setDownloadError(t('library.downloadError', { message: reason instanceof Error ? reason.message : String(reason) }));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-title"
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white text-left shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 id="library-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t('library.title')}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('library.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-area shrink-0 rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={t('nav.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {genres.length > 1 && (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-zinc-200 px-3 py-2 dark:border-zinc-800" role="group" aria-label={t('library.genreFilter')}>
            {(['all', ...genres] as Array<'all' | LibraryGenre>).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={genre === item}
                onClick={() => setGenre(item)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  genre === item
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                }`}
              >
                {item === 'all' ? t('library.allGenres') : t(`library.genre.${item}`)}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {error ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-sm text-rose-600 dark:text-rose-400">{t('library.error', { message: error })}</p>
              <button
                type="button"
                onClick={() => loadCatalog()}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <RefreshCw className="h-4 w-4" />
                {t('library.retry')}
              </button>
            </div>
          ) : !books ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500 dark:text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('library.loading')}
            </div>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">{t('library.empty')}</p>
          ) : (
            <ul className="space-y-3">
              {visible.map((book) => {
                const local = localCopy(book);
                const busy = downloading?.slug === book.slug;
                return (
                  <li key={book.id} className="flex gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <img
                      src={libraryFileUrl(book.cover)}
                      alt=""
                      loading="lazy"
                      width={72}
                      height={108}
                      className="h-[108px] w-[72px] shrink-0 rounded-md border border-zinc-200 bg-zinc-100 object-cover shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 lang="ja" className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{book.title}</h3>
                      <p lang="ja" className="truncate text-xs text-zinc-500 dark:text-zinc-400">{book.author}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {book.genres.map((item) => (
                          <span key={item} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                            {t(`library.genre.${item}`)}
                          </span>
                        ))}
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                        {libraryDescription(book, language)}
                      </p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <span>{t('library.pages', { pages: book.pages })} · {formatSize(book.bytes)}</span>
                        <span title={t('library.levelHint')} className="inline-flex items-center gap-1.5">
                          <DifficultyDots level={book.difficulty} />
                          {t(`library.level.${book.difficulty}`)}
                        </span>
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <span>{t('library.publicDomain')}</span>
                        <a
                          href={book.source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          {t('library.source')}: {book.source.name}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </p>
                      <div className="mt-2">
                        {local ? (
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => { onClose(); onOpenRecent(local); }}
                            className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                          >
                            <BookOpen className="h-4 w-4" />
                            {t('library.open')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isLoading || downloading !== null}
                            onClick={() => { void download(book); }}
                            className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
                          >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            {busy ? t('library.downloading', { percent: downloading?.percent ?? 0 }) : t('library.download')}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {downloadError && <p role="alert" className="mt-3 text-center text-xs text-rose-600 dark:text-rose-400">{downloadError}</p>}
        </div>

        <footer className="shrink-0 border-t border-zinc-200 px-4 py-3 text-[11px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {t('library.credits')}{' '}
          <a href={LIBRARY_ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t('library.attribution')}
          </a>
        </footer>
      </section>
    </div>
  );
};
