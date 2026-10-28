import { bookPage, latestPaginationCounts } from './driveDevice';
import { FREQUENT_QUERIES_VERSION, FrequentQuery, normalizeFrequentQuery } from './frequentQueries';
import { normalizeNote, TextAnnotation } from './textAnnotations';
import type { TranslationFavorite } from './translationFavorites';
import type { DictionaryHistoryData, TranslationHistoryEntry } from './translationHistory';

/**
 * What every book keeps in this device's storage, after `yomisuba_book_<title|creator>`. Longest first, so
 * that a key is matched by its whole suffix ("_frequent_queries_version" before "_frequent_queries").
 */
export const BOOK_DATA_SUFFIXES = [
  'frequent_queries_version',
  'translation_favorites',
  'translation_history',
  'frequent_queries',
  'recent_searches',
  'printed_pages',
  'annotations',
  'pagination',
  'bookmark',
  'position',
] as const;

const BOOK_KEY_PREFIX = 'yomisuba_book_';

type StorageLike = Pick<Storage, 'getItem' | 'key' | 'length'>;

export interface StoredBook {
  bookKey: string;
  title: string;
  creator: string;
}

export const bookKeyOf = (title: string, creator: string): string =>
  `${BOOK_KEY_PREFIX}${encodeURIComponent(`${title}|${creator}`)}`;

/**
 * Every book this device has data of, on the shelf or not: the reader data stays when a book is removed.
 * `known` names the books whose title and creator are known for sure (a title may hold a "|").
 */
export function listStoredBooks(storage: StorageLike, known: StoredBook[] = []): StoredBook[] {
  const byKey = new Map(known.map((book) => [book.bookKey, book]));
  const found = new Map<string, StoredBook>();
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(BOOK_KEY_PREFIX)) continue;
    const suffix = BOOK_DATA_SUFFIXES.find((candidate) => key.endsWith(`_${candidate}`));
    if (!suffix) continue;
    const bookKey = key.slice(0, -(suffix.length + 1));
    if (found.has(bookKey)) continue;
    const knownBook = byKey.get(bookKey);
    if (knownBook) {
      found.set(bookKey, knownBook);
      continue;
    }
    try {
      const identity = decodeURIComponent(bookKey.slice(BOOK_KEY_PREFIX.length));
      const separator = identity.indexOf('|');
      if (separator < 0) continue;
      found.set(bookKey, { bookKey, title: identity.slice(0, separator), creator: identity.slice(separator + 1) });
    } catch {
      // Not a key this app wrote.
    }
  }
  return [...found.values()];
}

/** Every key of a book's data, to remove it all. */
export const bookDataKeys = (bookKey: string): string[] => BOOK_DATA_SUFFIXES.map((suffix) => `${bookKey}_${suffix}`);

const readArray = (storage: StorageLike, key: string): unknown[] => {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) || 'null');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const isDictionaryData = (value: unknown): value is DictionaryHistoryData => Boolean(
  value && typeof value === 'object'
  && typeof (value as DictionaryHistoryData).baseForm === 'string'
  && Array.isArray((value as DictionaryHistoryData).searchTerms)
  && Array.isArray((value as DictionaryHistoryData).entries),
);

const FAVORITE_KINDS = ['dictionary', 'translation', 'ai', 'glossary'];

const readFavorites = (storage: StorageLike, bookKey: string): TranslationFavorite[] =>
  readArray(storage, `${bookKey}_translation_favorites`).filter((item): item is TranslationFavorite => {
    const favorite = item as TranslationFavorite;
    return Boolean(favorite && typeof favorite === 'object'
      && typeof favorite.id === 'string'
      && typeof favorite.savedAt === 'number' && Number.isFinite(favorite.savedAt)
      && typeof favorite.query === 'string'
      && FAVORITE_KINDS.includes(favorite.kind)
      && typeof favorite.response === 'string'
      && (favorite.data === undefined || isDictionaryData(favorite.data)));
  });

const readHistory = (storage: StorageLike, bookKey: string): TranslationHistoryEntry[] =>
  readArray(storage, `${bookKey}_translation_history`).filter((item): item is TranslationHistoryEntry => {
    const entry = item as TranslationHistoryEntry;
    return Boolean(entry && typeof entry === 'object'
      && typeof entry.id === 'string'
      && typeof entry.queriedAt === 'number' && Number.isFinite(entry.queriedAt)
      && typeof entry.query === 'string'
      && ['dictionary', 'translation', 'ai'].includes(entry.kind)
      && (typeof entry.response === 'string' || isDictionaryData(entry.data))
      && (entry.data === undefined || isDictionaryData(entry.data)));
  });

