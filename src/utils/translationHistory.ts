import { AiProvider } from '../types/epub';

export type TranslationHistoryKind = 'dictionary' | 'translation' | 'ai';

export interface TranslationHistoryEntry {
  id: string;
  queriedAt: number;
  query: string;
  kind: TranslationHistoryKind;
  provider?: AiProvider;
  response: string;
}

export const MAX_TRANSLATION_HISTORY_ENTRIES = 500;
const MAX_HISTORY_STORAGE_BYTES = 2.5 * 1024 * 1024;
const MAX_RESPONSE_LENGTH = 32_000;

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
        typeof item.response === 'string'
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
  const nextEntry: TranslationHistoryEntry = {
    ...entry,
    response: entry.response.length > MAX_RESPONSE_LENGTH
      ? `${entry.response.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Respuesta abreviada en el historial]`
      : entry.response,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    queriedAt: Date.now(),
  };
  const latest = history[0];
  if (
    latest &&
    latest.kind === nextEntry.kind &&
    latest.provider === nextEntry.provider &&
    latest.query === nextEntry.query &&
    latest.response === nextEntry.response &&
    nextEntry.queriedAt - latest.queriedAt < 3000
  ) {
    return history;
  }
  const next = [nextEntry, ...history].slice(0, MAX_TRANSLATION_HISTORY_ENTRIES);

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

export const formatDictionaryHistoryResponse = (
  baseForm: string,
  searchTerms: string[],
  entries: Array<{
    kanji: string[];
    kana: string[];
    senses: Array<{ partOfSpeech: string[]; glosses: string[] }>;
  }>,
) => {
  const lines = [`Forma base: ${baseForm}`, `Términos: ${searchTerms.join(', ')}`];
  if (!entries.length) {
    lines.push('', 'No se encontró una entrada local para esta forma.');
  }
  entries.forEach((entry, index) => {
    lines.push(
      '',
      `${index + 1}. ${entry.kanji.length ? entry.kanji.join(' · ') : entry.kana.join(' · ')}`,
      ...(entry.kana.length ? [`Lectura: ${entry.kana.join(' · ')}`] : []),
      ...entry.senses.map((sense) =>
        `${sense.partOfSpeech.length ? `[${sense.partOfSpeech.join(', ')}] ` : ''}${sense.glosses.join('; ')}`
      ),
    );
  });
  return lines.join('\n');
};
