/**
 * Turns a saved web page or any HTML file into an EPUB (see textToEpub.ts for why an EPUB). The page is
 * read for its article, cleaned of everything that could run or load from elsewhere, and cut into
 * sections at its headings. A page of Aozora Bunko keeps its furigana and its text exactly.
 */
import { Readability } from '@mozilla/readability';
import {
  Block,
  ConvertedText,
  TITLE_CHARACTERS,
  TextDocument,
  TextImportOptions,
  detectLanguage,
  documentToEpub,
  escapeHtml,
  splitSections,
  truncate,
} from './textToEpub';

export interface HtmlImportOptions extends TextImportOptions {
  /** Builds a document from HTML. The browser's DOMParser unless a test supplies another. */
  parse?: (html: string) => Document;
}

const MAX_HTML_CHARACTERS = 20_000_000;
const MAX_IMAGE_BYTES = 4_000_000;
const MIN_ARTICLE_CHARACTERS = 200;

// --- Reading the bytes -----------------------------------------------------------

/** The text of an HTML file: the charset the page declares wins, then the usual guesses. */
export function decodeHtml(buffer: ArrayBuffer, decodeFallback: (buffer: ArrayBuffer) => string): string {
  const head = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2048)));
  const declared = head.match(/(?:charset|encoding)\s*=\s*["']?([\w-]+)/i)?.[1];
  if (declared && !/^utf-?8$/i.test(declared)) {
    try {
      const text = new TextDecoder(declared).decode(buffer);
      if (!text.includes('�')) return text.replace(/^﻿/, '');
    } catch {
      // an encoding the browser does not know: guessed below
    }
  }
  return decodeFallback(buffer);
}

// --- Cleaning and cutting --------------------------------------------------------

const REMOVED = new Set([
  'script', 'style', 'noscript', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea',
  'svg', 'canvas', 'video', 'audio', 'head', 'link', 'meta', 'template', 'nav', 'aside', 'footer', 'dialog',
]);
const BLOCKS = new Set([
  'p', 'div', 'section', 'article', 'main', 'header', 'blockquote', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'figure', 'figcaption', 'address', 'details', 'summary', 'center',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'body', 'html', 'caption',
]);
const INLINE_KEPT = new Set([
  'ruby', 'rb', 'rt', 'rp', 'em', 'strong', 'b', 'i', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'small',
  'mark', 'q', 'cite', 'code', 'kbd', 'samp', 'var', 'abbr', 'time',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const IMAGE_TYPES: Record<string, string> = { png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', webp: 'webp' };

const CJK = '぀-ヿ㐀-鿿＀-￯';
const SEGMENT_BREAK = new RegExp(`([${CJK}])\\s*\\n\\s*([${CJK}])`, 'g');

// Only ASCII whitespace is cut off the ends of a line: a full-width space (　) opening a paragraph is an indent.
const trimAscii = (text: string) => text.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '');

const collapse = (text: string) => text.replace(SEGMENT_BREAK, '$1$2').replace(/[ \t\r\n\f]+/g, ' ');

interface Cleaner {
  blocks: Block[];
  images: NonNullable<TextDocument['images']>;
}

const decodeDataUri = (src: string): { mediaType: string; extension: string; data: Uint8Array } | null => {
  const match = src.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const binary = atob(match[2].replace(/\s+/g, ''));
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
  const kind = match[1].toLowerCase();
  return { mediaType: `image/${kind === 'jpg' ? 'jpeg' : kind}`, extension: IMAGE_TYPES[kind], data };
};

/** Turns the content of an element into blocks: paragraphs (a <br> ends a line), headings and gaps. */
function blockify(root: Element): Cleaner {
  const cleaner: Cleaner = { blocks: [], images: [] };
  let imageBytes = 0;
  let line = '';

  const pushBlank = () => {
    const last = cleaner.blocks[cleaner.blocks.length - 1];
    if (cleaner.blocks.length > 0 && last.kind !== 'blank') {
      cleaner.blocks.push({ kind: 'blank', html: '<p class="blank"><br/></p>', text: '' });
    }
  };
  const flush = () => {
    const text = line.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim();
    const hasImage = line.includes('<img ');
    if (text || hasImage) cleaner.blocks.push({ kind: 'paragraph', html: `<p>${trimAscii(line)}</p>`, text });
    line = '';
  };

  const image = (element: Element): string => {
    const alt = (element.getAttribute('alt') || '').trim();
    const decoded = decodeDataUri((element.getAttribute('src') || '').trim());
    // A picture that is not inside the file cannot be fetched: its description stands for it (Aozora's gaiji do this).
    if (!decoded || imageBytes + decoded.data.length > MAX_IMAGE_BYTES) return escapeHtml(alt);
    imageBytes += decoded.data.length;
    const name = `image${cleaner.images.length + 1}.${decoded.extension}`;
    cleaner.images.push({ name, mediaType: decoded.mediaType, data: decoded.data });
    return `<img src="images/${name}" alt="${escapeHtml(alt).replace(/"/g, '&quot;')}"/>`;
  };

  const inline = (node: Node): string => {
    if (node.nodeType === 3) return escapeHtml(collapse(node.textContent || ''));
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (REMOVED.has(tag)) return '';
    if (tag === 'br') return '<br/>';
    if (tag === 'img') return image(element);
    const inner = Array.from(element.childNodes).map(inline).join('');
    if (!INLINE_KEPT.has(tag)) return inner; // span, a, font…: only what is inside
    const keepsDots = tag === 'em' && /\bsesame_dot\b/.test(element.getAttribute('class') || '');
    return `<${tag}${keepsDots ? ' class="sesame_dot"' : ''}>${inner}</${tag}>`;
  };

  const walk = (parent: Node) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === 3) {
        line += escapeHtml(collapse(node.textContent || ''));
        continue;
      }
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      const tag = element.tagName.toLowerCase();
      if (REMOVED.has(tag)) continue;
      if (tag === 'br') {
        if (line.trim()) flush();
        else pushBlank();
        line = '';
      } else if (tag === 'hr') {
        flush();
        pushBlank();
      } else if (HEADINGS.has(tag)) {
        flush();
        const html = Array.from(element.childNodes).map(inline).join('').trim();
        const text = html.replace(/<[^>]*>/g, '').trim();
        if (text) cleaner.blocks.push({ kind: 'heading', html: `<h2 class="chapter">${html}</h2>`, text, level: Number(tag[1]) });
      } else if (tag === 'li') {
        flush();
        line = '・';
        walk(element);
        flush();
      } else if (tag === 'tr') {
        flush();
        line = Array.from(element.children).map((cell) => Array.from(cell.childNodes).map(inline).join('').trim()).filter(Boolean).join(' ｜ ');
        flush();
      } else if (BLOCKS.has(tag)) {
        flush();
        walk(element);
        flush();
      } else {
        line += inline(element);
      }
    }
  };

  walk(root);
  flush();
  while (cleaner.blocks.length > 0 && cleaner.blocks[cleaner.blocks.length - 1].kind === 'blank') cleaner.blocks.pop();
  return cleaner;
}

