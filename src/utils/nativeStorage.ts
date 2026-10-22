/**
 * Durable storage for the Android app.
 *
 * Books and reading data normally live in the WebView's own storage (IndexedDB, localStorage), which
 * Android or the WebView may clear when the device runs low or when the WebView resets: the library
 * then comes back empty. Capacitor's documentation warns about it. The app's private files folder is
 * not touched by that, so the app keeps its books and a copy of its reading data there too.
 *
 * Everything here works on a small file-system port so that it is testable without a device; the real
 * port (over @capacitor/filesystem, in the app's private storage: no permission needed) is built in
 * `nativeFiles.ts`.
 */
import type { RecentBook } from './recentBooks';

export interface NativeFiles {
  /** Writes (or, with `append`, extends) a binary file; the data is base64. Creates the folders. */
  writeBase64(path: string, base64: string, append: boolean): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  /** null when the file does not exist. */
  readText(path: string): Promise<string | null>;
  readBlob(path: string, type: string): Promise<Blob | null>;
  /** The files in a folder; empty when it does not exist. */
  list(directory: string): Promise<Array<{ name: string; size: number }>>;
  /** null when the file does not exist. */
  size(path: string): Promise<number | null>;
  remove(path: string): Promise<void>;
}

const ROOT = 'yomisuba';
const BOOKS = `${ROOT}/books`;
const STATE_FILE = `${ROOT}/state.json`;
const EPUB_TYPE = 'application/epub+zip';
// A multiple of 3, so that every chunk is base64 on its own and they can be appended one after another.
const CHUNK_BYTES = 3 * 1024 * 1024;

/** A file name for a book id: ids hold the title and author and can be longer than a file name allows. */
export async function bookFileKey(id: string): Promise<string> {
  const bytes = new TextEncoder().encode(id);
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // No Web Crypto (an insecure page): a plain hash, good enough to tell a few hundred books apart.
  let hash = 5381;
  for (const byte of bytes) hash = ((hash * 33) ^ byte) >>> 0;
  return `h${hash.toString(16)}${bytes.length.toString(16)}`;
}

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // In slices: String.fromCharCode cannot take millions of arguments at once.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
};

interface BookMeta {
  id: string;
  name: string;
  title: string;
  creator: string;
  lastOpened: number;
  printedPages?: number;
  coverType?: string;
}

export interface NativeBookStore {
  save(book: RecentBook): Promise<void>;
  /** Every saved book, newest first, without its text: `blob` is empty and `blobLoaded` is false. */
  list(): Promise<RecentBook[]>;
  get(id: string): Promise<RecentBook | null>;
  remove(id: string): Promise<void>;
}

export function createNativeBookStore(files: NativeFiles): NativeBookStore {
  const paths = async (id: string) => {
    const key = await bookFileKey(id);
    return { epub: `${BOOKS}/${key}.epub`, cover: `${BOOKS}/${key}.cover`, meta: `${BOOKS}/${key}.json` };
  };

  const toBook = async (meta: BookMeta, withBlob: boolean): Promise<RecentBook | null> => {
    const where = await paths(meta.id);
    let blob = new Blob([], { type: EPUB_TYPE });
    if (withBlob) {
      const stored = await files.readBlob(where.epub, EPUB_TYPE);
      if (!stored) return null;
      blob = stored;
    }
    const cover = meta.coverType ? await files.readBlob(where.cover, meta.coverType) : null;
    return {
      id: meta.id,
      name: meta.name,
      title: meta.title,
      creator: meta.creator,
      lastOpened: meta.lastOpened,
      printedPages: meta.printedPages,
      blob,
      blobLoaded: withBlob,
      ...(cover ? { cover } : {}),
    };
  };

  return {
    async save(book) {
      const where = await paths(book.id);
      // An empty blob is a book listed without its text: only its details are updated.
      if (book.blob.size > 0 && (await files.size(where.epub)) !== book.blob.size) {
        for (let start = 0; start < book.blob.size; start += CHUNK_BYTES) {
          await files.writeBase64(where.epub, await blobToBase64(book.blob.slice(start, start + CHUNK_BYTES)), start > 0);
        }
      }
      let coverType: string | undefined;
      if (book.cover && book.cover.size > 0) {
        coverType = book.cover.type || 'image/png';
        await files.writeBase64(where.cover, await blobToBase64(book.cover), false);
      } else {
        const previous = await files.readText(where.meta);
        coverType = previous ? (JSON.parse(previous) as BookMeta).coverType : undefined;
      }
      // The details go last: a book counts as saved only once they are there.
      const meta: BookMeta = {
        id: book.id,
        name: book.name,
        title: book.title,
        creator: book.creator,
        lastOpened: book.lastOpened,
        printedPages: book.printedPages,
        coverType,
      };
      await files.writeText(where.meta, JSON.stringify(meta));
    },

    async list() {
      const metas = (await files.list(BOOKS)).filter((file) => file.name.endsWith('.json'));
      const books = await Promise.all(metas.map(async (file) => {
        try {
          const text = await files.readText(`${BOOKS}/${file.name}`);
          return text ? await toBook(JSON.parse(text) as BookMeta, false) : null;
        } catch {
          return null; // one damaged entry must not hide the others
        }
      }));
      return books.filter((book): book is RecentBook => book !== null).sort((a, b) => b.lastOpened - a.lastOpened);
    },

    async get(id) {
      const text = await files.readText((await paths(id)).meta);
      return text ? toBook(JSON.parse(text) as BookMeta, true) : null;
    },

    async remove(id) {
      const where = await paths(id);
      // The details first, so that a half-removed book never shows up in the list.
      for (const path of [where.meta, where.epub, where.cover]) await files.remove(path);
    },
  };
}

// --- A copy of the reading data -----------------------------------------------------

/** What is worth keeping: the user's own data, not what the app can rebuild. */
export const isMirroredKey = (key: string): boolean =>
  key.startsWith('yomisuba')
  && !key.includes('_pagination')
  && !key.includes('translation_cache')
  && !key.includes('update_check_v1');

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export interface StateMirror {
  /** Writes the current reading data to the private copy. */
  snapshot(): Promise<void>;
  /**
   * Brings back what is missing when the WebView's storage has been cleared. It only runs when the
   * `sentinelKey` (always written by the app) is gone, and never overwrites a value that is there.
   * Returns how many entries it restored.
   */
  restoreIfCleared(sentinelKey: string): Promise<number>;
}

export function createStateMirror(files: NativeFiles, storage: StorageLike): StateMirror {
  return {
    async snapshot() {
      const entries: Record<string, string> = {};
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        const value = key === null ? null : storage.getItem(key);
        if (key !== null && value !== null && isMirroredKey(key)) entries[key] = value;
      }
      // An empty snapshot is not written: it would replace a good copy with nothing if the storage was just cleared.
      if (Object.keys(entries).length === 0) return;
      await files.writeText(STATE_FILE, JSON.stringify({ version: 1, savedAt: Date.now(), entries }));
    },

    async restoreIfCleared(sentinelKey) {
      if (storage.getItem(sentinelKey) !== null) return 0;
      const text = await files.readText(STATE_FILE);
      if (!text) return 0;
      let entries: Record<string, unknown>;
      try {
        entries = (JSON.parse(text) as { entries?: Record<string, unknown> }).entries ?? {};
      } catch {
        return 0;
      }
      let restored = 0;
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value === 'string' && isMirroredKey(key) && storage.getItem(key) === null) {
          storage.setItem(key, value);
          restored += 1;
        }
      }
      return restored;
    },
  };
}
