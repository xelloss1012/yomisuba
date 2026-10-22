import type { UiLanguage } from './i18n';
import { formatDictionaryHistoryResponse } from './translationHistory';
import type { TranslationFavorite } from './translationFavorites';

export interface FavoritesExportLabels {
  word: string;
  reading: string;
  meaning: string;
  type: string;
  date: string;
  source: string;
  /** The name of a favorite's kind ("Diccionario", "Traducción"…). */
  kind: (favorite: TranslationFavorite) => string;
}

const isoDate = (time: number): string => new Date(time).toISOString().slice(0, 10);
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A cell of a CSV file: quoted when it needs it, and made harmless to a spreadsheet that would run "=…". */
export const csvCell = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The word, its reading and a short meaning of a favorite, for a table. */
export function favoriteFields(favorite: TranslationFavorite): { word: string; reading: string; meaning: string } {
  const data = favorite.data;
  if (data && data.entries.length > 0) {
    const first = data.entries[0];
    const meaning = data.entries
      .slice(0, 2)
      .map((entry) => entry.senses.slice(0, 3).map((sense) => sense.glosses.join('; ')).join(' · '))
      .filter(Boolean)
      .join(' | ');
    return { word: data.baseForm || favorite.query, reading: first.kana[0] ?? '', meaning };
  }
  return { word: favorite.query, reading: '', meaning: oneLine(favorite.response).slice(0, 400) };
}

/**
 * The favorites as a CSV file: UTF-8 with a byte-order mark, so that Excel reads the Japanese, and one
 * word per row, which Anki and any spreadsheet import.
 */
export function favoritesToCsv(favorites: TranslationFavorite[], labels: FavoritesExportLabels): string {
  const header = [labels.word, labels.reading, labels.meaning, labels.type, labels.date, labels.source];
  const rows = favorites.map((favorite) => {
    const { word, reading, meaning } = favoriteFields(favorite);
    return [word, reading, meaning, labels.kind(favorite), isoDate(favorite.savedAt), favorite.provider ?? ''];
  });
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** The favorites as Markdown, with the full answer of each. */
export function favoritesToMarkdown(
  title: string,
  favorites: TranslationFavorite[],
  labels: Pick<FavoritesExportLabels, 'kind'>,
  language: UiLanguage,
): string {
  const lines: string[] = [`# ${title.trim() || '—'}`];
  for (const favorite of favorites) {
    const body = favorite.data ? formatDictionaryHistoryResponse(favorite.data, language) : favorite.response;
    lines.push('', `## ${favorite.query.replace(/\s+/g, ' ').trim()}`, `*${labels.kind(favorite)} · ${isoDate(favorite.savedAt)}${favorite.provider ? ` · ${favorite.provider}` : ''}*`);
    if (body.trim()) lines.push('', body.trim());
  }
  return `${lines.join('\n')}\n`;
}