// --- Choosing the page's text ----------------------------------------------------

const textOf = (element: Element | null | undefined) => (element?.textContent || '').replace(/\s+/g, ' ').trim();

interface Extracted {
  container: Element;
  title: string;
  author: string;
  lang: string;
  /** The content is the whole text of an Aozora Bunko page: nothing to remove from it. */
  exact: boolean;
}

function extract(doc: Document, parse: (html: string) => Document): Extracted {
  const lang = (doc.documentElement?.getAttribute('lang') || doc.documentElement?.getAttribute('xml:lang') || '').trim();
  const meta = (selector: string) => doc.querySelector(selector)?.getAttribute('content')?.trim() || '';

  // Aozora Bunko: the title and author have their own elements, and the text its own block.
  const aozora = doc.querySelector('.main_text');
  if (aozora) {
    return {
      container: aozora,
      title: textOf(doc.querySelector('h1.title')),
      author: textOf(doc.querySelector('h2.author')),
      lang,
      exact: true,
    };
  }

  // The page's <title> usually carries the name of the site as well ("猫の話 | 例のサイト"): the heading is the title.
  const heading = textOf(doc.querySelector('h1'));
  const cleanTitle = (title: string) => (heading && title.includes(heading) && heading.length < title.length ? heading : title.trim());
  const pageTitle = cleanTitle(textOf(doc.querySelector('title')));
  const author = meta('meta[name="author"]') || meta('meta[property="article:author"]') || meta('meta[property="og:site_name"]');

  // The article of a page: what Firefox's reading view shows, without menus and comments.
  try {
    const article = new Readability(doc.cloneNode(true) as Document, { charThreshold: MIN_ARTICLE_CHARACTERS }).parse();
    if (article && (article.textContent || '').replace(/\s+/g, '').length >= MIN_ARTICLE_CHARACTERS) {
      const body = parse(`<!doctype html><html><body>${article.content}</body></html>`).body;
      return { container: body, title: article.title ? cleanTitle(article.title) : pageTitle, author: (article.byline || author).trim(), lang: (article.lang || lang).trim(), exact: false };
    }
  } catch {
    // a page Readability cannot read: the whole page is used
  }
  const container = doc.querySelector('article, main, [role="main"]') || doc.body || doc.documentElement;
  return { container, title: pageTitle || textOf(doc.querySelector('h1')), author, lang, exact: false };
}

