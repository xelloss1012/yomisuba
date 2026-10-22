export interface ExportableAnnotation {
  spineIndex: number;
  quote: string;
  note?: string;
  chapterLabel: string;
  pageLabel?: string;
}

const quoted = (text: string): string => text.trim().split('\n').map((line) => `> ${line}`).join('\n');

/**
 * Underlines and notes as Markdown, by chapter, to paste into a notes app or a vocabulary list. The
 * passages keep the order of the book; within a chapter, the order in which they were made.
 */
export function annotationsToMarkdown(title: string, items: ExportableAnnotation[]): string {
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.spineIndex - right.item.spineIndex || left.index - right.index)
    .map(({ item }) => item);

  const lines: string[] = [`# ${title.trim() || '—'}`];
  let chapter: number | null = null;
  for (const item of ordered) {
    if (item.spineIndex !== chapter) {
      chapter = item.spineIndex;
      lines.push('', `## ${item.chapterLabel}`);
    }
    lines.push('', quoted(item.quote));
    if (item.pageLabel) lines.push(`*${item.pageLabel}*`);
    if (item.note?.trim()) lines.push('', item.note.trim());
  }
  return `${lines.join('\n')}\n`;
}
