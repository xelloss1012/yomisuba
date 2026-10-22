/**
 * Turns plain text (pasted, or from a .txt file) into an EPUB, so that everything the reader does with a
 * book (pages, dictionary, bookmarks, Drive, the shelf) works on it unchanged. Text in Aozora Bunko's
 * notation (漢字《かんじ》, ［＃…］ notes, the 底本 colophon) becomes real furigana and headings.
 */
import JSZip from 'jszip';

export interface TextSection {
  title: string;
  html: string;
}

export interface TextDocument {
  title: string;
  author: string;
  language: string;
  sections: TextSection[];
  /** Images the sections refer to as `images/<name>`. */
  images?: Array<{ name: string; mediaType: string; data: Uint8Array }>;
}

export interface TextImportOptions {
  /** A title the reader typed: used as it is. */
  title?: string;
  /** The title when the text does not give one (a file name). */
  fallbackTitle?: string;
  /** Shown as the author when the text has none ("Pasted text"). */
  author: string;
}

/** Above this the text is refused: it would not be a page to read but a file to process. */
export const MAX_TEXT_CHARACTERS = 20_000_000;
const SECTION_CHARACTERS = 15_000;
export const TITLE_CHARACTERS = 40;

export const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeXml = (text: string) => escapeHtml(text).replace(/"/g, '&quot;');

// --- Reading the bytes -----------------------------------------------------------

const countReplacements = (text: string) => (text.match(/�/g) || []).length;
const countJapanese = (text: string) => (text.match(/[぀-ヿ㐀-鿿]/g) || []).length;

/** The text of a file, whatever the encoding: Japanese text files are often Shift_JIS or EUC-JP. */
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const clean = (text: string) => text.replace(/^﻿/, '');
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return clean(new TextDecoder('utf-16le').decode(bytes));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return clean(new TextDecoder('utf-16be').decode(bytes));
  try {
    return clean(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    // Not UTF-8: the legacy Japanese encodings are tried and the one that reads best wins.
  }
  let best = '';
  let bestScore = -Infinity;
  for (const label of ['shift_jis', 'euc-jp', 'iso-2022-jp']) {
    try {
      const text = new TextDecoder(label).decode(bytes);
      const score = countJapanese(text) - countReplacements(text) * 50;
      if (score > bestScore) {
        best = text;
        bestScore = score;
      }
    } catch {
      // the browser does not know that encoding
    }
  }
  return clean(best || new TextDecoder('utf-8').decode(bytes));
}

/** ja when the text is mostly Japanese: the reader then opens it vertically. */
export function detectLanguage(text: string): string {
  const letters = (text.match(/\p{L}/gu) || []).length;
  return letters > 0 && countJapanese(text) / letters >= 0.2 ? 'ja' : 'und';
}

// --- Aozora notation -------------------------------------------------------------

const KANJI = '々〆ヵヶ一-鿿㐀-䶿豈-﫿';
const RUBY_MARKED = /｜([^《｜\n]+)《([^》\n]+)》/g;
const RUBY_KANJI = new RegExp(`([${KANJI}]+)《([^》\\n]+)》`, 'g');
const NOTE = /［＃[^］]*］/g;
const GAIJI = /※［＃[^］]*?、U\+([0-9A-Fa-f]{4,5})、[^］]*］/g;
const SYMBOL_BLOCK = /-{10,}[ \t]*\n【テキスト中に現れる記号について】[\s\S]*?\n-{10,}[ \t]*\n/;
const HEADING_NOTE = /［＃「([^」]+)」は(大|中|小)見出し］/;
const HEADING_BLOCK = /［＃(大|中|小)見出し］(.+?)［＃\1見出し終わり］/;
const SESAME_NOTE = /([^［\n]+?)［＃「\1」に傍点］/g;

/** Aozora's notation is read only when the text shows it, so that a 《book title》 in ordinary prose is left alone. */
export function isAozoraText(text: string): boolean {
  return text.includes('［＃')
    || text.includes('底本：')
    || (text.match(new RegExp(`[${KANJI}]《[^》\\n]+》`, 'g')) || []).length >= 3;
}

const aozoraInline = (escaped: string): string => escaped
  .replace(GAIJI, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
  .replace(SESAME_NOTE, '<em class="sesame_dot">$1</em>')
  .replace(RUBY_MARKED, '<ruby>$1<rt>$2</rt></ruby>')
  .replace(RUBY_KANJI, '<ruby>$1<rt>$2</rt></ruby>')
  .replace(NOTE, '');

// --- Splitting into sections -----------------------------------------------------

export interface Block {
  kind: 'heading' | 'paragraph' | 'blank';
  html: string;
  text: string;
  /** The level of a heading taken from HTML (1 to 6). */
  level?: number;
}

const HEADING_LINE = /^(第[0-9０-９一二三四五六七八九十百千]+[章話回節幕巻部編]|[序終]章|プロローグ|エピローグ|あとがき|はじめに|おわりに|Chapter\s+\d+|CHAPTER\s+[IVXLC\d]+)/;

const toBlocks = (lines: string[], aozora: boolean): Block[] => {
  const blocks: Block[] = [];
  let blankRun = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (blocks.length > 0 && !blankRun) blocks.push({ kind: 'blank', html: '<p class="blank"><br/></p>', text: '' });
      blankRun = true;
      continue;
    }
    blankRun = false;
    if (aozora) {
      const heading = line.match(HEADING_NOTE) || line.match(HEADING_BLOCK);
      if (heading) {
        const headingText = HEADING_NOTE.test(line) ? heading[1] : heading[2];
        blocks.push({ kind: 'heading', html: `<h2 class="chapter">${aozoraInline(escapeHtml(headingText))}</h2>`, text: headingText });
        continue;
      }
      // A line made only of notes (an indentation, a page break) leaves nothing behind.
      if (trimmed.replace(NOTE, '').trim() === '') continue;
    }
    const html = aozora ? aozoraInline(escapeHtml(line)) : escapeHtml(line);
    const looksLikeHeading = trimmed.length <= 30 && HEADING_LINE.test(trimmed);
    blocks.push({ kind: looksLikeHeading ? 'heading' : 'paragraph', html: looksLikeHeading ? `<h2 class="chapter">${html.trim()}</h2>` : `<p>${html}</p>`, text: trimmed });
  }
  while (blocks.length > 0 && blocks[blocks.length - 1].kind === 'blank') blocks.pop();
  return blocks;
};

