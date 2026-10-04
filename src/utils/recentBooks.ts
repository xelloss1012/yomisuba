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
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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

export async function listRecentBooks(): Promise<RecentBook[]> {
  const db = await openDatabase();
  const books = await new Promise<RecentBook[]>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as RecentBook[]).sort((a, b) => b.lastOpened - a.lastOpened));
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
