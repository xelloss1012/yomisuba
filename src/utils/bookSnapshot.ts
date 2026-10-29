import { latestPaginationCounts } from './driveDevice';
import type { ReaderBookBackup, ReaderDataGroup } from './googleDriveBackup';
import {
  readTranslationFavorites,
  toggleTranslationFavorite,
  TranslationFavorite,
  TranslationFavoriteCandidate,
  writeTranslationFavorites,
} from './translationFavorites';

type StorageLike = Pick<Storage, 'getItem'>;

interface BookIdentity {
  bookKey: string;
  title: string;
  creator: string;
}

const readJson = (storage: StorageLike, key: string): unknown => {
  try {
    return JSON.parse(storage.getItem(key) || 'null');
  } catch {
    return null;
  }
};

const readList = <T>(storage: StorageLike, key: string): T[] => {
  const value = readJson(storage, key);
  if (Array.isArray(value)) return value as T[];
  // An old single bookmark was saved as one object.
  return value && typeof value === 'object' ? [value as T] : [];
};

/**
 * Everything this device keeps of a book, as the reader sends it to Drive: what is changed outside the
 * reader (from the vocabulary panel) goes up the same way, as a whole, so that a copy waiting to be sent
 * never stands for less than the book has.
 */
export function bookSnapshot(storage: StorageLike, book: BookIdentity, dirtyGroups: ReaderDataGroup[]): ReaderBookBackup {
  const { bookKey } = book;
  const position = readJson(storage, `${bookKey}_position`) as ReaderBookBackup['position'] | null;
  const printedPages = Number(storage.getItem(`${bookKey}_printed_pages`));
  const chapterPageCounts = latestPaginationCounts(storage.getItem(`${bookKey}_pagination`));
  const frequentVersion = Number(storage.getItem(`${bookKey}_frequent_queries_version`));
  const frequentQueries = readList<NonNullable<ReaderBookBackup['frequentQueries']>[number]>(storage, `${bookKey}_frequent_queries`);
  return {
    formatVersion: 1,
    bookKey,
    title: book.title,
    creator: book.creator,
    ...(position && typeof position === 'object' && typeof position.spineIndex === 'number' ? { position } : {}),
    ...(printedPages > 0 ? { printedPages } : {}),
    ...(chapterPageCounts ? { chapterPageCounts } : {}),
    bookmarks: readList(storage, `${bookKey}_bookmark`),
    annotations: readList(storage, `${bookKey}_annotations`),
    translationHistory: readList(storage, `${bookKey}_translation_history`),
    favorites: readList(storage, `${bookKey}_translation_favorites`),
    ...(frequentQueries.length && frequentVersion ? { frequentQueries, frequentQueriesVersion: frequentVersion } : {}),
    dirtyGroups,
  };
}

/**
 * Saves or removes a favorite of a book while the book is closed, as the star does in the reader, and
 * returns the book's data to send to Drive.
 */
export function toggleBookFavorite(book: BookIdentity, candidate: TranslationFavoriteCandidate): ReaderBookBackup {
  const storageKey = `${book.bookKey}_translation_favorites`;
  toggleTranslationFavorite(storageKey, readTranslationFavorites(storageKey), candidate);
  return bookSnapshot(localStorage, book, ['favorites']);
}

/** Removes the favorites of a book that match, and returns the book's data to send to Drive. */
export function removeBookFavorites(book: BookIdentity, matches: (favorite: TranslationFavorite) => boolean): ReaderBookBackup {
  const storageKey = `${book.bookKey}_translation_favorites`;
  writeTranslationFavorites(storageKey, readTranslationFavorites(storageKey).filter((favorite) => !matches(favorite)));
  return bookSnapshot(localStorage, book, ['favorites']);
}
