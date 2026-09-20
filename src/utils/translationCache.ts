import { AiProvider } from '../types/epub';

type TranslationProvider = 'google' | AiProvider;

interface CachedTranslation {
  cacheKey: string;
  provider: TranslationProvider;
  text: string;
  translation: string;
  createdAt: number;
  lastUsedAt: number;
}

const STORAGE_KEY = 'ereader_translation_cache_v1';
const MAX_ENTRIES = 100;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function createCacheKey(provider: TranslationProvider, text: string, apiKey = ''): string {
  return `${provider}:${fingerprint(apiKey)}:${text.trim()}`;
}

function readEntries(): CachedTranslation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const entries = raw ? JSON.parse(raw) as CachedTranslation[] : [];
    if (!Array.isArray(entries)) return [];
    const cutoff = Date.now() - MAX_AGE_MS;
    return entries.filter((entry) =>
      entry &&
      typeof entry.cacheKey === 'string' &&
      typeof entry.translation === 'string' &&
      entry.lastUsedAt >= cutoff
    );
  } catch {
    return [];
  }
}

function writeEntries(entries: CachedTranslation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Translation still works if storage is unavailable or full.
  }
}

export function getCachedTranslation(
  provider: TranslationProvider,
  text: string,
  apiKey = '',
): string | null {
  const cacheKey = createCacheKey(provider, text, apiKey);
  const entries = readEntries();
  const entry = entries.find((candidate) => candidate.cacheKey === cacheKey);
  if (!entry) {
    writeEntries(entries);
    return null;
  }

  entry.lastUsedAt = Date.now();
  writeEntries([
    entry,
    ...entries.filter((candidate) => candidate.cacheKey !== cacheKey),
  ]);
  return entry.translation;
}

export function saveCachedTranslation(
  provider: TranslationProvider,
  text: string,
  translation: string,
  apiKey = '',
): void {
  const now = Date.now();
  const cacheKey = createCacheKey(provider, text, apiKey);
  const entries = readEntries().filter((entry) => entry.cacheKey !== cacheKey);
  writeEntries([
    {
      cacheKey,
      provider,
      text: text.trim(),
      translation,
      createdAt: now,
      lastUsedAt: now,
    },
    ...entries,
  ]);
}
