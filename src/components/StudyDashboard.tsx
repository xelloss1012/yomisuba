import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, BookOpen, Check, Clock, CloudDownload, Download, EyeOff, GraduationCap, Loader2, NotebookPen, RefreshCw, Repeat, RotateCcw, Search, Star, Trash2, X } from 'lucide-react';
import { Translate, useDictionaryOptions, useLanguage, useT, useTranslationLanguage } from '../i18n/LanguageContext';
import { RecentBook } from '../utils/recentBooks';
import {
  bookKeyOf,
  collectStudyData,
  listStoredBooks,
  sortVocabulary,
  BookRef,
  StudyData,
  VocabularySort,
  vocabularyKey,
  withEntries,
  wordsPerMonth,
} from '../utils/studyData';
import type { DriveStudyBook, ReaderBookBackup } from '../utils/googleDriveBackup';
import { historyToCsv, notesToAnki, notesToMarkdown, vocabularyToAnki, vocabularyToCsv, vocabularyToMarkdown } from '../utils/studyExport';
import { removeBookFavorites, toggleBookFavorite } from '../utils/bookSnapshot';
import { isTranslationFavorite, readTranslationFavorites, TranslationFavorite, TranslationFavoriteCandidate } from '../utils/translationFavorites';
import { DictionaryLookup, getDictionarySearchTerms } from '../utils/dictionary';
import { buildDictionaryHistoryResponse, TranslationHistoryEntry } from '../utils/translationHistory';
import { normalizeFrequentQuery } from '../utils/frequentQueries';
import { exportFileName, saveTextFile } from '../utils/exportFile';
import { favoriteFields } from '../utils/favoritesExport';
import { normalizeSearchQuery } from '../utils/bookSearch';
import { getHistoryEntryResponse } from '../utils/translationHistory';
import { classifyWord } from '../utils/wordLevels';
import { useWordLevels, WordLevelBadge } from './WordLevelBadge';
import { getKindLabel } from './TranslationHistoryModal';
import { formatDue, StudyReview } from './StudyReview';
import {
  answer,
  countStatuses,
  Grade,
  isDue,
  markIgnored,
  markKnown,
  readStudyProgress,
  resetCard,
  reviewQueue,
  setCard,
  statusOf,
  StudyProgress,
  StudyStatus,
  writeStudyProgress,
} from '../utils/studyProgress';

type Tab = 'summary' | 'review' | 'vocabulary' | 'notes' | 'history' | 'searches';
type StatusFilter = 'all' | 'due' | StudyStatus;

const STATUS_STYLES: Record<StudyStatus, string> = {
  new: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  learning: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  known: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  ignored: 'bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-800 dark:text-zinc-500',
};

export interface DriveStudyState {
  status: 'idle' | 'loading' | 'done' | 'error';
  /** Books of Drive this device does not have, with their data. */
  books: DriveStudyBook[];
  error?: string;
}

interface Props {
  isOpen: boolean;
  recentBooks: RecentBook[];
  onClose: () => void;
  /** Opens a book of the shelf; with `search`, with that search made ("see it in the book"). */
  onOpenBook: (book: RecentBook, search?: string) => void;
  /** Sends to Drive the data of a book changed here (a favorite saved or removed). */
  onBookDataChange: (data: ReaderBookBackup) => void;
  /** Removes from this device the data of a book that is no longer on the shelf. */
  onDeleteBookData: (bookKey: string) => void;
  driveStudy: DriveStudyState;
  /** Reads from Drive the data of the books this device does not have; absent without a Google session. */
  onLoadDriveStudyBooks?: () => void;
}

const PAGE_SIZE = 100;

const matches = (query: string, ...texts: (string | undefined)[]): boolean => {
  const normalized = normalizeSearchQuery(query);
  return !normalized || texts.some((text) => text && normalizeSearchQuery(text).includes(normalized));
};

/** A text with the first appearance of a word in bold. */
const highlight = (text: string, words: string[]): React.ReactNode => {
  for (const word of words) {
    const at = word ? text.indexOf(word) : -1;
    if (at >= 0) {
      return <>{text.slice(0, at)}<mark className="bg-transparent font-bold text-inherit">{word}</mark>{text.slice(at + word.length)}</>;
    }
  }
  return text;
};

const kindOf = (t: Translate) => (entry: { kind: Parameters<typeof getKindLabel>[0]['kind']; provider?: string }) => getKindLabel(entry, t);