/** The counts of a book, only when they are of the current format (an older one is discarded on opening it). */
const readFrequent = (storage: StorageLike, bookKey: string): FrequentQuery[] => {
  if (storage.getItem(`${bookKey}_frequent_queries_version`) !== String(FREQUENT_QUERIES_VERSION)) return [];
  return readArray(storage, `${bookKey}_frequent_queries`).filter((item): item is FrequentQuery => {
    const query = item as FrequentQuery;
    return Boolean(query && typeof query === 'object'
      && typeof query.key === 'string' && typeof query.query === 'string'
      && Number.isInteger(query.count) && query.count > 0
      && typeof query.updatedAt === 'number' && Number.isFinite(query.updatedAt));
  });
};

const readAnnotations = (storage: StorageLike, bookKey: string): TextAnnotation[] =>
  readArray(storage, `${bookKey}_annotations`).flatMap((item) => {
    const annotation = item as TextAnnotation;
    if (!annotation || typeof annotation !== 'object' || typeof annotation.id !== 'string'
      || !Number.isInteger(annotation.spineIndex) || typeof annotation.quote !== 'string' || !annotation.quote) return [];
    const note = normalizeNote(annotation.note);
    return [{ id: annotation.id, spineIndex: annotation.spineIndex, quote: annotation.quote, prefix: '', suffix: '', ...(note ? { note } : {}) }];
  });

const readStrings = (storage: StorageLike, key: string): string[] =>
  readArray(storage, key).filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

const readProgress = (storage: StorageLike, bookKey: string): number | null => {
  try {
    const position: unknown = JSON.parse(storage.getItem(`${bookKey}_position`) || 'null');
    if (!position || typeof position !== 'object') return null;
    const { spineIndex, page, pageCount } = position as { spineIndex?: unknown; page?: unknown; pageCount?: unknown };
    if (typeof spineIndex !== 'number' || typeof page !== 'number') return null;
    const whole = bookPage(
      { spineIndex, page, pageCount: typeof pageCount === 'number' ? pageCount : undefined },
      latestPaginationCounts(storage.getItem(`${bookKey}_pagination`)),
    );
    return whole ? Math.round((whole.page / whole.total) * 100) : null;
  } catch {
    return null;
  }
};

