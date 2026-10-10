export interface RecentBook {
  id: string;
  name: string;
  title: string;
  creator: string;
  lastOpened: number;
  blob: Blob;
  cover?: Blob;
}

const DB_NAME = 'ereader_library';
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
    request.onerror = () => reject(request.error || new Error('No se pudo abrir la biblioteca local.'));
  });
}

export async function saveRecentBook(book: RecentBook): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(book);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo guardar el libro.'));
  });
  db.close();
}

export async function listRecentBooks(limit = Number.MAX_SAFE_INTEGER): Promise<RecentBook[]> {
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
    request.onerror = () => reject(request.error || new Error('No se pudo leer la biblioteca local.'));
  });
  db.close();
  return books;
}

export async function getRecentBook(id: string): Promise<RecentBook | null> {
  const db = await openDatabase();
  const book = await new Promise<RecentBook | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve((request.result as RecentBook | undefined) || null);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir el libro guardado.'));
  });
  db.close();
  return book;
}

export async function deleteRecentBook(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo quitar el libro de recientes.'));
      transaction.onabort = () => reject(transaction.error || new Error('No se pudo quitar el libro de recientes.'));
    });
  } finally {
    db.close();
  }
  try {
    if (localStorage.getItem('ereader_last_book_id') === id) {
      localStorage.removeItem('ereader_last_book_id');
    }
  } catch {
    // The recent-book entry is removed even if the startup preference cannot be updated.
  }
}

export function getLastBookId(): string | null {
  try {
    return localStorage.getItem('ereader_last_book_id');
  } catch {
    return null;
  }
}

export function setLastBookId(id: string): void {
  try {
    localStorage.setItem('ereader_last_book_id', id);
  } catch {
    // The library remains usable when localStorage is unavailable.
  }
}

export function createBookId(name: string, title: string, creator: string): string {
  return encodeURIComponent(`${name}|${title}|${creator}`);
}
