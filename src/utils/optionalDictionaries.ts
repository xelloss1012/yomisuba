/**
 * Optional dictionaries, one per interface language that has no bundled one:
 * Japanese–Japanese (国語辞典) plus Japanese–French, –German, –Italian,
 * –Chinese, –Korean and –Vietnamese. They are built by
 * scripts/build_jmdict_language.py and scripts/build-wiktionary-dictionary.mjs,
 * published in the public yomisuba-dictionaries repository, downloaded on demand
 * from the settings screen and kept in IndexedDB as the gzip files they arrive
 * in; dictionary.ts decompresses and indexes one the first time a lookup needs it.
 *
 * IndexedDB belongs to the app's origin, so downloads survive app updates. They
 * are deliberately not part of the Google Drive backup.
 */
import { UiLanguage } from './i18n';

export type OptionalDictionaryId = Exclude<UiLanguage, 'es' | 'en'>;

export interface OptionalDictionaryInfo {
  id: OptionalDictionaryId;
  /** Published file name inside the dictionaries repository. */
  file: string;
  /** Bump together with the published file so installed copies offer the update. */
  version: string;
  /** Shown before downloading; the real size comes from the response. */
  approxBytes: number;
  entries: number;
  source: { label: string; url: string };
  license: { label: string; url: string };
  /** IndexedDB key. The Japanese one predates the others and keeps its original key. */
  storageKey: string;
}

const DICTIONARIES_BASE_URL = 'https://raw.githubusercontent.com/xelloss1012/yomisuba-dictionaries/main/';

