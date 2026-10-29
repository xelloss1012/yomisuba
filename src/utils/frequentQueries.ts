import { cleanContext, HISTORY_DEDUP_WINDOW_MS } from './translationHistory';

/**
 * A term looked up from the text counts once per sentence: again in the same sentence it is the same
 * appearance (forgotten while rereading), in another sentence a new one, which is what tells how often it
 * comes up in the book. A term looked up with no sentence (typed) counts again only after this window,
 * the same one the history uses (`HISTORY_DEDUP_WINDOW_MS`), so both lists agree on what "the same
 * consultation" means.
 */
export const FREQUENT_QUERIES_DEDUP_WINDOW_MS = HISTORY_DEDUP_WINDOW_MS;

/** How many of the last sentences of a term are remembered, to go back and forth between a few. */
export const MAX_QUERY_CONTEXTS = 5;

export interface FrequentQuery {
  key: string;
  query: string;
  count: number;
  updatedAt: number;
  /** Fingerprints of the last sentences it was looked up in, the latest first. */
  contexts?: string[];
}

/** A short fingerprint of a sentence (FNV-1a), to recognize it without keeping it. */
export const sentenceFingerprint = (sentence: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sentence.length; index += 1) {
    hash ^= sentence.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

export const MAX_FREQUENT_QUERIES = 1000;
export const FREQUENT_QUERIES_VERSION = 2;

const versionStorageKey = (storageKey: string) => `${storageKey}_version`;

export const normalizeFrequentQuery = (query: string) =>
  query.trim().replace(/\s+/g, ' ').toLowerCase();

const sortFrequentQueries = (queries: FrequentQuery[]) =>
  queries.sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt);

export const readFrequentQueries = (storageKey: string): FrequentQuery[] => {
  try {
    const versionKey = versionStorageKey(storageKey);
    if (localStorage.getItem(versionKey) !== String(FREQUENT_QUERIES_VERSION)) {
      localStorage.removeItem(storageKey);
      localStorage.setItem(versionKey, String(FREQUENT_QUERIES_VERSION));
      return [];
    }
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortFrequentQueries(parsed.filter((item): item is FrequentQuery =>
      Boolean(
        item &&
        typeof item === 'object' &&
        typeof item.key === 'string' &&
        typeof item.query === 'string' &&
        typeof item.count === 'number' &&
        Number.isInteger(item.count) &&
        item.count > 0 &&
        typeof item.updatedAt === 'number' &&
        Number.isFinite(item.updatedAt) &&
        (item.contexts === undefined || (Array.isArray(item.contexts) && item.contexts.every((print: unknown) => typeof print === 'string')))
      )
    )).slice(0, MAX_FREQUENT_QUERIES);
  } catch {
    return [];
  }
};

export const recordFrequentQuery = (
  storageKey: string,
  queries: FrequentQuery[],
  query: string,
  /** The sentence it was looked up in, when it was looked up from the text. */
  context?: string,
): FrequentQuery[] => {
  const trimmedQuery = query.trim().replace(/\s+/g, ' ');
  const key = normalizeFrequentQuery(trimmedQuery);
  if (!key || key.length > 512) return queries;

  const now = Date.now();
  const existing = queries.find((item) => item.key === key);
  // Mirror of the history de-duplication: a repeat in a sentence already seen, or with no sentence inside
  // the window, refreshes the entry instead of counting again. Only `updatedAt` slides forward, so the
  // window stays anchored to the latest consultation like `queriedAt` does for the history entry. A term
  // counted before sentences were remembered falls back to the window.
  const sentence = cleanContext(context);
  const print = sentence ? sentenceFingerprint(sentence) : undefined;
  const isRepeat = existing !== undefined && (print && existing.contexts?.length
    ? existing.contexts.includes(print)
    : now - existing.updatedAt < FREQUENT_QUERIES_DEDUP_WINDOW_MS);
  const contexts = print
    ? [print, ...(existing?.contexts ?? []).filter((item) => item !== print)].slice(0, MAX_QUERY_CONTEXTS)
    : existing?.contexts;
  const nextQuery: FrequentQuery = {
    ...(existing ?? { key, query: trimmedQuery }),
    count: existing ? existing.count + (isRepeat ? 0 : 1) : 1,
    updatedAt: now,
    ...(contexts?.length ? { contexts } : {}),
  };
  const next = sortFrequentQueries([
    nextQuery,
    ...queries.filter((item) => item.key !== key),
  ].slice(0, MAX_FREQUENT_QUERIES));

  try {
    if (next.length) localStorage.setItem(storageKey, JSON.stringify(next));
    else localStorage.removeItem(storageKey);
    localStorage.setItem(versionStorageKey(storageKey), String(FREQUENT_QUERIES_VERSION));
  } catch {
    // Keep the in-memory count when persistence is unavailable.
  }
  return next;
};

export const writeFrequentQueries = (storageKey: string, queries: FrequentQuery[]) => {
  const next = sortFrequentQueries([...queries]).slice(0, MAX_FREQUENT_QUERIES);
  try {
    if (next.length) localStorage.setItem(storageKey, JSON.stringify(next));
    else localStorage.removeItem(storageKey);
    localStorage.setItem(versionStorageKey(storageKey), String(FREQUENT_QUERIES_VERSION));
  } catch {
    // Keep the in-memory counts when persistence is unavailable.
  }
  return next;
};
