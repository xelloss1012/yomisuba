import { normalizeChar, normalizeSearchQuery } from './bookSearch';
import type { TextAnnotation } from './textAnnotations';

export interface NoteHit {
  annotation: TextAnnotation & { chapterLabel: string };
  /** The note around the match, as it was written (spaces and line breaks kept). */
  before: string;
  match: string;
  after: string;
}

const SNIPPET_CONTEXT = 36;

/** Normalised text with, for every normalised character, where it came from in the original. */
const foldWithOffsets = (text: string): { folded: string; starts: number[]; ends: number[] } => {
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let position = 0;
  for (const char of text) {
    const normal = normalizeChar(char);
    for (let index = 0; index < normal.length; index += 1) {
      folded += normal[index];
      starts.push(position);
      ends.push(position + char.length);
    }
    position += char.length;
  }
  return { folded, starts, ends };
};

/** Where a query (already normalised) falls in a text, in the text's own characters, or null. */
export function findInText(text: string, normalizedQuery: string): { start: number; end: number } | null {
  if (!normalizedQuery) return null;
  const { folded, starts, ends } = foldWithOffsets(text);
  const at = folded.indexOf(normalizedQuery);
  if (at < 0) return null;
  return { start: starts[at], end: ends[at + normalizedQuery.length - 1] };
}

/**
 * The notes that mention a text, in the order of the book. Only the notes are searched: the underlined
 * passages are the book's own text, which the search of the book already covers.
 */
export function searchNotes(
  annotations: Array<TextAnnotation & { chapterLabel: string }>,
  query: string,
): NoteHit[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [];
  const hits: NoteHit[] = [];
  for (const annotation of annotations) {
    if (!annotation.note) continue;
    const found = findInText(annotation.note, normalized);
    if (!found) continue;
    hits.push({
      annotation,
      before: annotation.note.slice(Math.max(0, found.start - SNIPPET_CONTEXT), found.start),
      match: annotation.note.slice(found.start, found.end),
      after: annotation.note.slice(found.end, found.end + SNIPPET_CONTEXT),
    });
  }
  return hits.sort((left, right) => left.annotation.spineIndex - right.annotation.spineIndex);
}

/** Whether an underline, its note or its chapter mention the text: the filter of the list of underlines. */
export function annotationMatches(
  annotation: TextAnnotation & { chapterLabel: string },
  query: string,
): boolean {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return true;
  return [annotation.quote, annotation.note ?? '', annotation.chapterLabel]
    .some((text) => foldWithOffsets(text).folded.includes(normalized));
}
