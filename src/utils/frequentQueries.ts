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
  const nextQuery: FrequentQuery = existing
    ? { ...existing, count: existing.count + 1, updatedAt: now }
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