/**
 * The vocabulary, notes, history and lookups of every book read on this device, put together: what was
 * learnt over many books, to review and export without opening each one.
 */
export const StudyDashboard: React.FC<Props> = ({
  isOpen,
  recentBooks,
  onClose,
  onOpenBook,
  onBookDataChange,
  onDeleteBookData,
  driveStudy,
  onLoadDriveStudyBooks,
}) => {
  const t = useT();
  const language = useLanguage();
  const translationLanguage = useTranslationLanguage();
  const dictionaryOptions = useDictionaryOptions();
  // Meanings looked up here for the most consulted words that no history entry explains.
  const [lookupResults, setLookupResults] = useState<Record<string, DictionaryLookup | string>>({});
  const wordLevels = useWordLevels();
  const [tab, setTab] = useState<Tab>('summary');
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [bookFilter, setBookFilter] = useState('');
  const [sort, setSort] = useState<VocabularySort>('recent');
  const [onlyWithNote, setOnlyWithNote] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // What is known of each word; read again whenever the dashboard opens (Drive may have brought changes).
  const [progress, setProgress] = useState<StudyProgress>(readStudyProgress);
  useEffect(() => {
    if (isOpen) setProgress(readStudyProgress());
  }, [isOpen]);
  const updateProgress = (update: (current: StudyProgress) => StudyProgress) => {
    setProgress((current) => {
      const next = update(current);
      writeStudyProgress(next);
      return next;
    });
  };

  const shelf = useMemo(() => new Map(recentBooks.map((book) => [bookKeyOf(book.title, book.creator), book])), [recentBooks]);

  // Read again every time the dashboard opens: the books may have changed since.
  const data: StudyData | null = useMemo(() => {
    if (!isOpen) return null;
    const known = [
      ...recentBooks.map((book) => ({ bookKey: bookKeyOf(book.title, book.creator), title: book.title, creator: book.creator })),
      ...driveStudy.books.map(({ bookKey, title, creator }) => ({ bookKey, title, creator, fromDrive: true })),
    ];
    // What Drive has of other books is only read, never written to this device.
    const storage = withEntries(localStorage, Object.assign({}, ...driveStudy.books.map((book) => book.entries)));
    return collectStudyData(storage, listStoredBooks(storage, known), new Set(shelf.keys()));
    // `revision` reads the data again after deleting a book's data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, recentBooks, shelf, revision, driveStudy.books]);

  useEffect(() => {
    setShown(PAGE_SIZE);
    setExpanded(null);
    setExportMenuOpen(false);
  }, [tab, query, bookFilter, sort, onlyWithNote, statusFilter]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const inBook = (books: { bookKey: string }[]) => !bookFilter || books.some((book) => book.bookKey === bookFilter);

  // The favorites of each book of this device, to show which entries are saved.
  const favoritesByBook = useMemo(() => {
    const result = new Map<string, TranslationFavorite[]>();
    if (!data) return result;
    for (const book of data.books) {
      if (!book.fromDrive) result.set(book.bookKey, readTranslationFavorites(`${book.bookKey}_translation_favorites`));
    }
    return result;
  }, [data]);

  // The latest dictionary answer of each query, to give the most consulted words their meaning.
  const historyByQuery = useMemo(() => {
    const result = new Map<string, { book: BookRef; entry: TranslationHistoryEntry }>();
    for (const item of data?.history ?? []) {
      const key = normalizeFrequentQuery(item.entry.query);
      const known = result.get(key);
      if (!known || (!known.entry.data && item.entry.data)) result.set(key, item);
    }
    return result;
  }, [data]);

  const vocabulary = useMemo(() => (data
    ? sortVocabulary(data.vocabulary, sort).filter((item) => inBook(item.books)
      && (statusFilter === 'all'
        || (statusFilter === 'due' ? isDue(progress.cards[item.key], Date.now()) : statusOf(progress.cards[item.key]) === statusFilter))
      && matches(query, item.word, item.reading, item.favorite.query, getHistoryEntryResponse(item.favorite, language),
        ...item.contexts.map((context) => context.text)))
    : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data, sort, query, bookFilter, language, statusFilter, progress]);

  // New words are taken oldest first: in the order they were met while reading.
  const reviewItems = useMemo(() => (data ? [...data.vocabulary].sort((a, b) => a.firstSavedAt - b.firstSavedAt) : []), [data]);
  const reviewCounts = useMemo(() => {
    const queue = reviewQueue(reviewItems.map((item) => item.key), progress, Date.now());
    return { ...countStatuses(reviewItems.map((item) => item.key), progress, Date.now()), toReview: queue.due.length + queue.fresh.length };
  }, [reviewItems, progress]);

  const chapterLabel = (spineIndex: number) => `${t('common.chapter')} ${spineIndex + 1}`;
  const notes = useMemo(() => (data
    ? data.notes.filter((note) => inBook([note.book]) && (!onlyWithNote || note.annotation.note)
      && matches(query, note.annotation.quote, note.annotation.note, note.book.title))
    : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data, onlyWithNote, query, bookFilter]);

  const history = useMemo(() => (data
    ? data.history.filter((item) => inBook([item.book]) && matches(query, item.entry.query, getHistoryEntryResponse(item.entry, language)))
    : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data, query, bookFilter, language]);

  const lookups = useMemo(() => (data ? data.lookups.filter((item) => inBook(item.books) && matches(query, item.query)) : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data, query, bookFilter]);
  const textSearches = useMemo(() => (data ? data.textSearches.filter((item) => inBook(item.books) && matches(query, item.query)) : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data, query, bookFilter]);

  if (!isOpen || !data) return null;

  const bookTitle = bookFilter ? data.books.find((book) => book.bookKey === bookFilter)?.title ?? '' : t('study.allBooks');

  const save = async (suffix: string, extension: string, content: string, mime: string) => {
    setExportMenuOpen(false);
    setExportFailed(false);
    try {
      await saveTextFile(exportFileName(bookFilter ? bookTitle : 'Yomisuba', suffix, extension), content, mime, t('export.shareTitle'));
    } catch (error) {
      // Cancelling the share sheet is not a failure.
      if (!(error instanceof Error && /cancel/i.test(error.message))) setExportFailed(true);
    }
  };

  const vocabularyLabels = {
    word: t('export.colWord'),
    reading: t('export.colReading'),
    meaning: t('export.colMeaning'),
    type: t('export.colType'),
    books: t('study.colBooks'),
    lookups: t('study.colLookups'),
    firstSaved: t('study.colFirstSaved'),
    context: t('study.colContext'),
    kind: kindOf(t),
  };

  const exportOptions: { label: string; run: () => Promise<void> }[] = tab === 'vocabulary' && vocabulary.length
    ? [
      { label: t('study.exportAnki'), run: () => save(t('study.fileVocabulary'), 'txt', vocabularyToAnki(vocabulary), 'text/plain') },
      { label: t('history.exportCsv'), run: () => save(t('study.fileVocabulary'), 'csv', vocabularyToCsv(vocabulary, vocabularyLabels), 'text/csv') },
      { label: t('history.exportMarkdown'), run: () => save(t('study.fileVocabulary'), 'md', vocabularyToMarkdown(`${t('study.tabVocabulary')} · ${bookTitle}`, vocabulary, vocabularyLabels, language), 'text/markdown') },
    ]
    : tab === 'notes' && notes.length
      ? [
        { label: t('study.exportNotesAnki'), run: () => save(t('study.fileNotes'), 'txt', notesToAnki(notes, chapterLabel), 'text/plain') },
        { label: t('study.exportNotes'), run: () => save(t('study.fileNotes'), 'md', notesToMarkdown(`${t('study.tabNotes')} · ${bookTitle}`, notes, chapterLabel), 'text/markdown') },
      ]
      : tab === 'history' && history.length
        ? [{
          label: t('study.exportHistory'),
          run: () => save(t('study.fileHistory'), 'csv', historyToCsv(history, {
            date: t('export.colDate'),
            query: t('study.colQuery'),
            type: t('export.colType'),
            answer: t('study.colAnswer'),
            book: t('study.colBook'),
            kind: kindOf(t),
          }, language), 'text/csv'),
        }]
        : [];

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'summary', label: t('study.tabSummary'), icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { id: 'review', label: t('study.tabReview'), icon: <Repeat className="h-3.5 w-3.5" />, count: reviewCounts.toReview },
    { id: 'vocabulary', label: t('study.tabVocabulary'), icon: <Star className="h-3.5 w-3.5" />, count: data.vocabulary.length },
    { id: 'notes', label: t('study.tabNotes'), icon: <NotebookPen className="h-3.5 w-3.5" />, count: data.notes.length },
    { id: 'history', label: t('study.tabHistory'), icon: <Clock className="h-3.5 w-3.5" />, count: data.history.length },
    { id: 'searches', label: t('study.tabSearches'), icon: <Search className="h-3.5 w-3.5" />, count: data.lookups.length },
  ];

  const localBook = (bookKey: string) => data.books.find((book) => book.bookKey === bookKey && !book.fromDrive);

  /** Saves or removes a favorite in a book, as the star of the reader does, and sends the book to Drive. */
  const toggleFavorite = (bookKey: string, candidate: TranslationFavoriteCandidate) => {
    const book = localBook(bookKey);
    if (!book) return;
    onBookDataChange(toggleBookFavorite(book, candidate));
    setRevision((value) => value + 1);
  };

  const isFavorite = (bookKey: string, candidate: TranslationFavoriteCandidate) =>
    isTranslationFavorite(favoritesByBook.get(bookKey) ?? [], candidate);

  /** A word of the vocabulary out of the favorites of every book it was saved in. */
  const unfavoriteWord = (item: (typeof data.vocabulary)[number]) => {
    const books = item.books.map((book) => localBook(book.bookKey)).filter((book): book is NonNullable<typeof book> => Boolean(book));
    if (books.length > 1 && !window.confirm(t('study.confirmUnfavorite', { word: item.word, count: books.length }))) return;
    for (const book of books) onBookDataChange(removeBookFavorites(book, (favorite) => vocabularyKey(favorite) === item.key));
    setRevision((value) => value + 1);
  };

  const historyCandidate = (entry: TranslationHistoryEntry): TranslationFavoriteCandidate => ({
    query: entry.query,
    kind: entry.kind,
    ...(entry.provider ? { provider: entry.provider } : {}),
    response: getHistoryEntryResponse(entry, language),
    ...(entry.data ? { data: entry.data } : {}),
  });

  /** The first book of a list that is on the shelf, to open it. */
  const shelfBookOf = (books: { bookKey: string }[]) => books.map((book) => shelf.get(book.bookKey)).find(Boolean);

  const starButton = (on: boolean, toggle: () => void) => (
    <button
      type="button"
      onClick={toggle}
      className={`tap-area shrink-0 rounded-lg p-2 ${on ? 'text-amber-500' : 'text-zinc-400 hover:text-amber-500'}`}
      aria-label={on ? t('glossary.removeFav') : t('glossary.addFav')}
      title={on ? t('glossary.removeFav') : t('glossary.addFav')}
      aria-pressed={on}
    >
      <Star className={`h-4 w-4 ${on ? 'fill-current' : ''}`} />
    </button>
  );

  const openInBookButton = (books: { bookKey: string }[], text: string) => {
    const book = shelfBookOf(books);
    if (!book || !text.trim()) return null;
    return (
      <button
        type="button"
        onClick={() => onOpenBook(book, text)}
        className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <BookOpen className="h-3.5 w-3.5" /> {t('study.seeInBook')}
      </button>
    );
  };

  /** Looks up in the dictionary a consulted word no history entry explains. */
  const lookUp = (key: string, query: string) => {
    if (key in lookupResults) return;
    setLookupResults((current) => ({ ...current, [key]: '' }));
    void getDictionarySearchTerms(query, translationLanguage, dictionaryOptions)
      .then((result) => setLookupResults((current) => ({ ...current, [key]: result })))
      .catch((error: unknown) => setLookupResults((current) => ({ ...current, [key]: error instanceof Error ? error.message : String(error) })));
  };

  const isEmpty = data.books.every((book) => !book.favorites && !book.underlines && !book.lookups) && !data.history.length;
  const more = (total: number) => total > shown && (
    <button
      type="button"
      onClick={() => setShown((count) => count + PAGE_SIZE)}
      className="mt-2 w-full rounded-xl py-2.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
    >
      {t('study.moreResults', { count: total - shown })}
    </button>
  );
  const bookChips = (books: { bookKey: string; title: string }[]) => (
    <span className="mt-1 flex flex-wrap gap-1">
      {books.map((book) => (
        <span key={book.bookKey} className="max-w-[12rem] truncate rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {book.title}
        </span>
      ))}
    </span>
  );

  const renderDrive = () => {
    if (!onLoadDriveStudyBooks) {
      return <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('study.driveSignIn')}</p>;
    }
    const busy = driveStudy.status === 'loading';
    return (
      <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900/60 dark:bg-sky-950/30">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-xs text-sky-900 dark:text-sky-200">
            {driveStudy.status === 'done'
              ? t('study.driveIncluded', { count: driveStudy.books.length })
              : busy ? t('study.driveLoading') : t('study.driveHint')}
          </p>
          <button
            type="button"
            onClick={onLoadDriveStudyBooks}
            disabled={busy}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : driveStudy.status === 'done' ? <RefreshCw className="h-3.5 w-3.5" /> : <CloudDownload className="h-3.5 w-3.5" />}
            {t(driveStudy.status === 'done' ? 'study.driveRefresh' : 'study.driveLoad')}
          </button>
        </div>
        {driveStudy.status === 'error' && (
          <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">{t('study.driveError', { message: driveStudy.error ?? '' })}</p>
        )}
      </div>
    );
  };

  const renderSummary = () => {
    const months = wordsPerMonth(data.vocabulary, 12);
    const peak = Math.max(1, ...months.map((month) => month.count));
    const tiles = [
      { label: t('study.statBooks'), value: data.books.length },
      { label: t('study.statWords'), value: data.vocabulary.length },
      { label: t('study.statNotes'), value: data.notes.filter((note) => note.annotation.note).length },
      { label: t('study.statLookups'), value: data.lookups.reduce((sum, item) => sum + item.count, 0) },
      { label: t('study.statDue'), value: reviewCounts.toReview },
      { label: t('study.statKnown'), value: reviewCounts.known },
    ];
    return (
      <div className="space-y-5">
        {renderDrive()}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/30">
              <div className="text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{tile.value.toLocaleString(language)}</div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{tile.label}</div>
            </div>
          ))}
        </div>

        <section>
          <h3 className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t('study.perMonth')}</h3>
          <div className="flex h-24 items-end gap-1" role="img" aria-label={months.map((month) => `${month.month}: ${month.count}`).join(', ')}>
            {months.map((month) => (
              <div key={month.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${month.month}: ${month.count}`}>
                <span className="text-[9px] tabular-nums text-zinc-500 dark:text-zinc-400">{month.count || ''}</span>
                <div className="w-full rounded-t bg-indigo-500 dark:bg-indigo-400" style={{ height: `${(month.count / peak) * 70}%`, minHeight: month.count ? 3 : 1, opacity: month.count ? 1 : 0.2 }} />
                <span className="text-[9px] text-zinc-500 dark:text-zinc-400">{month.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t('study.booksHeading')}</h3>
          <ul className="space-y-2">
            {data.books.map((book) => {
              const recent = shelf.get(book.bookKey);
              return (
                <li key={book.bookKey} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{book.title}</p>
                      <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                        {[book.creator, book.fromDrive ? t('study.onlyInDrive') : !book.onShelf ? t('study.notOnShelf') : ''].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {recent ? (
                      <button type="button" onClick={() => onOpenBook(recent)} className="tap-area inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40">
                        <BookOpen className="h-3.5 w-3.5" /> {t('study.open')}
                      </button>
                    ) : !book.fromDrive && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm(t('study.confirmDeleteData', { title: book.title }))) return;
                          onDeleteBookData(book.bookKey);
                          setRevision((value) => value + 1);
                        }}
                        className="tap-area inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> {t('study.deleteData')}
                      </button>
                    )}
                  </div>
                  {book.progress !== null && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${book.progress}%` }} />
                      </div>
                      <span className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">{t('study.progress', { percent: book.progress })}</span>
                    </div>
                  )}
                  <p className="mt-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                    {t('study.bookCounts', { favorites: book.favorites, notes: book.notes, underlines: book.underlines, lookups: book.lookups })}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('study.dataNote')}</p>
      </div>
    );
  };

  const statusLabel = (key: string): string => {
    const card = progress.cards[key];
    const status = statusOf(card);
    if (status === 'learning' || status === 'known') {
      const now = Date.now();
      const when = card && card.due > now ? formatDue(card.due, now, language) : '';
      return when ? t('study.statusNext', { status: t(`study.status_${status}`), when }) : t('study.statusDueNow');
    }
    return t(`study.status_${status}`);
  };

  const renderCardActions = (key: string, extra?: React.ReactNode) => {
    const card = progress.cards[key];
    const status = statusOf(card);
    const action = (label: string, icon: React.ReactNode, run: () => void) => (
      <button
        type="button"
        onClick={run}
        className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {icon} {label}
      </button>
    );
    const now = Date.now();
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {extra}
        {status !== 'known' && action(t('study.markKnown'), <Check className="h-3.5 w-3.5" />, () => updateProgress((current) => setCard(current, key, markKnown(current.cards[key], now))))}
        {status === 'ignored'
          ? action(t('study.unignore'), <RotateCcw className="h-3.5 w-3.5" />, () => updateProgress((current) => setCard(current, key, resetCard(now))))
          : action(t('study.ignore'), <EyeOff className="h-3.5 w-3.5" />, () => updateProgress((current) => setCard(current, key, markIgnored(current.cards[key], now))))}
        {status !== 'new' && status !== 'ignored' && action(t('study.reset'), <RotateCcw className="h-3.5 w-3.5" />, () => updateProgress((current) => setCard(current, key, resetCard(now))))}
      </div>
    );
  };

  const renderVocabulary = () => (
    <>
      <ul className="space-y-2">
        {vocabulary.slice(0, shown).map((item) => {
          const isExpanded = expanded === item.key;
          return (
            <li key={item.key} className="flex items-start gap-1 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-800/30">
              <div className="min-w-0 flex-1">
              <button type="button" onClick={() => setExpanded(isExpanded ? null : item.key)} className="w-full text-left">
                <span className="flex flex-wrap items-center gap-2">
                  <span lang="ja" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{item.word}</span>
                  {item.reading && item.reading !== item.word && <span lang="ja" className="text-xs text-zinc-500 dark:text-zinc-400">{item.reading}</span>}
                  {wordLevels && item.favorite.data && <WordLevelBadge level={classifyWord(wordLevels, item.word)} />}
                  {item.kinds.map((kind) => (
                    <span key={kind} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                      {getKindLabel({ kind, provider: item.favorite.provider }, t)}
                    </span>
                  ))}
                  {item.lookups > 0 && (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      {item.lookups} {t('history.queries')}
                    </span>
                  )}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLES[statusOf(progress.cards[item.key])]}`}>
                    {statusLabel(item.key)}
                  </span>
                </span>
                <span className={`mt-1 block whitespace-pre-line text-xs text-zinc-600 dark:text-zinc-300 ${isExpanded ? '' : 'line-clamp-2'}`}>
                  {isExpanded ? getHistoryEntryResponse(item.favorite, language) : favoriteFields(item.favorite).meaning}
                </span>
                {item.contexts.slice(0, isExpanded ? undefined : 1).map((context) => (
                  <span key={context.text} lang="ja" className="mt-1.5 block border-l-2 border-amber-300 pl-2 text-xs text-zinc-700 dark:border-amber-600 dark:text-zinc-300">
                    {highlight(context.text, [item.word, item.favorite.query])}
                    {isExpanded && item.books.length > 1 && <span className="ml-1 text-[10px] text-zinc-500 dark:text-zinc-400">— {context.book.title}</span>}
                  </span>
                ))}
                {bookChips(item.books)}
              </button>
              {isExpanded && renderCardActions(item.key, openInBookButton(item.books, item.favorite.query))}
              </div>
              {item.books.some((book) => localBook(book.bookKey)) && starButton(true, () => unfavoriteWord(item))}
            </li>
          );
        })}
      </ul>
      {more(vocabulary.length)}
    </>
  );

  const renderNotes = () => (
    <>
      <ul className="space-y-2">
        {notes.slice(0, shown).map((note) => (
          <li key={`${note.book.bookKey}:${note.annotation.id}`} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <blockquote lang="ja" className="border-l-2 border-amber-400 pl-2 text-sm text-zinc-800 dark:text-zinc-200">{note.annotation.quote}</blockquote>
            {note.annotation.note && <p className="mt-1.5 whitespace-pre-line text-xs text-zinc-700 dark:text-zinc-300">{note.annotation.note}</p>}
            <p className="mt-1.5 truncate text-[10px] text-zinc-500 dark:text-zinc-400">{note.book.title} · {chapterLabel(note.annotation.spineIndex)}</p>
            <div className="mt-1.5">{openInBookButton([note.book], note.annotation.quote)}</div>
          </li>
        ))}
      </ul>
      {more(notes.length)}
    </>
  );

  const renderHistory = () => (
    <>
      <ul className="space-y-2">
        {history.slice(0, shown).map(({ book, entry }) => {
          const id = `${book.bookKey}:${entry.id}`;
          const isExpanded = expanded === id;
          const candidate = historyCandidate(entry);
          return (
            <li key={id} className="flex items-start gap-1 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="min-w-0 flex-1">
              <button type="button" onClick={() => setExpanded(isExpanded ? null : id)} className="w-full text-left">
                <span className="flex flex-wrap items-center gap-2">
                  <span lang="ja" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{entry.query}</span>
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{getKindLabel(entry, t)}</span>
                </span>
                <span className={`mt-1 block whitespace-pre-line text-xs text-zinc-600 dark:text-zinc-300 ${isExpanded ? '' : 'line-clamp-2'}`}>
                  {isExpanded
                    ? getHistoryEntryResponse(entry, language)
                    : favoriteFields({ ...entry, savedAt: entry.queriedAt, response: entry.response ?? '' }).meaning}
                </span>
                <span className="mt-1 block truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                  {new Date(entry.queriedAt).toLocaleString(language)} · {book.title}
                </span>
              </button>
              {isExpanded && <div className="mt-1.5">{openInBookButton([book], entry.query)}</div>}
              </div>
              {localBook(book.bookKey) && starButton(isFavorite(book.bookKey, candidate), () => toggleFavorite(book.bookKey, candidate))}
            </li>
          );
        })}
      </ul>
      {more(history.length)}
    </>
  );

  const renderSearches = () => (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t('study.mostLooked')}</h3>
        <ul className="space-y-1.5">
          {lookups.slice(0, shown).map((item) => {
            const id = `lookup:${item.key}`;
            const isExpanded = expanded === id;
            const known = historyByQuery.get(item.key);
            const looked = lookupResults[item.key];
            // The answer of the history if there is one; else what the dictionary says, looked up on request.
            const candidate: TranslationFavoriteCandidate | null = known
              ? historyCandidate(known.entry)
              : looked && typeof looked !== 'string' && looked.entries.length
                ? { query: item.query, kind: 'dictionary', ...buildDictionaryHistoryResponse(looked.baseForm, looked.searchTerms, looked.entries.slice(0, 3)) }
                : null;
            const target = (known && localBook(known.book.bookKey)) ? known.book : item.books.find((book) => localBook(book.bookKey));
            const meaning = candidate ? favoriteFields({ ...candidate, id: '', savedAt: 0 }).meaning : '';
            return (
              <li key={item.key} className="flex items-start gap-1 rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded(isExpanded ? null : id);
                      if (!known) lookUp(item.key, item.query);
                    }}
                    className="w-full text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span lang="ja" className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.query}</span>
                      <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        {item.count} {t('history.queries')}
                      </span>
                    </span>
                    {meaning ? (
                      <span className={`mt-1 block whitespace-pre-line text-xs text-zinc-600 dark:text-zinc-300 ${isExpanded ? '' : 'line-clamp-2'}`}>
                        {isExpanded && candidate ? (candidate.data ? getHistoryEntryResponse(candidate, language) : candidate.response) : meaning}
                      </span>
                    ) : looked === '' ? (
                      <span className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" /> {t('translate.dictionary')}</span>
                    ) : looked !== undefined ? (
                      <span className="mt-1 block text-[11px] text-zinc-400">{typeof looked === 'string' ? looked : t('glossary.noDefinition')}</span>
                    ) : (
                      <span className="mt-1 block text-[11px] text-indigo-600 dark:text-indigo-400">{t('study.tapForMeaning')}</span>
                    )}
                    {bookChips(item.books)}
                  </button>
                  {isExpanded && <div className="mt-1.5">{openInBookButton(item.books, item.query)}</div>}
                </div>
                {candidate && target && starButton(isFavorite(target.bookKey, candidate), () => toggleFavorite(target.bookKey, candidate))}
              </li>
            );
          })}
        </ul>
        {more(lookups.length)}
      </section>
      {textSearches.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t('study.textSearches')}</h3>
          <ul className="space-y-1.5">
            {textSearches.map((item) => (
              <li key={item.query} className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span lang="ja" className="text-sm text-zinc-900 dark:text-zinc-100">{item.query}</span>
                    {bookChips(item.books)}
                  </span>
                  <span className="shrink-0">{openInBookButton(item.books, item.query)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );

  const listEmpty = (tab === 'vocabulary' && !vocabulary.length) || (tab === 'notes' && !notes.length)
    || (tab === 'history' && !history.length) || (tab === 'searches' && !lookups.length && !textSearches.length);

  // In a portal: the home card blurs what is behind it, which would confine a fixed element to the card.
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-title"
        className="flex h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white text-left shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:h-[88vh] sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex min-w-0 items-center gap-2">
            <GraduationCap className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
            <h2 id="study-title" className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('study.title')}</h2>
          </div>
          <button type="button" onClick={onClose} className="tap-area rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={t('nav.close')}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div role="tablist" aria-label={t('study.title')} className="flex gap-1 overflow-x-auto border-b border-zinc-200 p-2 dark:border-zinc-800">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium ${
                tab === item.id
                  ? 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              {item.icon}
              {item.label}
              {item.count !== undefined && <span className="text-[10px] opacity-70">({item.count})</span>}
            </button>
          ))}
        </div>

        {tab !== 'summary' && tab !== 'review' && !isEmpty && (
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/80">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('common.search')}
              aria-label={t('common.search')}
              className="min-h-9 min-w-0 flex-1 basis-40 rounded-lg border border-zinc-300 bg-white px-2.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <select
              value={bookFilter}
              onChange={(event) => setBookFilter(event.target.value)}
              aria-label={t('study.colBook')}
              className="min-h-9 max-w-[11rem] rounded-lg border border-zinc-300 bg-white px-2 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              <option value="">{t('study.allBooks')}</option>
              {data.books.map((book) => <option key={book.bookKey} value={book.bookKey}>{book.title}</option>)}
            </select>
            {tab === 'vocabulary' && (
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                aria-label={t('study.statusLabel')}
                className="min-h-9 rounded-lg border border-zinc-300 bg-white px-2 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                <option value="all">{t('study.statusAll')}</option>
                <option value="due">{t('study.statusDue')}</option>
                <option value="new">{t('study.status_new')}</option>
                <option value="learning">{t('study.status_learning')}</option>
                <option value="known">{t('study.status_known')}</option>
                <option value="ignored">{t('study.status_ignored')}</option>
              </select>
            )}
            {tab === 'vocabulary' && (
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as VocabularySort)}
                aria-label={t('study.sortLabel')}
                className="min-h-9 rounded-lg border border-zinc-300 bg-white px-2 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                <option value="recent">{t('study.sortRecent')}</option>
                <option value="lookups">{t('study.sortLookups')}</option>
                <option value="books">{t('study.sortBooks')}</option>
                <option value="word">{t('study.sortWord')}</option>
              </select>
            )}
            {tab === 'notes' && (
              <label className="flex min-h-9 items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={onlyWithNote} onChange={(event) => setOnlyWithNote(event.target.checked)} />
                {t('study.onlyWithNote')}
              </label>
            )}
            {exportOptions.length > 0 && (
              <div className="relative ml-auto">
                <button
                  type="button"
                  onClick={() => setExportMenuOpen((open) => !open)}
                  aria-expanded={exportMenuOpen}
                  className="tap-area inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                >
                  <Download className="h-3.5 w-3.5" /> {t('history.export')}
                </button>
                {exportMenuOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white text-left shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    {exportOptions.map((option, index) => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => { void option.run(); }}
                        className={`block w-full px-3 py-2.5 text-left text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800 ${index ? 'border-t border-zinc-100 dark:border-zinc-800' : ''}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {exportFailed && <p role="alert" className="px-4 pt-2 text-xs text-rose-600 dark:text-rose-400">{t('export.failed')}</p>}

        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-3">
          {isEmpty ? (
            <div className="space-y-4">
              {renderDrive()}
              <p className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">{t('study.empty')}</p>
            </div>
          ) : tab === 'summary' ? renderSummary()
            : tab === 'review' ? (
              <StudyReview
                items={reviewItems}
                progress={progress}
                onAnswer={(key: string, grade: Grade) => updateProgress((current) => answer(current, key, grade, Date.now()))}
                onChangeNewPerDay={(count) => updateProgress((current) => ({ ...current, newPerDay: count, settingsUpdatedAt: Date.now() }))}
                onMark={(key, how) => updateProgress((current) => setCard(current, key, how === 'known' ? markKnown(current.cards[key], Date.now()) : markIgnored(current.cards[key], Date.now())))}
                onSeeInBook={(item) => {
                  const book = shelfBookOf(item.books);
                  if (book) onOpenBook(book, item.favorite.query);
                }}
                canSeeInBook={(item) => Boolean(shelfBookOf(item.books))}
              />
            )
            : listEmpty ? <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">{t('study.noResults')}</p>
              : tab === 'vocabulary' ? renderVocabulary()
                : tab === 'notes' ? renderNotes()
                  : tab === 'history' ? renderHistory()
                    : renderSearches()}
        </div>
      </section>
    </div>,
    document.body,
  );
};
