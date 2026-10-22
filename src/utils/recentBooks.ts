import { Capacitor } from '@capacitor/core';
import { tr } from './i18n';
import { nativeFiles } from './nativeFiles';
import { createNativeBookStore } from './nativeStorage';

export interface RecentBook {
  id: string;
  name: string;
  title: string;
  creator: string;
  lastOpened: number;
  blob: Blob;
  cover?: Blob;
  printedPages?: number;
  /** false for a book listed without its text (`blob` is then empty): `loadRecentBook` brings the text. */
  blobLoaded?: boolean;
}

/** Books shown on the home shelf; the local database itself keeps every book. */
export const MAX_SHELF_BOOKS = 200;

const DB_NAME = 'yomisuba_library';
const STORE_NAME = 'books';
const DB_VERSION = 2;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      } else {
        store = request.transaction!.objectStore(STORE_NAME);
      }
      if (!store.indexNames.contains('lastOpened')) {
        store.createIndex('lastOpened', 'lastOpened');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(tr('err.localOpen')));
  });
}

async function idbSaveBook(book: RecentBook): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(book);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(tr('err.localSave')));
  });
  db.close();
}

async function idbListBooks(limit = Number.MAX_SAFE_INTEGER): Promise<RecentBook[]> {
  const db = await openDatabase();
  const books = await new Promise<RecentBook[]>((resolve, reject) => {
    const results: RecentBook[] = [];
    const maxResults = Math.max(0, Math.floor(limit));
    if (!maxResults) {
      resolve(results);
      return;
    }
    const request = db
      .transaction(STORE_NAME, 'readonly')
      .objectStore(STORE_NAME)
      .index('lastOpened')
      .openCursor(null, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || results.length >= maxResults) {
        resolve(results);
        return;
      }
      results.push(cursor.value as RecentBook);
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error(tr('err.localRead')));
  });
  db.close();
  return books;
}

/**
 * Asks the browser not to clear this origin's storage when the device runs low (books and reading data
 * live there). It is a request: Chrome grants it by its own rules, so the answer is only informative.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

async function idbGetBook(id: string): Promise<RecentBook | null> {
  const db = await openDatabase();
  const book = await new Promise<RecentBook | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve((request.result as RecentBook | undefined) || null);
    request.onerror = () => reject(request.error || new Error(tr('err.localOpenBook')));
  });
  db.close();
  return book;
}

async function idbDeleteBook(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error(tr('err.localRemove')));
      transaction.onabort = () => reject(transaction.error || new Error(tr('err.localRemove')));
    });
  } finally {
    db.close();
  }
}

// --- Where the books are kept ------------------------------------------------------
//
// In the Android app the books live in the app's private files (see nativeStorage.ts), which survive
// the WebView clearing its own storage. A book that an earlier version left in IndexedDB is moved there
// the first time it is seen. On the web, IndexedDB is all there is.

const nativeBooks = Capacitor.isNativePlatform() ? createNativeBookStore(nativeFiles) : null;

export async function saveRecentBook(book: RecentBook): Promise<void> {
  if (nativeBooks) {
    try {
      await nativeBooks.save(book);
      await idbDeleteBook(book.id).catch(() => undefined); // an older copy there would only be stale
      return;
    } catch (error) {
      console.warn('No se pudo guardar el libro en el almacenamiento de la aplicación:', error);
      // A book listed without its text has nothing worth putting in IndexedDB.
      if (book.blobLoaded === false) throw error;
    }
  }
  await idbSaveBook(book);
}

export async function listRecentBooks(limit = Number.MAX_SAFE_INTEGER): Promise<RecentBook[]> {
  if (!nativeBooks) return idbListBooks(limit);
  const [stored, leftovers] = await Promise.all([
    nativeBooks.list().catch((error) => { console.warn('No se pudo leer el almacenamiento de la aplicación:', error); return [] as RecentBook[]; }),
    idbListBooks().catch(() => [] as RecentBook[]),
  ]);
  const known = new Set(stored.map((book) => book.id));
  return [...stored, ...leftovers.filter((book) => !known.has(book.id))]
    .sort((left, right) => right.lastOpened - left.lastOpened)
    .slice(0, Math.max(0, Math.floor(limit)));
}

export async function getRecentBook(id: string): Promise<RecentBook | null> {
  if (nativeBooks) {
    const stored = await nativeBooks.get(id).catch(() => null);
    if (stored) return stored;
  }
  return idbGetBook(id);
}

/** The book with its text, which a book from `listRecentBooks` may not have yet. */
export async function loadRecentBook(book: RecentBook): Promise<RecentBook> {
  if (book.blobLoaded !== false) return book;
  const full = await getRecentBook(book.id);
  if (!full) throw new Error(tr('err.localOpenBook'));
  return full;
}

export async function deleteRecentBook(id: string): Promise<void> {
  const results = await Promise.allSettled([
    nativeBooks ? nativeBooks.remove(id) : Promise.resolve(),
    idbDeleteBook(id),
  ]);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed && results.every((result) => result.status === 'rejected')) throw failed.reason;
  try {
    if (localStorage.getItem('yomisuba_last_book_id') === id) {
      localStorage.removeItem('yomisuba_last_book_id');
    }
  } catch {
    // The recent-book entry is removed even if the startup preference cannot be updated.
  }
}

/** Moves the books an earlier version kept in IndexedDB into the app's own storage. */
export async function migrateBooksToNativeStorage(): Promise<void> {
  if (!nativeBooks) return;
  const inDatabase = await idbListBooks().catch(() => [] as RecentBook[]);
  if (inDatabase.length === 0) return;
  const stored = new Set((await nativeBooks.list().catch(() => [] as RecentBook[])).map((book) => book.id));
  for (const book of inDatabase) {
    try {
      if (!stored.has(book.id)) await nativeBooks.save(book);
      // Only once it can be read back from its new place is the old copy removed.
      if (await nativeBooks.get(book.id)) await idbDeleteBook(book.id);
    } catch (error) {
      console.warn('No se pudo mover un libro al almacenamiento de la aplicación:', error);
    }
  }
}

export function getLastBookId(): string | null {
  try {
    return localStorage.getItem('yomisuba_last_book_id');
  } catch {
    return null;
  }
}

export function setLastBookId(id: string): void {
  try {
    localStorage.setItem('yomisuba_last_book_id', id);
  } catch {
    // The library remains usable when localStorage is unavailable.
  }
}

export function createBookId(name: string, title: string, creator: string): string {
  return encodeURIComponent(`${name}|${title}|${creator}`);
}