const countBookmarks = (storage: StorageLike, bookKey: string): number => {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${bookKey}_bookmark`) || 'null');
    if (Array.isArray(parsed)) return parsed.length;
    return parsed && typeof parsed === 'object' ? 1 : 0;
  } catch {
    return 0;
  }
};

export interface BookRef {
  bookKey: string;
  title: string;
}

export interface BookSummary extends StoredBook {
  /** On this device's shelf; otherwise only its data is left. */
  onShelf: boolean;
  favorites: number;
  notes: number;
  underlines: number;
  bookmarks: number;
  lookups: number;
  /** How far the reading went, in percent, when this device knows the book's pages. */
  progress: number | null;
  lastActivity: number | null;
}

export interface VocabularyItem {
  key: string;
  word: string;
  reading: string;
  /** The latest favorite of the word, whose answer is shown. */
  favorite: TranslationFavorite;
  kinds: TranslationFavorite['kind'][];
  books: BookRef[];
  firstSavedAt: number;
  lastSavedAt: number;
  /** How many times it was looked up, in every book. */
  lookups: number;
}

export interface GlobalNote {
  book: BookRef;
  annotation: TextAnnotation;
}

export interface GlobalHistoryEntry {
  book: BookRef;
  entry: TranslationHistoryEntry;
}

export interface GlobalLookup {
  key: string;
  query: string;
  count: number;
  updatedAt: number;
  books: BookRef[];
}

export interface GlobalTextSearch {
  query: string;
  books: BookRef[];
}

export interface StudyData {
  books: BookSummary[];
  vocabulary: VocabularyItem[];
  notes: GlobalNote[];
  history: GlobalHistoryEntry[];
  lookups: GlobalLookup[];
  textSearches: GlobalTextSearch[];
}

/** The key that makes two favorites the same word: its base form and reading, or the text it asked about. */
export function vocabularyKey(favorite: TranslationFavorite): string {
  if (favorite.data) {
    return `word:${favorite.data.baseForm}|${favorite.data.entries[0]?.kana[0] ?? ''}`;
  }
  return `${favorite.kind}:${favorite.provider ?? ''}:${normalizeFrequentQuery(favorite.query)}`;
}

const addBook = (books: BookRef[], book: BookRef) => {
  if (!books.some((item) => item.bookKey === book.bookKey)) books.push(book);
};

/**
 * Everything the reader saved in every book, put together: the favorites joined by word (the same word
 * saved in three books is one word, found in three books), the notes, the history and the lookups.
 */
export function collectStudyData(
  storage: StorageLike,
  books: StoredBook[],
  shelfKeys: ReadonlySet<string> = new Set(),
): StudyData {
  const vocabulary = new Map<string, VocabularyItem>();
  const notes: GlobalNote[] = [];
  const history: GlobalHistoryEntry[] = [];
  const lookups = new Map<string, GlobalLookup>();
  const textSearches = new Map<string, GlobalTextSearch>();
  const summaries: BookSummary[] = [];

  for (const book of books) {
    const ref: BookRef = { bookKey: book.bookKey, title: book.title };
    const favorites = readFavorites(storage, book.bookKey);
    const annotations = readAnnotations(storage, book.bookKey);
    const entries = readHistory(storage, book.bookKey);
    const frequent = readFrequent(storage, book.bookKey);
    let lastActivity: number | null = null;
    const seen = (time: number) => { lastActivity = Math.max(lastActivity ?? 0, time); };

    for (const favorite of favorites) {
      seen(favorite.savedAt);
      const key = vocabularyKey(favorite);
      const existing = vocabulary.get(key);
      if (!existing) {
        vocabulary.set(key, {
          key,
          word: favorite.data?.baseForm || favorite.query,
          reading: favorite.data?.entries[0]?.kana[0] ?? '',
          favorite,
          kinds: [favorite.kind],
          books: [ref],
          firstSavedAt: favorite.savedAt,
          lastSavedAt: favorite.savedAt,
          lookups: 0,
        });
        continue;
      }
      if (!existing.kinds.includes(favorite.kind)) existing.kinds.push(favorite.kind);
      addBook(existing.books, ref);
      existing.firstSavedAt = Math.min(existing.firstSavedAt, favorite.savedAt);
      if (favorite.savedAt > existing.lastSavedAt) {
        existing.lastSavedAt = favorite.savedAt;
        existing.favorite = favorite;
      }
    }

    for (const annotation of annotations) notes.push({ book: ref, annotation });
    for (const entry of entries) {
      seen(entry.queriedAt);
      history.push({ book: ref, entry });
    }
    for (const query of frequent) {
      seen(query.updatedAt);
      const existing = lookups.get(query.key);
      if (!existing) {
        lookups.set(query.key, { key: query.key, query: query.query, count: query.count, updatedAt: query.updatedAt, books: [ref] });
        continue;
      }
      existing.count += query.count;
      if (query.updatedAt > existing.updatedAt) {
        existing.updatedAt = query.updatedAt;
        existing.query = query.query;
      }
      addBook(existing.books, ref);
    }
    for (const search of readStrings(storage, `${book.bookKey}_recent_searches`)) {
      const query = search.trim();
      const existing = textSearches.get(query);
      if (existing) addBook(existing.books, ref);
      else textSearches.set(query, { query, books: [ref] });
    }

    summaries.push({
      ...book,
      onShelf: shelfKeys.has(book.bookKey),
      favorites: favorites.length,
      notes: annotations.filter((annotation) => annotation.note).length,
      underlines: annotations.length,
      bookmarks: countBookmarks(storage, book.bookKey),
      lookups: frequent.reduce((sum, query) => sum + query.count, 0),
      progress: readProgress(storage, book.bookKey),
      lastActivity,
    });
  }

  // A word was looked up under its base form, under the text selected, or under any of its search terms.
  for (const item of vocabulary.values()) {
    const keys = new Set([item.word, item.favorite.query, ...(item.favorite.data?.searchTerms ?? [])]
      .map(normalizeFrequentQuery)
      .filter(Boolean));
    item.lookups = [...keys].reduce((sum, key) => sum + (lookups.get(key)?.count ?? 0), 0);
  }

  return {
    books: summaries.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || a.title.localeCompare(b.title)),
    vocabulary: [...vocabulary.values()].sort((a, b) => b.lastSavedAt - a.lastSavedAt),
    notes,
    history: history.sort((a, b) => b.entry.queriedAt - a.entry.queriedAt),
    lookups: [...lookups.values()].sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt),
    textSearches: [...textSearches.values()],
  };
}

export type VocabularySort = 'recent' | 'lookups' | 'books' | 'word';

export function sortVocabulary(items: VocabularyItem[], sort: VocabularySort): VocabularyItem[] {
  const sorted = [...items];
  if (sort === 'lookups') sorted.sort((a, b) => b.lookups - a.lookups || b.books.length - a.books.length || b.lastSavedAt - a.lastSavedAt);
  else if (sort === 'books') sorted.sort((a, b) => b.books.length - a.books.length || b.lookups - a.lookups || b.lastSavedAt - a.lastSavedAt);
  else if (sort === 'word') sorted.sort((a, b) => (a.reading || a.word).localeCompare(b.reading || b.word, 'ja'));
  else sorted.sort((a, b) => b.lastSavedAt - a.lastSavedAt);
  return sorted;
}

/** Words saved per month, the last `months` months up to `now`, oldest first. */
export function wordsPerMonth(items: VocabularyItem[], months: number, now = Date.now()): { month: string; count: number }[] {
  const end = new Date(now);
  const result: { month: string; count: number }[] = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const date = new Date(end.getFullYear(), end.getMonth() - back, 1);
    result.push({ month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, count: 0 });
  }
  const index = new Map(result.map((item, position) => [item.month, position]));
  for (const item of items) {
    const date = new Date(item.firstSavedAt);
    const position = index.get(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    if (position !== undefined) result[position].count += 1;
  }
  return result;
}