export const splitSections = (blocks: Block[], title: string): TextSection[] => {
  const headings = blocks.filter((block) => block.kind === 'heading').length;
  if (headings >= 2) {
    const sections: TextSection[] = [];
    let current: { title: string; html: string[] } = { title, html: [] };
    for (const block of blocks) {
      if (block.kind === 'heading' && current.html.some((html) => !html.startsWith('<p class="blank"'))) {
        sections.push({ title: current.title, html: current.html.join('\n') });
        current = { title: block.text, html: [] };
      } else if (block.kind === 'heading') {
        current = { title: block.text, html: current.html };
      }
      current.html.push(block.html);
    }
    if (current.html.length > 0) sections.push({ title: current.title, html: current.html.join('\n') });
    return sections;
  }

  // No headings: by size, at a paragraph boundary, so that a long text is not one huge page of markup.
  const sections: TextSection[] = [];
  let html: string[] = [];
  let size = 0;
  for (const block of blocks) {
    html.push(block.html);
    size += block.text.length;
    if (size >= SECTION_CHARACTERS) {
      sections.push({ title: String(sections.length + 1), html: html.join('\n') });
      html = [];
      size = 0;
    }
  }
  if (html.length > 0) {
    // A short tail goes with the section before it.
    if (sections.length > 0 && size < SECTION_CHARACTERS / 3) {
      sections[sections.length - 1].html += `\n${html.join('\n')}`;
    } else {
      sections.push({ title: sections.length === 0 ? title : String(sections.length + 1), html: html.join('\n') });
    }
  }
  return sections;
};

// --- The document ----------------------------------------------------------------

