// Builds the Yomisuba library: public-domain Japanese books from Aozora Bunko
// (https://www.aozora.gr.jp/) as EPUB files with a cover, plus the catalog the
// app reads. The output goes to the public yomisuba-library repository.
//
//   node scripts/build-library.mjs <library-dir> [--redraw-covers] [slug ...]
//
// A cover that already exists is kept: Chrome does not draw the same bytes twice, and
// redrawing would change every book (and its checksum) on each build.
//
// <library-dir>/sources.json lists the curated books (Aozora work id, genres and
// descriptions). Everything else comes from Aozora's own catalogue: title,
// author, edition credits and, before anything is built, the copyright flags,
// so a work that is not clearly in the public domain is refused.
//
// Needs Google Chrome or Edge to draw the covers (CHROME_PATH overrides the
// lookup). The estimated difficulty uses the same JLPT and frequency lists as the
// app (src/data/word-levels.json.gz).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import kuromoji from 'kuromoji';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const redrawCovers = process.argv.includes('--redraw-covers');
const [libraryArg, ...onlySlugs] = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
if (!libraryArg) {
  console.error('Usage: node scripts/build-library.mjs <library-dir> [--redraw-covers] [slug ...]');
  process.exit(1);
}
const libraryDir = resolve(libraryArg);
const sources = JSON.parse(readFileSync(join(libraryDir, 'sources.json'), 'utf8'));

const CATALOG_SCHEMA = 1;
const CACHE_DIR = join(tmpdir(), 'yomisuba-library-cache');
const USER_AGENT = 'Yomisuba-library-builder (https://github.com/xelloss1012/yomisuba)';
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');
const CHARS_PER_PAGE = 600; // a paperback (bunko) page, for the "about N pages" figure
// Difficulty, 1 (easiest) to 5: how much of the vocabulary is N2 or easier. Aozora's
// literature is never beginner material, so these cuts spread it out; they are an
// estimate for ordering books, not an official level.
const LEVEL_SCORE_CUTS = [0.88, 0.80, 0.74, 0.68];
// Measured in windows of fixed size and averaged, so a long novel is not rated harder than
// a short story just for having more different words. Within a window a word repeated many
// times is learnt once: it counts at most REPEAT_CAP times.
const WINDOW_WORDS = 400;
const REPEAT_CAP = 3;
// The library is downloaded from anywhere, so it follows the longest common term and
// not just Japanese law (which Aozora applies: authors dead before 1968). Authors who
// died up to 1945 are in the public domain in Japan, the United States, the EU (life+70)
// and Spain (life+80 for authors who died before 1987). A few countries (Mexico) go further.
const LAST_DEATH_YEAR = 1945;

const GENRES = {
  fantasy: { ja: 'ファンタジー', color: '#33407f' },
  scifi: { ja: 'SF', color: '#0f6470' },
  mystery: { ja: 'ミステリー', color: '#47365a' },
  horror: { ja: 'ホラー・怪談', color: '#58202b' },
  romance: { ja: '恋愛', color: '#9b3f5a' },
  historical: { ja: '歴史', color: '#664e2f' },
  humor: { ja: 'ユーモア', color: '#a8721f' },
  drama: { ja: 'ドラマ', color: '#38543f' },
  children: { ja: '童話・児童文学', color: '#b8563a' },
};

mkdirSync(CACHE_DIR, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function fetchCached(url, name = createHash('sha1').update(url).digest('hex')) {
  const file = join(CACHE_DIR, name);
  if (existsSync(file)) return readFileSync(file);
  await sleep(300);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  writeFileSync(file, data);
  return data;
}

// --- Aozora catalogue -------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  return rows;
}

async function loadAozoraCatalogue() {
  const zipData = await fetchCached('https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip', 'aozora-list.zip');
  const zip = await JSZip.loadAsync(zipData);
  const csv = await zip.file('list_person_all_extended_utf8.csv').async('string');
  const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
  const header = rows[0];
  const byId = new Map();
  for (const row of rows.slice(1)) {
    const record = Object.fromEntries(header.map((name, index) => [name, row[index] ?? '']));
    if (record['役割フラグ'] === '著者' && !byId.has(record['作品ID'])) byId.set(record['作品ID'], record);
  }
  return byId;
}