/** HTML to a document: the title, the sections and the images the sections carry. */
export function htmlToDocument(html: string, options: HtmlImportOptions): TextDocument {
  if (html.length > MAX_HTML_CHARACTERS) throw new Error('The page is too long.');
  const parse = options.parse ?? ((source: string) => new DOMParser().parseFromString(source, 'text/html'));
  const doc = parse(html);
  const extracted = extract(doc, parse);

  const { blocks, images } = blockify(extracted.container);
  if (blocks.length === 0) throw new Error('The page has no text to read.');

  let title = options.title?.trim() || extracted.title || options.fallbackTitle?.trim() || '';

  // A single <h1> is the title of the page: it is not repeated in the text.
  const h1 = blocks.filter((block) => block.kind === 'heading' && block.level === 1);
  if (h1.length === 1 && (!title || h1[0].text === title || title.includes(h1[0].text))) {
    if (!options.title?.trim()) title = h1[0].text;
    blocks.splice(blocks.indexOf(h1[0]), 1);
  }
  if (!title) title = blocks.find((block) => block.kind === 'paragraph')?.text || '';
  title = truncate(title, TITLE_CHARACTERS);
  // Readability turns the page's <h1> into an <h2>: a first heading that says the title is the title again.
  const opening = blocks.findIndex((block) => block.kind !== 'blank');
  if (opening >= 0 && blocks[opening].kind === 'heading' && blocks[opening].text.length > 0 && title.startsWith(truncate(blocks[opening].text, TITLE_CHARACTERS))) {
    blocks.splice(opening, 1);
  }

  // The chapters are cut at the first level of heading that occurs at least twice; the other headings
  // stay in the text as they are.
  const splitLevel = [1, 2, 3, 4, 5, 6].find((level) => blocks.filter((block) => block.kind === 'heading' && block.level === level).length >= 2);
  for (const block of blocks) {
    if (block.kind === 'heading' && block.level !== splitLevel) block.kind = 'paragraph';
  }
  const sections = splitSections(blocks, title);
  const text = blocks.map((block) => block.text).join('\n');
  const declared = extracted.lang.toLowerCase().split(/[-_]/)[0];
  const known = /^[a-z]{2,3}$/.test(declared) ? declared : '';
  // A page that says it is Japanese or Chinese is believed; one that says nothing (or something else) is read.
  const language = known === 'ja' || known === 'zh' ? known : detectLanguage(text) === 'ja' ? 'ja' : known || 'und';
  return { title, author: extracted.author || options.author, language, sections, images };
}

/** HTML to an EPUB. */
export async function htmlToEpub(html: string, options: HtmlImportOptions): Promise<ConvertedText> {
  const document = htmlToDocument(html, options);
  const blob = await documentToEpub(document, `${document.title}\n${html.length}\n${html.slice(0, 4000)}`);
  return { blob, title: document.title, author: document.author, language: document.language };
}