export const truncate = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** Text to a document: title, author, language and sections of XHTML. */
export function textToDocument(source: string, options: TextImportOptions): TextDocument {
  if (source.length > MAX_TEXT_CHARACTERS) throw new Error('The text is too long.');
  let text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const aozora = isAozoraText(text);
  // Only a file from Aozora itself opens with the title and the author; a pasted passage with a few rubies does not.
  const aozoraFile = text.includes('底本：') || text.includes('［＃') || SYMBOL_BLOCK.test(text);
  if (aozora) text = text.replace(SYMBOL_BLOCK, '');

  let lines = text.split('\n');
  const firstIndex = lines.findIndex((line) => line.trim());
  if (firstIndex < 0) throw new Error('The text is empty.');

  let title = options.title?.trim() || '';
  let author = '';
  if (aozoraFile) {
    // The title and, on the next line, the author.
    const titleLine = lines[firstIndex].trim();
    const nextIndex = lines.findIndex((line, index) => index > firstIndex && line.trim());
    const nextLine = nextIndex > 0 ? lines[nextIndex].trim() : '';
    const authorLooksRight = nextIndex === firstIndex + 1 && nextLine.length <= 30 && !/[。、《［]/.test(nextLine);
    if (!title) title = titleLine;
    if (authorLooksRight) author = nextLine;
    lines = lines.slice(authorLooksRight ? nextIndex + 1 : firstIndex + 1);
  }
  if (!title) title = options.fallbackTitle?.trim() || lines[firstIndex].trim();
  title = truncate(title, TITLE_CHARACTERS);

  // The colophon (底本：…) is kept as the last section.
  let colophon: string[] = [];
  const colophonAt = aozora ? lines.findIndex((line) => line.startsWith('底本：')) : -1;
  if (colophonAt >= 0) {
    colophon = lines.slice(colophonAt);
    lines = lines.slice(0, colophonAt);
  }

  const blocks = toBlocks(lines, aozora);
  if (blocks.length === 0) throw new Error('The text is empty.');
  const sections = splitSections(blocks, title);
  if (colophon.length > 0) {
    const colophonBlocks = toBlocks(colophon, true);
    sections.push({ title: '底本', html: colophonBlocks.map((block) => block.html).join('\n') });
  }
  return { title, author: author || options.author, language: detectLanguage(text), sections };
}

// --- The EPUB --------------------------------------------------------------------

const STYLE = `body { line-height: 1.9; margin: 0; padding: 0; }
h1 { font-size: 1.6em; margin: 1em 0 0.4em; }
h2 { font-size: 1.25em; margin: 1em 0; }
ruby > rt { font-size: 0.5em; }
em.sesame_dot { font-style: normal; -webkit-text-emphasis: filled sesame; text-emphasis: filled sesame; }
.author { margin: 0 0 2em; }
`;

/** A short stable fingerprint of the text, for the book's identifier. */
const fingerprint = (text: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
};

const page = (language: string, title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles/style.css"/>
</head>
<body>
${body}
</body>
</html>
`;

export interface ConvertedText {
  blob: Blob;
  title: string;
  author: string;
  language: string;
}

/** Builds the EPUB of a document. */
export async function documentToEpub(document: TextDocument, identifierSeed: string): Promise<Blob> {
  const { title, author, language, sections } = document;
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`);
  zip.file('OEBPS/styles/style.css', STYLE);
  for (const image of document.images ?? []) zip.file(`OEBPS/images/${image.name}`, image.data);

  const files = sections.map((section, index) => ({
    id: `s${index + 1}`,
    file: `section${String(index + 1).padStart(3, '0')}.xhtml`,
    title: section.title,
    html: index === 0
      ? `<h1>${escapeHtml(title)}</h1>\n<p class="author">${escapeHtml(author)}</p>\n${section.html}`
      : section.html,
  }));
  for (const file of files) zip.file(`OEBPS/${file.file}`, page(language, file.title, file.html));

  const navItems = files.map((file) => `      <li><a href="${file.file}">${escapeHtml(file.title)}</a></li>`).join('\n');
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>
`);
  const identifier = `urn:yomisuba:text:${fingerprint(identifierSeed)}`;
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${escapeXml(identifier)}"/></head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${files.map((file, index) => `    <navPoint id="np${index + 1}" playOrder="${index + 1}"><navLabel><text>${escapeXml(file.title)}</text></navLabel><content src="${file.file}"/></navPoint>`).join('\n')}
  </navMap>
</ncx>
`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0" xml:lang="${language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${language}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="styles/style.css" media-type="text/css"/>
${(document.images ?? []).map((image, index) => `    <item id="img${index + 1}" href="images/${image.name}" media-type="${image.mediaType}"/>`).join('\n')}
${files.map((file) => `    <item id="${file.id}" href="${file.file}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine${language === 'ja' ? ' page-progression-direction="rtl"' : ''} toc="ncx">
${files.map((file) => `    <itemref idref="${file.id}"/>`).join('\n')}
  </spine>
</package>
`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
}

/** Text to an EPUB. */
export async function textToEpub(text: string, options: TextImportOptions): Promise<ConvertedText> {
  const document = textToDocument(text, options);
  const blob = await documentToEpub(document, `${document.title}\n${text}`);
  return { blob, title: document.title, author: document.author, language: document.language };
}
