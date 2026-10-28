import { csvCell, favoriteFields } from './favoritesExport';
import type { UiLanguage } from './i18n';
import type { GlobalHistoryEntry, GlobalNote, VocabularyItem } from './studyData';
import { formatDictionaryHistoryResponse, getHistoryEntryResponse } from './translationHistory';
import type { TranslationFavorite } from './translationFavorites';

const isoDate = (time: number): string => new Date(time).toISOString().slice(0, 10);
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const toCsv = (rows: string[][]): string => `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
const bookTitles = (item: { books: { title: string }[] }): string => item.books.map((book) => book.title).join(' · ');

export interface VocabularyExportLabels {
  word: string;
  reading: string;
  meaning: string;
  type: string;
  books: string;
  lookups: string;
  firstSaved: string;
  context: string;
  kind: (favorite: Pick<TranslationFavorite, 'kind' | 'provider'>) => string;
}

/** The vocabulary as a CSV file, one word per row, with the books it was saved in. */
export function vocabularyToCsv(items: VocabularyItem[], labels: VocabularyExportLabels): string {
  const header = [labels.word, labels.reading, labels.meaning, labels.context, labels.type, labels.books, labels.lookups, labels.firstSaved];
  const rows = items.map((item) => {
    const { meaning } = favoriteFields(item.favorite);
    return [
      item.word,
      item.reading,
      meaning,
      item.contexts[0]?.text ?? '',
      item.kinds.map((kind) => labels.kind({ kind, provider: item.favorite.provider })).join(' · '),
      bookTitles(item),
      String(item.lookups),
      isoDate(item.firstSavedAt),
    ];
  });
  return toCsv([header, ...rows]);
}

const escapeHtml = (text: string): string => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ankiField = (html: string): string => html.replace(/[\t\r\n]+/g, ' ');

/**
 * The vocabulary as a text file Anki imports as it is (File › Import): one card per word, the word in
 * front and, behind, its reading, meaning, the sentences it was saved from and its books. The header lines tell Anki the separator and that
 * the fields are HTML.
 */
export function vocabularyToAnki(items: VocabularyItem[]): string {
  const lines = ['#separator:tab', '#html:true', '#columns:Front\tBack'];
  for (const item of items) {
    const { meaning } = favoriteFields(item.favorite);
    const back = [
      item.reading && item.reading !== item.word ? `<b>${escapeHtml(item.reading)}</b>` : '',
      escapeHtml(meaning),
      ...item.contexts.slice(0, 2).map((context) => `<i>${escapeHtml(context.text)}</i>`),
      item.books.length ? `<small>${escapeHtml(bookTitles(item))}</small>` : '',
    ].filter(Boolean).join('<br>');
    lines.push(`${ankiField(escapeHtml(item.word))}\t${ankiField(back)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The vocabulary as Markdown, with the full answer of each word. */
export function vocabularyToMarkdown(
  title: string,
  items: VocabularyItem[],
  labels: Pick<VocabularyExportLabels, 'kind' | 'books' | 'lookups'>,
  language: UiLanguage,
): string {
  const lines: string[] = [`# ${title.trim() || '—'}`];
  for (const item of items) {
    const favorite = item.favorite;
    const body = favorite.data ? formatDictionaryHistoryResponse(favorite.data, language) : favorite.response;
    const heading = item.reading && item.reading !== item.word ? `${item.word}（${item.reading}）` : item.word;
    const meta = [
      item.kinds.map((kind) => labels.kind({ kind, provider: favorite.provider })).join(' · '),
      isoDate(item.firstSavedAt),
      item.lookups ? `${labels.lookups}: ${item.lookups}` : '',
    ].filter(Boolean).join(' · ');
    lines.push('', `## ${oneLine(heading)}`, `*${meta}*`);
    if (item.books.length) lines.push(`*${labels.books}: ${bookTitles(item)}*`);
    for (const context of item.contexts) lines.push('', `> ${oneLine(context.text)}`, `> — ${oneLine(context.book.title)}`);
    if (body.trim()) lines.push('', body.trim());
  }
  return `${lines.join('\n')}\n`;
}

const quoted = (text: string): string => text.trim().split('\n').map((line) => `> ${line}`).join('\n');

/** Notes and underlines of every book as Markdown: by book, then by chapter, in the order of the book. */
export function notesToMarkdown(title: string, notes: GlobalNote[], chapterLabel: (spineIndex: number) => string): string {
  const lines: string[] = [`# ${title.trim() || '—'}`];
  const byBook = new Map<string, GlobalNote[]>();
  for (const note of notes) {
    const list = byBook.get(note.book.bookKey) ?? [];
    list.push(note);
    byBook.set(note.book.bookKey, list);
  }
  for (const list of byBook.values()) {
    lines.push('', `## ${oneLine(list[0].book.title) || '—'}`);
    let chapter: number | null = null;
    const ordered = list
      .map((note, index) => ({ note, index }))
      .sort((a, b) => a.note.annotation.spineIndex - b.note.annotation.spineIndex || a.index - b.index);
    for (const { note } of ordered) {
      if (note.annotation.spineIndex !== chapter) {
        chapter = note.annotation.spineIndex;
        lines.push('', `### ${chapterLabel(chapter)}`);
      }
      lines.push('', quoted(note.annotation.quote));
      if (note.annotation.note?.trim()) lines.push('', note.annotation.note.trim());
    }
  }
  return `${lines.join('\n')}\n`;
}

export interface HistoryExportLabels {
  date: string;
  query: string;
  type: string;
  answer: string;
  book: string;
  kind: (entry: Pick<TranslationFavorite, 'kind' | 'provider'>) => string;
}

/** The history of every book as a CSV file, newest first. */
export function historyToCsv(entries: GlobalHistoryEntry[], labels: HistoryExportLabels, language: UiLanguage): string {
  const header = [labels.date, labels.query, labels.type, labels.answer, labels.book];
  const rows = entries.map(({ book, entry }) => [
    new Date(entry.queriedAt).toISOString().slice(0, 16).replace('T', ' '),
    entry.query,
    labels.kind(entry),
    oneLine(getHistoryEntryResponse(entry, language)).slice(0, 400),
    book.title,
  ]);
  return toCsv([header, ...rows]);
}
