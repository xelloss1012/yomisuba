import { DictionaryHistoryData, TranslationHistoryKind } from './translationHistory';

export type TranslationFavoriteKind = TranslationHistoryKind | 'glossary';

export interface TranslationFavorite {
  id: string;
  savedAt: number;
  query: string;
  kind: TranslationFavoriteKind;
  provider?: string;
  response: string;
  data?: DictionaryHistoryData;
}

const isDictionaryHistoryData = (value: unknown): value is DictionaryHistoryData => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return typeof data.baseForm === 'string' &&
    Array.isArray(data.searchTerms) &&
    Array.isArray(data.entries);
};

export type TranslationFavoriteCandidate = Omit<TranslationFavorite, 'id' | 'savedAt'>;

export const MAX_TRANSLATION_FAVORITES = 5000;
const MAX_RESPONSE_LENGTH = 32_000;
const MAX_FAVORITES_STORAGE_BYTES = 4 * 1024 * 1024;

export const readTranslationFavorites = (storageKey: string): TranslationFavorite[] => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TranslationFavorite =>
      Boolean(
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.savedAt === 'number' &&
        Number.isFinite(item.savedAt) &&
        typeof item.query === 'string' &&
        (item.kind === 'dictionary' || item.kind === 'translation' || item.kind === 'ai' || item.kind === 'glossary') &&
        (item.provider === undefined || typeof item.provider === 'string') &&
        typeof item.response === 'string' &&
        (item.data === undefined || isDictionaryHistoryData(item.data))
      )
    ).slice(0, MAX_TRANSLATION_FAVORITES);
  } catch {
    return [];
  }
};

const normalizedResponse = (response: string) => response.length > MAX_RESPONSE_LENGTH
  ? `${response.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Respuesta abreviada en favoritos]`
  : response;

const isPreviewOf = (favoriteResponse: string, candidateResponse: string): boolean => {
  // A favorite may store the full answer while a history-derived candidate only
  // carries its short preview (ending in "…"). Treat it as a match when the
  // candidate is a prefix of the stored favorite.
  if (!candidateResponse.endsWith('…')) return false;
  const prefix = candidateResponse.slice(0, -1);
  return favoriteResponse.startsWith(prefix);
};

const matchesCandidate = (
  favorite: TranslationFavorite,
  candidate: TranslationFavoriteCandidate,
) => {
  if (
    favorite.kind !== candidate.kind ||
    favorite.query !== candidate.query ||
    favorite.provider !== candidate.provider
  ) {
    return false;
  }
  // Dictionary/glossary favorites are compared by their structured data, which
  // is language-neutral, so toggling the star is stable across UI languages.
  if (favorite.data && candidate.data) {
    return JSON.stringify(favorite.data) === JSON.stringify(candidate.data);
  }
  const candidateResponse = normalizedResponse(candidate.response);
  return favorite.response === candidateResponse || isPreviewOf(favorite.response, candidateResponse);
};

const fitFavoritesToStorage = (favorites: TranslationFavorite[]) => {
  const stored = favorites.slice(0, MAX_TRANSLATION_FAVORITES);
  while (stored.length > 1 && JSON.stringify(stored).length * 2 > MAX_FAVORITES_STORAGE_BYTES) {
    stored.pop();
  }
  return stored;
};

export const isTranslationFavorite = (
  favorites: TranslationFavorite[],
  candidate: TranslationFavoriteCandidate,
) => favorites.some((favorite) => matchesCandidate(favorite, candidate));

export const writeTranslationFavorites = (storageKey: string, favorites: TranslationFavorite[]) => {
  try {
    if (!favorites.length) {
      localStorage.removeItem(storageKey);
      return [];
    }
    const stored = fitFavoritesToStorage(favorites);
    localStorage.setItem(storageKey, JSON.stringify(stored));
    return stored;
  } catch {
    // Keep favorites available in memory when persistence is unavailable.
    return favorites.slice(0, MAX_TRANSLATION_FAVORITES);
  }
};

export const toggleTranslationFavorite = (
  storageKey: string,
  favorites: TranslationFavorite[],
  candidate: TranslationFavoriteCandidate,
): TranslationFavorite[] => {
  const existingIndex = favorites.findIndex((favorite) => matchesCandidate(favorite, candidate));
  if (existingIndex >= 0) {
    const next = favorites.filter((_, index) => index !== existingIndex);
    return writeTranslationFavorites(storageKey, next);
  }

  const nextFavorite: TranslationFavorite = {
    ...candidate,
    response: normalizedResponse(candidate.response),
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    savedAt: Date.now(),
  };
  const next = [nextFavorite, ...favorites].slice(0, MAX_TRANSLATION_FAVORITES);
  return writeTranslationFavorites(storageKey, next);
};
