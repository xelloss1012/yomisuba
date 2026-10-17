import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const epubBytes = Buffer.from('PK pretend this is an EPUB');
const sha256 = createHash('sha256').update(epubBytes).digest('hex');
const entry = (overrides = {}) => ({
  id: 'aozora-1', slug: 'botchan', title: '坊っちゃん', titleReading: 'ぼっちゃん', author: '夏目漱石',
  genres: ['humor', 'drama'],
  description: { ja: '日本語', es: 'Español', en: 'English' },
  file: 'books/botchan.epub', cover: 'covers/botchan.png', bytes: epubBytes.length, sha256,
  characters: 88272, pages: 147, level: { score: 4, coverage: { N2: 0.7 }, words: 1000 },
  source: { name: 'Aozora Bunko', url: 'https://www.aozora.gr.jp/cards/000148/card752.html' },
  license: { id: 'public-domain', authorDied: '1916-12-09' },
  ...overrides,
});

// The library repository, served by a fake fetch.
const published = new Map();
globalThis.fetch = async (url) => {
  const body = published.get(String(url).replace(/^.*\/yomisuba-library\/main\//, ''));
  if (body === undefined) return new Response('not found', { status: 404 });
  return new Response(body, { headers: { 'content-length': String(body.length) } });
};

const root = resolve(import.meta.dirname, '..');
const server = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const library = await server.ssrLoadModule('/src/utils/libraryCatalog.ts');
  const { parseLibraryCatalog, fetchLibraryCatalog, downloadLibraryBook, libraryDescription, genresInCatalog } = library;

  // A well-formed entry keeps what the screen shows.
  const [book] = parseLibraryCatalog({ schema: 1, books: [entry()] });
  assert.equal(book.title, '坊っちゃん');
  assert.equal(book.difficulty, 4);
  assert.deepEqual(book.genres, ['humor', 'drama']);

  // Entries that are not what the app expects are dropped one by one, never the whole list; paths and
  // links cannot lead anywhere else.
  const books = parseLibraryCatalog({
    schema: 1,
    books: [
      entry(),
      entry({ id: 'x1', slug: 'x1', file: '../secret.epub' }),
      entry({ id: 'x2', slug: 'x2', file: 'https://example.com/books/x2.epub' }),
      entry({ id: 'x3', slug: 'x3', cover: 'covers/x3.svg' }),
      entry({ id: 'x4', slug: 'x4', sha256: 'not-a-checksum' }),
      entry({ id: 'x5', slug: 'x5', genres: ['cooking'] }),
      entry({ id: 'x6', slug: 'x6', source: { name: 'x', url: 'javascript:alert(1)' } }),
      entry({ id: 'x7', slug: 'x7', level: { score: 9 } }),
      null,
      'text',
      entry({ id: 'ok', slug: 'ok', genres: ['cooking', 'mystery'], file: 'books/ok.epub', cover: 'covers/ok.png' }),
    ],
  });
  assert.deepEqual(books.map((item) => item.id), ['aozora-1', 'ok']);
  assert.deepEqual(books[1].genres, ['mystery'], 'unknown genres are filtered out of an otherwise valid entry');

  assert.throws(() => parseLibraryCatalog({ schema: 2, books: [] }), /más reciente/);
  assert.throws(() => parseLibraryCatalog({ schema: 1 }), /formato/);
  assert.throws(() => parseLibraryCatalog([]), /formato/);

  // Description: interface language, then English, then Japanese.
  assert.equal(libraryDescription(book, 'es'), 'Español');
  assert.equal(libraryDescription(book, 'fr'), 'English');
  assert.equal(libraryDescription({ ...book, description: { ja: '日本語' } }, 'fr'), '日本語');

  // Genres follow the library's order, and only those that have a book.
  assert.deepEqual(genresInCatalog(books), ['mystery', 'humor', 'drama']);

  // Fetching the catalog and a book.
  published.set('catalog.json', JSON.stringify({ schema: 1, books: [entry()] }));
  assert.equal((await fetchLibraryCatalog()).length, 1);
  published.delete('catalog.json');
  await assert.rejects(fetchLibraryCatalog(), /HTTP 404/);

  const progress = [];
  published.set('books/botchan.epub', epubBytes);
  const file = await downloadLibraryBook(book, (loaded, total) => progress.push([loaded, total]));
  assert.equal(file.name, 'botchan.epub');
  assert.equal(file.type, 'application/epub+zip');
  assert.equal(Buffer.from(await file.arrayBuffer()).equals(epubBytes), true);
  assert.deepEqual(progress.at(-1), [epubBytes.length, epubBytes.length]);

  // A file that is not the one in the catalog (wrong size or content) never reaches the reader.
  published.set('books/botchan.epub', Buffer.from('PK pretend this is an EPUB!'));
  await assert.rejects(downloadLibraryBook(book, () => {}), /no coincide/);
  published.set('books/botchan.epub', Buffer.from('PK pretend this is an EPUC'));
  await assert.rejects(downloadLibraryBook(book, () => {}), /no coincide/);
  published.delete('books/botchan.epub');
  await assert.rejects(downloadLibraryBook(book, () => {}), /HTTP 404/);

  console.log('PASS: library catalog drops malformed entries and unsafe paths, picks the description language, lists genres and verifies downloads.');
} finally {
  await server.close();
}
