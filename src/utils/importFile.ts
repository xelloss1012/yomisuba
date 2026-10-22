import { decodeHtml, htmlToEpub } from './htmlToEpub';
import { decodeText, textToEpub } from './textToEpub';

const isEpub = (file: File) => /\.epub$/i.test(file.name) || file.type.includes('epub') || file.type.includes('zip');
const isPlainText = (file: File) => /\.(txt|text)$/i.test(file.name) || file.type === 'text/plain';
const isHtml = (file: File) => /\.(html?|xhtml)$/i.test(file.name) || file.type === 'text/html' || file.type === 'application/xhtml+xml';

/** Whether the app can open this file: an EPUB, or a text or HTML file it converts. */
export const isImportable = (file: File): boolean => isEpub(file) || isPlainText(file) || isHtml(file);

export interface ImportLabels {
  /** Shown as the author of a text file that does not say. */
  textAuthor: string;
  /** Shown as the author of an HTML file that does not say. */
  htmlAuthor: string;
}

/** The file as something the reader opens: an EPUB as it is, text and HTML converted to one. */
export async function importFileAsEpub(file: File, labels: ImportLabels): Promise<File> {
  if (isEpub(file)) return file;
  const fallbackTitle = file.name.replace(/\.[^.]+$/, '');
  const buffer = await file.arrayBuffer();
  const converted = isHtml(file)
    ? await htmlToEpub(decodeHtml(buffer, decodeText), { fallbackTitle, author: labels.htmlAuthor })
    : await textToEpub(decodeText(buffer), { fallbackTitle, author: labels.textAuthor });
  return new File([converted.blob], `${converted.title}.epub`, { type: 'application/epub+zip' });
}