function assertPublicDomain(record, id) {
  const deathYear = Number(record['没年月日'].slice(0, 4));
  if (record['作品著作権フラグ'] !== 'なし' || record['人物著作権フラグ'] !== 'なし') {
    throw new Error(`Aozora ${id} is not flagged as free of copyright.`);
  }
  if (!deathYear || deathYear > LAST_DEATH_YEAR) {
    throw new Error(`Aozora ${id}: the author died in ${deathYear || 'an unknown year'}; only authors who died up to ${LAST_DEATH_YEAR} are accepted.`);
  }
}

// --- Text helpers -----------------------------------------------------------------

const decodeEntities = (text) => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&amp;/g, '&');

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Reading text of a fragment: no furigana, no tags, a placeholder for the glyphs Aozora ships as images. */
const plainText = (html) => decodeEntities(
  html
    .replace(/<rt>.*?<\/rt>/gs, '')
    .replace(/<rp>.*?<\/rp>/gs, '')
    .replace(/<img[^>]*class="gaiji"[^>]*>/g, '〓')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, ''),
);

/** Aozora numbers the episodes of a series in the subtitle ("01 お文の魂"); the number is not part of the title. */
const subtitleOf = (record) => record['副題'].replace(/^\d+\s+/, '');
const workTitle = (record) => record['作品名'] + (subtitleOf(record) ? ` ${subtitleOf(record)}` : '');

const divBalance = (html) => (html.match(/<div[\s>]/g) || []).length - (html.match(/<\/div>/g) || []).length;

// --- Converting an Aozora XHTML file into book content ----------------------------------

async function convertWork(record, source) {
  const htmlUrl = record['XHTML/HTMLファイルURL'];
  const html = new TextDecoder('shift_jis').decode(await fetchCached(htmlUrl, `${source.aozoraId}.html`));
  const mainStart = html.indexOf('<div class="main_text">');
  const creditsStart = html.indexOf('<div class="bibliographical_information">');
  if (mainStart < 0 || creditsStart < mainStart) throw new Error(`${htmlUrl}: unexpected layout.`);

  let body = html.slice(mainStart + '<div class="main_text">'.length, creditsStart).replace(/<\/div>\s*$/, '');
  body = body
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/&nbsp;/g, '&#160;')
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;');
  if (divBalance(body) !== 0) throw new Error(`${htmlUrl}: unbalanced <div> in the text.`);

  // Glyphs Aozora cannot write in Unicode (and any illustration) come as images: ship them in the EPUB.
  const images = new Map();
  const imageTags = [...body.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g)];
  for (const [, src] of new Set(imageTags.map((match) => [match[0], match[1]]))) {
    const absolute = new URL(src, htmlUrl);
    const name = absolute.pathname.includes('/gaiji/')
      ? `gaiji-${absolute.pathname.split('/gaiji/')[1].replace(/\//g, '-')}`
      : basename(absolute.pathname);
    if (!images.has(src)) images.set(src, { name, data: await fetchCached(absolute.href, `img-${name}`) });
  }
  for (const [src, { name }] of images) body = body.split(`src="${src}"`).join(`src="images/${name}"`);

  const creditsEnd = html.indexOf('<div class="notation_notes">');
  const creditsHtml = html
    .slice(creditsStart, creditsEnd > 0 ? creditsEnd : undefined)
    .replace(/^<div class="bibliographical_information">\s*<hr\s*\/>/, '')
    .replace(/<\/div>\s*$/, '')
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/g, '&amp;')
    .trim();

  return { body, creditsHtml, images: [...images.values()] };
}