/** Credited by the JMdict line every dictionary panel already shows. */
export const JMDICT_SOURCE = { label: 'JMdict/EDICT © EDRDG', url: 'https://www.edrdg.org/wiki/JMdict-EDICT_Dictionary_Project.html' };
const JMDICT_LICENSE = { label: 'CC BY-SA 4.0', url: 'https://www.edrdg.org/edrdg/licence.html' };
const WIKTIONARY_LICENSE = { label: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' };
const wiktionary = (edition: string) => ({ label: `Wiktionary (${edition})`, url: `https://${edition}.wiktionary.org/` });

export const OPTIONAL_DICTIONARIES: Record<OptionalDictionaryId, OptionalDictionaryInfo> = {
  ja: {
    id: 'ja', file: 'ja-ja-dictionary.json.gz', version: '2026-10-15', approxBytes: 5_312_326, entries: 109_370,
    source: wiktionary('ja'), license: WIKTIONARY_LICENSE, storageKey: 'ja-ja',
  },
  de: {
    id: 'de', file: 'jmdict-de.json.gz', version: '2026-10-15', approxBytes: 5_773_296, entries: 129_088,
    source: JMDICT_SOURCE, license: JMDICT_LICENSE, storageKey: 'de',
  },
  fr: {
    id: 'fr', file: 'jmdict-fr.json.gz', version: '2026-10-15', approxBytes: 517_712, entries: 15_336,
    source: JMDICT_SOURCE, license: JMDICT_LICENSE, storageKey: 'fr',
  },
  zh: {
    id: 'zh', file: 'wiktionary-zh.json.gz', version: '2026-10-15', approxBytes: 2_329_737, entries: 75_094,
    source: wiktionary('zh'), license: WIKTIONARY_LICENSE, storageKey: 'zh',
  },
  ko: {
    id: 'ko', file: 'wiktionary-ko.json.gz', version: '2026-10-15', approxBytes: 261_281, entries: 12_243,
    source: wiktionary('ko'), license: WIKTIONARY_LICENSE, storageKey: 'ko',
  },
  it: {
    id: 'it', file: 'wiktionary-it.json.gz', version: '2026-10-15', approxBytes: 70_549, entries: 2_763,
    source: wiktionary('it'), license: WIKTIONARY_LICENSE, storageKey: 'it',
  },
  vi: {
    id: 'vi', file: 'wiktionary-vi.json.gz', version: '2026-10-15', approxBytes: 67_827, entries: 1_645,
    source: wiktionary('vi'), license: WIKTIONARY_LICENSE, storageKey: 'vi',
  },
};

export const isOptionalDictionaryId = (value: string): value is OptionalDictionaryId =>
  Object.prototype.hasOwnProperty.call(OPTIONAL_DICTIONARIES, value);

export const optionalDictionaryUrl = (id: OptionalDictionaryId) => `${DICTIONARIES_BASE_URL}${OPTIONAL_DICTIONARIES[id].file}`;

const DB_NAME = 'yomisuba_dictionaries';
const STORE_NAME = 'files';
const DB_VERSION = 1;

interface StoredDictionary {
  id: string;
  version: string;
  size: number;
  downloadedAt: number;
  blob: Blob;
}

export interface OptionalDictionaryStatus {
  installed: boolean;
  /** An older version is stored: it still works, but a newer one is available. */
  outdated: boolean;
  size: number;
  downloadedAt?: number;
}

const changeListeners = new Set<(id: OptionalDictionaryId) => void>();

/** Notified with the dictionary that was installed or removed. */
export const onOptionalDictionaryChange = (listener: (id: OptionalDictionaryId) => void): (() => void) => {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
};

const notifyChange = (id: OptionalDictionaryId) => changeListeners.forEach((listener) => listener(id));

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

const readStored = (id: OptionalDictionaryId) =>
  withStore<StoredDictionary>('readonly', (store) => store.get(OPTIONAL_DICTIONARIES[id].storageKey));

export async function getOptionalDictionaryStatus(id: OptionalDictionaryId): Promise<OptionalDictionaryStatus> {
  const stored = await readStored(id).catch(() => undefined);
  return stored
    ? {
      installed: true,
      outdated: stored.version !== OPTIONAL_DICTIONARIES[id].version,
      size: stored.size,
      downloadedAt: stored.downloadedAt,
    }
    : { installed: false, outdated: false, size: 0 };
}

/** Compact entries in the same format as the bundled JMdict files. */
export interface OptionalCompactEntry {
  id: string;
  k: string[];
  r: string[];
  s: Array<{ p: string[]; g: string[] }>;
  /** Synonyms. */
  y?: string[];
  /** The word conjugates (set by the Wiktionary builder, whose parts of speech are localised). */
  i?: 1;
}

const parseDictionary = async (blob: Blob): Promise<OptionalCompactEntry[]> => {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador no puede descomprimir diccionarios.');
  }
  const entries = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).json();
  if (!Array.isArray(entries) || !entries.every((entry) => entry && typeof entry.id === 'string' && Array.isArray(entry.s))) {
    throw new Error('El diccionario descargado no tiene un formato válido.');
  }
  return entries as OptionalCompactEntry[];
};

/** Entries of an installed dictionary, or null when it is not installed. */
export async function loadOptionalDictionaryEntries(id: OptionalDictionaryId): Promise<OptionalCompactEntry[] | null> {
  const stored = await readStored(id);
  return stored ? parseDictionary(stored.blob) : null;
}

export interface DownloadProgress {
  loaded: number;
  total: number;
}

export async function downloadOptionalDictionary(
  id: OptionalDictionaryId,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const info = OPTIONAL_DICTIONARIES[id];
  const response = await fetch(optionalDictionaryUrl(id), { signal, cache: 'no-store' });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }
  const total = Number(response.headers.get('content-length')) || info.approxBytes;
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
    id: info.storageKey,
    version: info.version,
    size: blob.size,
    downloadedAt: Date.now(),
    blob,
  };
  await withStore('readwrite', (store) => store.put(record));
  // Ask the browser not to evict the origin's storage under pressure, so a
  // downloaded dictionary is not silently lost. It is a request, not a guarantee.
  void navigator.storage?.persist?.().catch(() => undefined);
  notifyChange(id);
}

export async function deleteOptionalDictionary(id: OptionalDictionaryId): Promise<void> {
  await withStore('readwrite', (store) => store.delete(OPTIONAL_DICTIONARIES[id].storageKey));
  notifyChange(id);
}
