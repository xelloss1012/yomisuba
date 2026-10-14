import { AiProvider } from '../types/epub';
import { t, UiLanguage } from './i18n';

export type TranslationHistoryKind = 'dictionary' | 'translation' | 'ai';

export interface DictionaryHistorySense {
  partOfSpeech: string[];
  glosses: string[];
}

export interface DictionaryHistoryEntry {
  language: 'es' | 'en';
  kanji: string[];
  kana: string[];
  senses: DictionaryHistorySense[];
}

/**
 * Fixed, language-neutral contract stored for dictionary/glossary results.
 * Property names are English and never change; labels are only translated
 * when the entry is rendered to the user (see `formatDictionaryHistoryResponse`).
 */
export interface DictionaryHistoryData {
  baseForm: string;
  searchTerms: string[];
  entries: DictionaryHistoryEntry[];
}

export interface TranslationHistoryEntry {
  id: string;
  queriedAt: number;
  query: string;
  kind: TranslationHistoryKind;
  provider?: AiProvider;
  /**
   * Formatted text. Omitted for dictionary/glossary entries (it is fully
   * derivable from `data`), and stored as a short preview for translation/AI
   * entries — the full text only survives if the user saves it as a favorite.
   */
  response?: string;
  data?: DictionaryHistoryData;
}

export const MAX_TRANSLATION_HISTORY_ENTRIES = 500;
const MAX_HISTORY_STORAGE_BYTES = 2.5 * 1024 * 1024;
// If the same query of the same kind is consulted again within this window,
// the existing entry is refreshed (moved to the top, content updated) instead
// of stacking a duplicate.
export const HISTORY_DEDUP_WINDOW_MS = 60_000;
// Translation / AI answers are kept only as a short preview in the history to
// stop a few long explanations from bloating storage; the complete text is
// preserved when the entry is starred as a favorite.
export const HISTORY_PREVIEW_LENGTH = 600;

const previewResponse = (response: string): string =>
  response.length > HISTORY_PREVIEW_LENGTH
    ? `${response.slice(0, HISTORY_PREVIEW_LENGTH)}\n…`
    : response;

/**
 * Resolves the text to show for a history entry in the given UI language.
 * Dictionary/glossary entries are re-rendered from their structured `data`;
 * translation/AI entries fall back to the stored (preview) `response`.
 */
export const getHistoryEntryResponse = (
  entry: Pick<TranslationHistoryEntry, 'response' | 'data'>,
  lang: UiLanguage = 'es',
): string => (entry.data ? formatDictionaryHistoryResponse(entry.data, lang) : (entry.response || ''));

export const readTranslationHistory = (storageKey: string): TranslationHistoryEntry[] => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TranslationHistoryEntry =>
      Boolean(
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.queriedAt === 'number' &&
        typeof item.query === 'string' &&
        (item.kind === 'dictionary' || item.kind === 'translation' || item.kind === 'ai') &&
        (typeof item.response === 'string' || isDictionaryHistoryData(item.data)) &&
        (item.data === undefined || isDictionaryHistoryData(item.data))
      )
    ).slice(0, MAX_TRANSLATION_HISTORY_ENTRIES);
  } catch {
    return [];
  }
};

export const saveTranslationHistoryEntry = (
  storageKey: string,
  history: TranslationHistoryEntry[],
  entry: Omit<TranslationHistoryEntry, 'id' | 'queriedAt'>,
) => {
  // Dictionary/glossary entries keep only their structured `data` (the text is
  // re-derived from it on display). Translation/AI entries keep a short preview.
  const { response: _response, ...rest } = entry;
  const queriedAt = Date.now();
  const nextEntry: TranslationHistoryEntry = {
    ...rest,
    ...(entry.data
      ? {}
      : { response: previewResponse(entry.response || '') }),
    id: `${queriedAt.toString(36)}-${Math.random().toString(36).slice(2)}`,
    queriedAt,
  };
  // De-duplicate: if the same query of the same kind was consulted recently
  // (within the dedup window), refresh that entry (move it to the top and
  // update its content) instead of appending a duplicate.
  const recentIndex = history.findIndex(
    (item) =>
      item.kind === nextEntry.kind &&
      item.query === nextEntry.query &&
      queriedAt - item.queriedAt < HISTORY_DEDUP_WINDOW_MS,
  );
  const next = (recentIndex >= 0
    ? [nextEntry, ...history.filter((_, index) => index !== recentIndex)]
    : [nextEntry, ...history]
  ).slice(0, MAX_TRANSLATION_HISTORY_ENTRIES);

  try {
    while (next.length > 1 && JSON.stringify(next).length * 2 > MAX_HISTORY_STORAGE_BYTES) {
      next.pop();
    }
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // History is an enhancement; storage failures must not block the lookup.
  }
  return next;
};

const isDictionaryHistoryData = (value: unknown): value is DictionaryHistoryData => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return typeof data.baseForm === 'string' &&
    Array.isArray(data.searchTerms) &&
    Array.isArray(data.entries);
};

const renderDictionaryLines = (data: DictionaryHistoryData, lang: UiLanguage): string[] => {
  const lines = [
    `${t('glossary.baseForm', lang)}: ${data.baseForm}`,
    `${t('glossary.terms', lang)}: ${data.searchTerms.join(', ')}`,
  ];
  if (!data.entries.length) {
    lines.push('', t('glossary.notFound', lang));
  }
  data.entries.forEach((entry, index) => {
    lines.push(
      '',
      `${index + 1}. [${entry.language.toUpperCase()}] ${entry.kanji.length ? entry.kanji.join(' · ') : entry.kana.join(' · ')}`,
      ...(entry.kana.length ? [`${t('glossary.reading', lang)}: ${entry.kana.join(' · ')}`] : []),
      ...entry.senses.map((sense) =>
        `${sense.partOfSpeech.length ? `[${sense.partOfSpeech.join(', ')}] ` : ''}${sense.glosses.join('; ')}`
      ),
    );
  });
  return lines;
};

/**
 * Renders the stored dictionary data using the labels of the currently
 * selected UI language. Used only at display time.
 */
export const formatDictionaryHistoryResponse = (
  data: DictionaryHistoryData,
  lang: UiLanguage = 'es',
) => renderDictionaryLines(data, lang).join('\n');

/**
 * Builds the language-neutral canonical `response` string (English labels)
 * that is persisted alongside the structured `data`. This keeps the stored
 * text stable regardless of the UI language used when the entry was created.
 */
export const serializeDictionaryHistoryResponse = (data: DictionaryHistoryData) =>
  renderDictionaryLines(data, 'en').join('\n');

/**
 * Convenience helper for call sites: builds the structured `data` and the
 * canonical `response` string from a dictionary lookup result.
 */
export const buildDictionaryHistoryResponse = (
  baseForm: string,
  searchTerms: string[],
  entries: Array<{
    language: 'es' | 'en';
    kanji: string[];
    kana: string[];
    senses: Array<{ partOfSpeech: string[]; glosses: string[] }>;
  }>,
): { response: string; data: DictionaryHistoryData } => {
  const data: DictionaryHistoryData = {
    baseForm,
    searchTerms,
    entries: entries.map((entry) => ({
      language: entry.language,
      kanji: entry.kanji,
      kana: entry.kana,
      senses: entry.senses.map((sense) => ({
        partOfSpeech: sense.partOfSpeech,
        glosses: sense.glosses,
      })),
    })),
  };
  return { response: serializeDictionaryHistoryResponse(data), data };
};