/** Splits at the headings of the most prominent level that occurs at least twice. */
function splitChapters(body, fallbackTitle) {
  const headingPattern = (cls) => new RegExp(`<h([345]) class="${cls}-midashi"[^>]*>(.*?)</h\\1>`, 'gs');
  for (const cls of ['o', 'naka', 'ko']) {
    const headings = [...body.matchAll(headingPattern(cls))];
    if (headings.length < 2) continue;
    const starts = headings.map((match) => {
      // A heading is often wrapped in an indentation <div> that has to travel with it.
      const wrapper = body.slice(0, match.index).match(/<div class="jisage_\d+"[^>]*>\s*$/);
      return wrapper ? match.index - wrapper[0].length : match.index;
    });
    const chapters = [];
    const preface = body.slice(0, starts[0]);
    if (plainText(preface).trim()) chapters.push({ title: fallbackTitle, html: preface });
    headings.forEach((match, index) => {
      chapters.push({
        title: plainText(match[2]).trim() || fallbackTitle,
        html: body.slice(starts[index], starts[index + 1] ?? body.length),
      });
    });
    if (chapters.every((chapter) => divBalance(chapter.html) === 0)) return chapters;
    console.warn('  headings split a block: keeping the text as one chapter');
    break;
  }
  return [{ title: fallbackTitle, html: body }];
}

// --- EPUB -------------------------------------------------------------------------

const STYLE = `html { -epub-writing-mode: vertical-rl; }
body { line-height: 1.9; margin: 0; padding: 0; }
h1, h2, h3, h4, h5 { font-weight: bold; }
h1 { font-size: 1.8em; margin: 1.2em 0 0.6em; }
h2 { font-size: 1.2em; margin: 0.6em 0; }
h3.o-midashi { font-size: 1.4em; }
h4.naka-midashi { font-size: 1.2em; }
h5.ko-midashi { font-size: 1.1em; }
h3, h4, h5 { margin: 1em 0; }
ruby > rt { font-size: 0.5em; }
em.sesame_dot { font-style: normal; -webkit-text-emphasis: filled sesame; text-emphasis: filled sesame; }
.gaiji { height: 1em; width: 1em; vertical-align: text-bottom; }
img { max-width: 100%; }
.colophon { font-size: 0.85em; line-height: 1.7; }
.colophon p { margin: 0.6em 0; }
`;

const xhtmlPage = (title, content, extraClass = '') => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles/style.css"/>
</head>
<body${extraClass ? ` class="${extraClass}"` : ''}>
${content}
</body>
</html>
`;

async function buildEpub({ source, record, converted, chapters, coverPng, description }) {
  const title = workTitle(record);
  const author = record['姓'] + record['名'];
  const zip = new JSZip();
  const add = (name, data, options = {}) => zip.file(name, data, { date: FIXED_DATE, createFolders: false, ...options });
  add('mimetype', 'application/epub+zip', { compression: 'STORE' });
  add('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`);
  add('OEBPS/styles/style.css', STYLE);
  add('OEBPS/images/cover.png', coverPng);
  for (const image of converted.images) add(`OEBPS/images/${image.name}`, image.data);

  const pages = [
    { id: 'title', file: 'title.xhtml', title, html: xhtmlPage(title, `<div class="metadata">\n<h1 class="title">${escapeXml(record['作品名'])}</h1>\n${subtitleOf(record) ? `<h2 class="subtitle">${escapeXml(subtitleOf(record))}</h2>\n` : ''}<h2 class="author">${escapeXml(author)}</h2>\n</div>`) },
    ...chapters.map((chapter, index) => {
      const file = `ch${String(index + 1).padStart(3, '0')}.xhtml`;
      return { id: `ch${index + 1}`, file, title: chapter.title, html: xhtmlPage(chapter.title, chapter.html) };
    }),
  ];
  const credits = `<div class="colophon">
<h2>底本・クレジット</h2>
<p>この作品は青空文庫（<a href="https://www.aozora.gr.jp/">https://www.aozora.gr.jp/</a>）の公開テキストをもとに、Yomisubaの図書館用にEPUBへ変換したものです。作品は著作権が消滅したパブリックドメインです。図書カード：<a href="${escapeXml(record['図書カードURL'])}">${escapeXml(record['図書カードURL'])}</a></p>
<p>${converted.creditsHtml}</p>
</div>`;
  pages.push({ id: 'colophon', file: 'colophon.xhtml', title: '底本・クレジット', html: xhtmlPage('底本・クレジット', credits) });
  for (const page of pages) add(`OEBPS/${page.file}`, page.html);

  const identifier = `urn:aozora:${source.aozoraId}`;
  const modified = `${(record['XHTML/HTMLファイル最終更新日'] || record['最終更新日']).replace(/-/g, '-')}T00:00:00Z`;
  const subjects = source.genres.map((genre) => `    <dc:subject>${escapeXml(GENRES[genre].ja)}</dc:subject>`).join('\n');
  add('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0" xml:lang="ja">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${identifier}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>ja</dc:language>
    <dc:publisher>青空文庫 / Yomisuba</dc:publisher>
    <dc:description>${escapeXml(description)}</dc:description>
${subjects}
    <dc:rights>Public domain. Text from Aozora Bunko (https://www.aozora.gr.jp/).</dc:rights>
    <dc:source>${escapeXml(record['図書カードURL'])}</dc:source>
    <meta property="dcterms:modified">${modified}</meta>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="styles/style.css" media-type="text/css"/>
    <item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>
${converted.images.map((image, index) => `    <item id="img${index + 1}" href="images/${image.name}" media-type="${/\.png$/i.test(image.name) ? 'image/png' : /\.gif$/i.test(image.name) ? 'image/gif' : 'image/jpeg'}"/>`).join('\n')}
${pages.map((page) => `    <item id="${page.id}" href="${page.file}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine page-progression-direction="rtl" toc="ncx">
${pages.map((page) => `    <itemref idref="${page.id}"/>`).join('\n')}
  </spine>
</package>
`);
  add('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head><meta charset="utf-8"/><title>目次</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目次</h1>
    <ol>
${pages.map((page) => `      <li><a href="${page.file}">${escapeXml(page.title)}</a></li>`).join('\n')}
    </ol>
  </nav>
</body>
</html>
`);
  add('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${identifier}"/></head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${pages.map((page, index) => `    <navPoint id="np${index + 1}" playOrder="${index + 1}"><navLabel><text>${escapeXml(page.title)}</text></navLabel><content src="${page.file}"/></navPoint>`).join('\n')}
  </navMap>
</ncx>
`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, mimeType: 'application/epub+zip' });
}

// --- Cover ------------------------------------------------------------------------

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Chrome or Edge is needed to draw the covers; set CHROME_PATH.');
  return found;
}

