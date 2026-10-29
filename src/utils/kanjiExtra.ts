/**
 * The optional download "more kanji": the stroke order of ~6,400 kanji (KanjiVG) and the card of the
 * ~10,000 kanji outside the jōyō and jinmeiyō lists (KANJIDIC2). Built by scripts/build_kanji_extra.py,
 * published in the yomisuba-dictionaries repository and kept, like the optional dictionaries, in
 * IndexedDB as the gzip file it arrives in.
 */
import {
  DICTIONARIES_BASE_URL,
  deleteStoredFile,
  DownloadProgress,
  fetchWithProgress,
  readStoredFile,
  writeStoredFile,
} from './optionalDictionaries';
import { tr } from './i18n';
import type { KanjiRecord } from './kanjiInfo';

export const KANJI_EXTRA = {
  file: 'kanji-extra.json.gz',
  /** Bump together with the published file so installed copies offer the update. */
  version: '2026-10-29',
  approxBytes: 2_119_624,
  storageKey: 'kanji-extra',
  strokes: 6_431,
  rareKanji: 10_109,
};

export interface KanjiExtraData {
  /** The strokes of each kanji in writing order, as SVG paths in a 109×109 box. */
  strokes: Record<string, string[]>;
  kanji: Record<string, KanjiRecord>;
}

export interface KanjiExtraStatus {
  installed: boolean;
  outdated: boolean;
  size: number;
}

const listeners = new Set<() => void>();
let dataPromise: Promise<KanjiExtraData | null> | null = null;

const changed = () => {
  dataPromise = null;
  listeners.forEach((listener) => listener());
};

/** Notified when the download is installed or removed. */
export const onKanjiExtraChange = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export async function getKanjiExtraStatus(): Promise<KanjiExtraStatus> {
  const stored = await readStoredFile(KANJI_EXTRA.storageKey).catch(() => undefined);
  return stored
    ? { installed: true, outdated: stored.version !== KANJI_EXTRA.version, size: stored.size }
    : { installed: false, outdated: false, size: 0 };
}

const parse = async (blob: Blob): Promise<KanjiExtraData> => {
  if (typeof DecompressionStream === 'undefined') throw new Error(tr('err.dictNoDecompress'));
  const data = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).json() as Partial<KanjiExtraData>;
  if (!data || typeof data.strokes !== 'object' || typeof data.kanji !== 'object') throw new Error(tr('err.dictBadFormat'));
  return data as KanjiExtraData;
};

/** The installed data, read once (null when it is not installed). */
export const loadKanjiExtra = (): Promise<KanjiExtraData | null> => {
  if (!dataPromise) {
    dataPromise = readStoredFile(KANJI_EXTRA.storageKey)
      .then((stored) => (stored ? parse(stored.blob) : null))
      .catch((error) => {
        dataPromise = null;
        throw error;
      });
  }
  return dataPromise;
};

export async function downloadKanjiExtra(onProgress: (progress: DownloadProgress) => void, signal?: AbortSignal): Promise<void> {
  const blob = await fetchWithProgress(`${DICTIONARIES_BASE_URL}${KANJI_EXTRA.file}`, KANJI_EXTRA.approxBytes, onProgress, signal);
  // Validate before storing, so a truncated or wrong file never replaces a good one.
  await parse(blob);
  await writeStoredFile({ id: KANJI_EXTRA.storageKey, version: KANJI_EXTRA.version, size: blob.size, downloadedAt: Date.now(), blob });
  void navigator.storage?.persist?.().catch(() => undefined);
  changed();
}

export async function deleteKanjiExtra(): Promise<void> {
  await deleteStoredFile(KANJI_EXTRA.storageKey);
  changed();
}
