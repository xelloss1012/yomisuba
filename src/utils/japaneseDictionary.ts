/**
 * Optional Japanese–Japanese dictionary (国語辞典), built from the Japanese
 * Wiktionary by scripts/build-ja-dictionary.mjs. It is too large to ship with
 * every install, so it is downloaded on demand and kept in IndexedDB as the
 * gzip file it arrives in; dictionary.ts decompresses and indexes it the first
 * time a lookup needs it.
 */

/**
 * Where the dictionary is published. It must be a public URL that answers with
 * CORS headers (the app fetches it from its own origin).
 */
export const JAPANESE_DICTIONARY_URL = 'https://raw.githubusercontent.com/xelloss1012/ereader-dictionaries/main/ja-ja-dictionary.json.gz';
/** Bump together with the published file so installed copies are replaced. */
export const JAPANESE_DICTIONARY_VERSION = '2026-10-01';
/** Shown before downloading; the real size comes from the response. */
export const JAPANESE_DICTIONARY_APPROX_BYTES = 5_300_000;
export const JAPANESE_DICTIONARY_SOURCE_URL = 'https://ja.wiktionary.org/';

const DB_NAME = 'ereader_dictionaries';
const STORE_NAME = 'files';
const DB_VERSION = 1;
const RECORD_ID = 'ja-ja';

interface StoredDictionary {
  id: typeof RECORD_ID;
  version: string;
  size: number;
  downloadedAt: number;
  blob: Blob;
}

export interface JapaneseDictionaryStatus {
  installed: boolean;
  /** An older version is stored: it still works, but a newer one is available. */
  outdated: boolean;
  size: number;
  downloadedAt?: number;
}

const changeListeners = new Set<() => void>();

/** Notified whenever the dictionary is installed or removed. */
export const onJapaneseDictionaryChange = (listener: () => void): (() => void) => {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
};

const notifyChange = () => changeListeners.forEach((listener) => listener());

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacén de diccionarios.'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest | void,
): Promise<T | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = run(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request ? request.result as T : undefined);
      transaction.onerror = () => reject(transaction.error || new Error('Error en el almacén de diccionarios.'));
    });
  } finally {
    db.close();
  }
}

const readStored = () => withStore<StoredDictionary>('readonly', (store) => store.get(RECORD_ID));

export async function getJapaneseDictionaryStatus(): Promise<JapaneseDictionaryStatus> {
  const stored = await readStored().catch(() => undefined);
  return stored
    ? {
      installed: true,
      outdated: stored.version !== JAPANESE_DICTIONARY_VERSION,
      size: stored.size,
      downloadedAt: stored.downloadedAt,
    }
    : { installed: false, outdated: false, size: 0 };
}

/** Compact entries in the same format as the bundled JMdict files, plus synonyms. */
export interface JapaneseCompactEntry {
  id: string;
  k: string[];
  r: string[];
  s: Array<{ p: string[]; g: string[] }>;
  y?: string[];
}

const parseDictionary = async (blob: Blob): Promise<JapaneseCompactEntry[]> => {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador no puede descomprimir el diccionario japonés.');
  }
  const entries = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).json();
  if (!Array.isArray(entries) || !entries.every((entry) => entry && typeof entry.id === 'string' && Array.isArray(entry.s))) {
    throw new Error('El diccionario japonés descargado no tiene un formato válido.');
  }
  return entries as JapaneseCompactEntry[];
};

/** Entries of the installed dictionary, or null when it is not installed. */
export async function loadJapaneseDictionaryEntries(): Promise<JapaneseCompactEntry[] | null> {
  const stored = await readStored();
  return stored ? parseDictionary(stored.blob) : null;
}

export interface DownloadProgress {
  loaded: number;
  total: number;
}

export async function downloadJapaneseDictionary(
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(JAPANESE_DICTIONARY_URL, { signal, cache: 'no-store' });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }
  const total = Number(response.headers.get('content-length')) || JAPANESE_DICTIONARY_APPROX_BYTES;
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  onProgress({ loaded, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress({ loaded, total: Math.max(total, loaded) });
  }
  const blob = new Blob(chunks, { type: 'application/gzip' });
  // Validate before storing, so a truncated or wrong file never replaces a good one.
  await parseDictionary(blob);
  const record: StoredDictionary = {
    id: RECORD_ID,
    version: JAPANESE_DICTIONARY_VERSION,
    size: blob.size,
    downloadedAt: Date.now(),
    blob,
  };
  await withStore('readwrite', (store) => store.put(record));
  notifyChange();
}

export async function deleteJapaneseDictionary(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(RECORD_ID));
  notifyChange();
}
