import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Download, ExternalLink, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { useLanguage, useT } from '../i18n/LanguageContext';
import { RecentBook } from '../utils/recentBooks';
import {
  downloadLibraryBook,
  fetchLibraryCatalog,
  filterLibraryBooks,
  genresInCatalog,
  LIBRARY_ATTRIBUTION_URL,
  libraryDescription,
  libraryFileUrl,
  LibraryBook,
  LibraryDifficulty,
  LibraryFilters,
  LibrarySort,
  NO_LIBRARY_FILTERS,
  sortLibraryBooks,
} from '../utils/libraryCatalog';

interface Props {
  isOpen: boolean;
  recentBooks: RecentBook[];
  isLoading: boolean;
  onClose: () => void;
  onOpenRecent: (book: RecentBook) => void;
  onFileLoaded: (file: File) => void;
}

/** Books shown at first and added by each «show more». */
const PAGE_SIZE = 12;
const SORTS: LibrarySort[] = ['catalog', 'easiest', 'hardest', 'shortest', 'longest'];
const DIFFICULTIES: LibraryDifficulty[] = [1, 2, 3, 4, 5];

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

const chipClass = (active: boolean, color: 'indigo' | 'emerald') =>
  `shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
    active
      ? color === 'indigo' ? 'bg-indigo-600 text-white' : 'bg-emerald-600 text-white'
      : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
  }`;

const selectClass =
  'min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200';

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
  const [filters, setFilters] = useState<LibraryFilters>(NO_LIBRARY_FILTERS);
  const [sort, setSort] = useState<LibrarySort>('catalog');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
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

  // A new search, filter or order starts again from the first page.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filters, sort]);

  const genres = useMemo(() => (books ? genresInCatalog(books) : []), [books]);
  // The licence filter only matters when the catalog has both kinds of book.
  const hasFreeLicensed = useMemo(() => (books || []).some((book) => book.license.id !== 'public-domain'), [books]);
  const hasPublicDomain = useMemo(() => (books || []).some((book) => book.license.id === 'public-domain'), [books]);
  const matching = useMemo(
    () => sortLibraryBooks(filterLibraryBooks(books || [], filters, language), sort),
    [books, filters, sort, language],
  );
  const shown = matching.slice(0, visibleCount);
  const isFiltered = filters !== NO_LIBRARY_FILTERS && (
    filters.query.trim() !== '' || filters.genre !== 'all' || filters.license !== 'all' || filters.difficulty !== 'all'
  );
  const setFilter = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

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

  // Drawn on the body: the home screen's card blurs its background, which makes it (and not the screen)
  // the frame a fixed element is placed in, so inside it the dialog ended up at the bottom of the page.
  return createPortal(
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          {books && (
            <>
              {/* The search stays in view while the list scrolls under it. */}
              <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="search"
                    value={filters.query}
                    onChange={(event) => setFilter('query', event.target.value)}
                    placeholder={t('library.search')}
                    aria-label={t('library.search')}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-xs text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  />
                </label>
              </div>

              <div className="flex gap-2 px-3 pt-2">
                <select
                  value={String(filters.difficulty)}
                  onChange={(event) => setFilter('difficulty', event.target.value === 'all' ? 'all' : Number(event.target.value) as LibraryDifficulty)}
                  aria-label={t('library.difficultyFilter')}
                  className={selectClass}
                >
                  <option value="all">{t('library.difficulty.all')}</option>
                  {DIFFICULTIES.map((level) => <option key={level} value={level}>{level} · {t(`library.level.${level}`)}</option>)}
                </select>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as LibrarySort)}
                  aria-label={t('library.sort')}
                  className={selectClass}
                >
                  {SORTS.map((item) => <option key={item} value={item}>{t(`library.sort.${item}`)}</option>)}
                </select>
              </div>

              {hasFreeLicensed && hasPublicDomain && (
                <div className="flex gap-1.5 overflow-x-auto px-3 pt-2" role="group" aria-label={t('library.licenseFilter')}>
                  {([['all', t('library.license.all')], ['public-domain', t('library.publicDomain')], ['free', t('library.license.free')]] as const).map(([item, label]) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={filters.license === item}
                      onClick={() => setFilter('license', item)}
                      className={chipClass(filters.license === item, 'emerald')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {genres.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto px-3 py-2" role="group" aria-label={t('library.genreFilter')}>
                  {(['all', ...genres] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={filters.genre === item}
                      onClick={() => setFilter('genre', item)}
                      className={chipClass(filters.genre === item, 'indigo')}
                    >
                      {item === 'all' ? t('library.allGenres') : t(`library.genre.${item}`)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="p-3">
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
            ) : matching.length === 0 ? (
              <div className="space-y-3 py-8 text-center">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('library.empty')}</p>
                {isFiltered && (
                  <button
                    type="button"
                    onClick={() => { setFilters(NO_LIBRARY_FILTERS); setSort('catalog'); }}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {t('library.clearFilters')}
                  </button>
                )}
              </div>
            ) : (
              <>
                <ul className="space-y-3">
                  {shown.map((book) => {
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
                            {book.license.id === 'public-domain' ? (
                              <span>{t('library.publicDomain')}</span>
                            ) : (
                              <>
                                <a
                                  href={book.license.url ?? undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400"
                                >
                                  {t('library.licenseLabel', { name: book.license.name })}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                                {book.license.creditRole && book.license.creditName && (
                                  <span>{t(`library.credit.${book.license.creditRole}`, { name: book.license.creditName })}</span>
                                )}
                              </>
                            )}
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
                <div className="mt-4 flex flex-col items-center gap-2">
                  <p role="status" className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {t('library.showing', { shown: shown.length, total: matching.length })}
                  </p>
                  {shown.length < matching.length && (
                    <button
                      type="button"
                      onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                      className="inline-flex min-h-9 items-center rounded-xl border border-indigo-300 px-4 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                    >
                      {t('library.showMore')}
                    </button>
                  )}
                </div>
              </>
            )}
            {downloadError && <p role="alert" className="mt-3 text-center text-xs text-rose-600 dark:text-rose-400">{downloadError}</p>}
          </div>
        </div>

        <footer className="shrink-0 border-t border-zinc-200 px-4 py-3 text-[11px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {t('library.credits')}{' '}
          <a href={LIBRARY_ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t('library.attribution')}
          </a>
        </footer>
      </section>
    </div>,
    document.body,
  );
};
