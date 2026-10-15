import { HISTORY_DEDUP_WINDOW_MS } from './translationHistory';

/**
 * A term consulted again inside this window is the *same* consultation as the
 * previous one (the user tapped several times or re-selected the text), so the
 * counter must not grow. It is deliberately the same window the history uses
 * (`HISTORY_DEDUP_WINDOW_MS`) so both lists always agree on what "consulted
 * just now" means.
 */
export const FREQUENT_QUERIES_DEDUP_WINDOW_MS = HISTORY_DEDUP_WINDOW_MS;

export interface FrequentQuery {
  key: string;
  query: string;
  count: number;
  updatedAt: number;
}

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
        Number.isFinite(item.updatedAt)
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
): FrequentQuery[] => {
  const trimmedQuery = query.trim().replace(/\s+/g, ' ');
  const key = normalizeFrequentQuery(trimmedQuery);
  if (!key || key.length > 512) return queries;

  const now = Date.now();
  const existing = queries.find((item) => item.key === key);
  // Mirror of the history de-duplication: a repeat inside the window refreshes
  // the existing entry instead of registering a new query. Only `updatedAt`
  // slides forward, so the window stays anchored to the latest consultation
  // exactly like `queriedAt` does for the history entry.
  const isRepeat =
    existing !== undefined && now - existing.updatedAt < FREQUENT_QUERIES_DEDUP_WINDOW_MS;
  const nextQuery: FrequentQuery = existing
    ? { ...existing, count: existing.count + (isRepeat ? 0 : 1), updatedAt: now }
    : { key, query: trimmedQuery, count: 1, updatedAt: now };
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