function renderCover({ title, author, genres, slug }) {
  const color = GENRES[genres[0]].color;
  const length = [...title].length;
  const titleSize = length <= 6 ? 88 : length <= 9 ? 70 : length <= 12 ? 56 : 46;
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
html,body{margin:0;width:600px;height:900px;overflow:hidden}
body{background:${color};color:#f6f1e6;font-family:"Yu Mincho","Hiragino Mincho ProN","Noto Serif JP","MS Mincho",serif;position:relative}
.band{position:absolute;left:0;right:0;bottom:0;height:150px;background:rgba(0,0,0,.28)}
.frame{position:absolute;inset:26px;border:2px solid #d9d2c3}
.frame::after{content:"";position:absolute;inset:7px;border:1px solid #a9a395}
.genre{position:absolute;top:52px;left:0;right:0;text-align:center;font-size:22px;letter-spacing:.3em;opacity:.8}
.title{position:absolute;right:150px;top:130px;height:620px;writing-mode:vertical-rl;font-size:${titleSize}px;font-weight:bold;letter-spacing:.08em;line-height:1.25}
.author{position:absolute;left:120px;bottom:130px;height:380px;writing-mode:vertical-rl;font-size:34px;letter-spacing:.2em;opacity:.92}
.foot{position:absolute;bottom:50px;left:0;right:0;text-align:center;font-size:18px;letter-spacing:.25em;opacity:.7}
</style><div class="band"></div><div class="frame"></div>
<div class="genre">${escapeXml(genres.map((genre) => GENRES[genre].ja).join(' ・ '))}</div>
<div class="title">${escapeXml(title)}</div><div class="author">${escapeXml(author)}</div>
<div class="foot">青空文庫 ・ Yomisuba</div></html>`;
  const htmlFile = join(CACHE_DIR, `cover-${slug}.html`);
  const pngFile = join(CACHE_DIR, `cover-${slug}.png`);
  writeFileSync(htmlFile, html);
  const result = spawnSync(findBrowser(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=600,900', `--screenshot=${pngFile}`, pathToFileURL(htmlFile).href,
  ], { timeout: 90000, stdio: 'ignore' });
  if (result.status !== 0 || !existsSync(pngFile)) throw new Error(`Could not draw the cover of ${slug}.`);
  const png = readFileSync(pngFile);
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (width !== 600 || height !== 900) throw new Error(`Cover of ${slug} is ${width}x${height}, not 600x900.`);
  return png;
}

// --- Difficulty -------------------------------------------------------------------

const CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '副詞', '連体詞']);
const SKIPPED_NOUNS = new Set(['固有名詞', '数', '非自立', '接尾', '代名詞']);

async function createDifficultyEstimator() {
  const server = await createServer({
    configFile: resolve(root, 'vite.config.ts'),
    root,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const levels = await server.ssrLoadModule('/src/utils/wordLevels.ts');
  const data = await levels.loadWordLevels();
  const tokenizer = await new Promise((done, fail) =>
    kuromoji.builder({ dicPath: join(root, 'node_modules/kuromoji/dict') }).build((error, built) => (error ? fail(error) : done(built))));

  return {
    estimate(text) {
      const words = [];
      // A glyph Aozora can only draw as an image breaks the word around it (a name, usually): leave it out.
      for (const line of text.replace(/〓[一-龥々]*/g, '').split('\n')) {
        if (!line.trim()) continue;
        for (const token of tokenizer.tokenize(line)) {
          if (!CONTENT_POS.has(token.pos) || SKIPPED_NOUNS.has(token.pos_detail_1)) continue;
          const forms = [token.basic_form !== '*' ? token.basic_form : '', token.surface_form].filter(Boolean);
          words.push({ lemma: forms[0], level: levels.classifyForms(data, forms) });
        }
      }
      const windows = [];
      for (let start = 0; start < words.length; start += WINDOW_WORDS) windows.push(words.slice(start, start + WINDOW_WORDS));
      // A short tail would be measured on too few words.
      if (windows.length > 1 && windows[windows.length - 1].length < WINDOW_WORDS / 2) windows.pop();

      const levelNames = [5, 4, 3, 2, 1];
      const sums = Object.fromEntries(levelNames.map((jlpt) => [`N${jlpt}`, 0]));
      for (const windowWords of windows) {
        const seen = new Map();
        const known = Object.fromEntries(levelNames.map((jlpt) => [`N${jlpt}`, 0]));
        let counted = 0;
        for (const word of windowWords) {
          const times = (seen.get(word.lemma) || 0) + 1;
          seen.set(word.lemma, times);
          if (times > REPEAT_CAP) continue;
          counted += 1;
          for (const jlpt of levelNames) if (levels.isWithinLevel(word.level, jlpt)) known[`N${jlpt}`] += 1;
        }
        for (const name of Object.keys(sums)) sums[name] += known[name] / counted;
      }
      const coverage = Object.fromEntries(Object.entries(sums).map(([name, sum]) => [name, Number((sum / windows.length).toFixed(3))]));
      const score = LEVEL_SCORE_CUTS.findIndex((cut) => coverage.N2 >= cut) + 1 || LEVEL_SCORE_CUTS.length + 1;
      return { score, coverage, words: words.length };
    },
    close: () => server.close(),
  };
}

// --- Main -------------------------------------------------------------------------

const aozora = await loadAozoraCatalogue();
const estimator = await createDifficultyEstimator();
mkdirSync(join(libraryDir, 'books'), { recursive: true });
mkdirSync(join(libraryDir, 'covers'), { recursive: true });

const existingCatalog = existsSync(join(libraryDir, 'catalog.json'))
  ? JSON.parse(readFileSync(join(libraryDir, 'catalog.json'), 'utf8')).books
  : [];
const built = new Map(existingCatalog.map((book) => [book.slug, book]));

try {
  for (const source of sources.books) {
    if (onlySlugs.length && !onlySlugs.includes(source.slug)) continue;
    for (const genre of source.genres) if (!GENRES[genre]) throw new Error(`${source.slug}: unknown genre ${genre}`);
    const record = aozora.get(source.aozoraId);
    if (!record) throw new Error(`${source.slug}: Aozora work ${source.aozoraId} not found.`);
    assertPublicDomain(record, source.aozoraId);
    console.log(`${source.slug}: ${record['作品名']} (${record['姓']}${record['名']})`);

    const converted = await convertWork(record, source);
    const title = workTitle(record);
    const author = record['姓'] + record['名'];
    const chapters = splitChapters(converted.body, record['作品名']);
    const coverFile = join(libraryDir, 'covers', `${source.slug}.png`);
    const coverPng = existsSync(coverFile) && !redrawCovers
      ? readFileSync(coverFile)
      : renderCover({ title, author, genres: source.genres, slug: source.slug });
    const epub = await buildEpub({ source, record, converted, chapters, coverPng, description: source.description.ja });

    const text = plainText(converted.body);
    const characters = text.replace(/\s/g, '').length;
    const level = estimator.estimate(text);
    writeFileSync(join(libraryDir, 'books', `${source.slug}.epub`), epub);
    writeFileSync(join(libraryDir, 'covers', `${source.slug}.png`), coverPng);
    built.set(source.slug, {
      id: `aozora-${source.aozoraId}`,
      slug: source.slug,
      title,
      titleReading: record['作品名読み'],
      author,
      authorReading: record['姓読み'] + record['名読み'],
      language: 'ja',
      genres: source.genres,
      description: source.description,
      file: `books/${source.slug}.epub`,
      cover: `covers/${source.slug}.png`,
      bytes: epub.length,
      sha256: createHash('sha256').update(epub).digest('hex'),
      characters,
      pages: Math.max(1, Math.round(characters / CHARS_PER_PAGE)),
      chapters: chapters.length,
      level,
      orthography: record['文字遣い種別'],
      source: { name: '青空文庫 (Aozora Bunko)', url: record['図書カードURL'] },
      license: { id: 'public-domain', authorDied: record['没年月日'] },
      credits: {
        base: [record['底本名1'], record['底本出版社名1'], record['底本初版発行年1']].filter(Boolean).join(' / '),
        input: record['入力者'],
        proofreading: record['校正者'],
      },
      updated: (record['XHTML/HTMLファイル最終更新日'] || record['最終更新日']),
    });
    console.log(`  ${chapters.length} chapters, ${characters} characters, ${(epub.length / 1024).toFixed(0)} KB, difficulty ${level.score} (${JSON.stringify(level.coverage)})`);
  }

  const order = sources.books.map((book) => book.slug);
  const books = [...built.values()]
    .filter((book) => order.includes(book.slug))
    .sort((left, right) => order.indexOf(left.slug) - order.indexOf(right.slug));
  writeFileSync(join(libraryDir, 'catalog.json'), `${JSON.stringify({ schema: CATALOG_SCHEMA, books }, null, 2)}\n`);

  const attribution = [
    '# Credits and licences',
    '',
    `Every work in this library is in the **public domain**: its author died in ${LAST_DEATH_YEAR} or earlier, so the copyright has expired in Japan, the United States, the European Union and Spain. A few countries have longer terms (Mexico, for one); check yours before redistributing. The works come from [青空文庫 (Aozora Bunko)](https://www.aozora.gr.jp/), a digital library run by volunteers. The EPUB files are conversions of the XHTML text Aozora publishes, keeping the original spelling, the furigana and the credits of the edition.`,
    '',
    'Aozora Bunko asks that the details of the source edition and the names of the people who typed and proofread the text be kept. Every EPUB carries them on its last page (底本・クレジット) and they are repeated below. The covers are drawn by the [Yomisuba](https://github.com/xelloss1012/yomisuba) build script and do not come from any edition.',
    '',
    'The catalog, the descriptions and the covers are dedicated to the public domain under [CC0 1.0](LICENSE).',
    '',
    '| Work | Author | Aozora card | Source edition | Typed by | Proofread by |',
    '|---|---|---|---|---|---|',
    ...books.map((book) => `| ${book.title} | ${book.author} (†${book.license.authorDied.slice(0, 4)}) | [${book.id.replace('aozora-', '#')}](${book.source.url}) | ${book.credits.base || '—'} | ${book.credits.input || '—'} | ${book.credits.proofreading || '—'} |`),
    '',
  ].join('\n');
  writeFileSync(join(libraryDir, 'ATTRIBUTION.md'), attribution);
  console.log(`catalog.json: ${books.length} books`);
} finally {
  await estimator.close();
}
