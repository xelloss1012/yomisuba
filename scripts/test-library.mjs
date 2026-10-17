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
  const {
    parseLibraryCatalog, fetchLibraryCatalog, downloadLibraryBook, libraryDescription, genresInCatalog,
    filterLibraryBooks, sortLibraryBooks, NO_LIBRARY_FILTERS,
  } = library;

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

  assert.throws(() => parseLibraryCatalog({ schema: 3, books: [] }), /más reciente/);
  assert.throws(() => parseLibraryCatalog({ schema: 1 }), /formato/);
  assert.throws(() => parseLibraryCatalog([]), /formato/);

  // Licences: public domain, or Creative Commons BY / BY-SA with their name and terms; anything else is dropped.
  const cc = (overrides = {}) => entry({
    id: 'cc1', slug: 'cc1', file: 'books/cc1.epub', cover: 'covers/cc1.png',
    license: {
      id: 'cc-by', name: 'CC BY 2.1 JP', url: 'https://creativecommons.org/licenses/by/2.1/jp/',
      creditRole: 'translator', creditName: '大久保ゆう', credit: '翻訳: 大久保ゆう',
    },
    ...overrides,
  });
  const licensed = parseLibraryCatalog({
    schema: 2,
    books: [
      cc(),
      cc({ id: 'sa', slug: 'sa', file: 'books/sa.epub', cover: 'covers/sa.png', license: { id: 'cc-by-sa', name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', creditRole: 'author', creditName: '太田健一' } }),
      cc({ id: 'nc', slug: 'nc', file: 'books/nc.epub', cover: 'covers/nc.png', license: { id: 'cc-by-nc', name: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/' } }),
      cc({ id: 'nd', slug: 'nd', file: 'books/nd.epub', cover: 'covers/nd.png', license: { id: 'cc-by-nd', name: 'CC BY-ND 4.0', url: 'https://creativecommons.org/licenses/by-nd/4.0/' } }),
      cc({ id: 'bad-url', slug: 'bad-url', file: 'books/bad-url.epub', cover: 'covers/bad-url.png', license: { id: 'cc-by', name: 'CC BY 4.0', url: 'https://evil.example/by' } }),
      cc({ id: 'no-name', slug: 'no-name', file: 'books/no-name.epub', cover: 'covers/no-name.png', license: { id: 'cc-by', url: 'https://creativecommons.org/licenses/by/4.0/' } }),
      cc({ id: 'pd', slug: 'pd', file: 'books/pd.epub', cover: 'covers/pd.png', license: { id: 'public-domain', authorDied: '1916-12-09' } }),
      cc({ id: 'unknown', slug: 'unknown', file: 'books/unknown.epub', cover: 'covers/unknown.png', license: { id: 'all-rights-reserved' } }),
    ],
  });
  assert.deepEqual(licensed.map((item) => item.id), ['cc1', 'sa', 'pd'], 'NC, ND, unknown and incomplete licences are dropped');
  assert.deepEqual(licensed[0].license, {
    id: 'cc-by', name: 'CC BY 2.1 JP', url: 'https://creativecommons.org/licenses/by/2.1/jp/',
    creditRole: 'translator', creditName: '大久保ゆう', authorDied: '',
  });
  assert.equal(licensed[1].license.id, 'cc-by-sa');
  assert.equal(licensed[2].license.url, null, 'public domain has no licence link');
  // Catalogs published before licences were added (schema 1) still read: their books are public domain.
  assert.equal(parseLibraryCatalog({ schema: 1, books: [entry()] })[0].license.id, 'public-domain');
  assert.deepEqual(genresInCatalog(parseLibraryCatalog({ schema: 2, books: [cc({ genres: ['nonfiction'] })] })), ['nonfiction']);

  // Description: interface language, then English, then Japanese.
  assert.equal(libraryDescription(book, 'es'), 'Español');
  assert.equal(libraryDescription(book, 'fr'), 'English');
  assert.equal(libraryDescription({ ...book, description: { ja: '日本語' } }, 'fr'), '日本語');

  // Genres follow the library's order, and only those that have a book.
  assert.deepEqual(genresInCatalog(books), ['mystery', 'humor', 'drama']);

  // Searching, filtering and sorting.
  const shelf = parseLibraryCatalog({
    schema: 2,
    books: [
      entry({ id: 'a', slug: 'a', file: 'books/a.epub', cover: 'covers/a.png', title: '坊っちゃん', titleReading: 'ぼっちゃん', author: '夏目漱石', genres: ['humor'], characters: 88000, level: { score: 4 }, description: { ja: '日本語', es: 'Profesor en Shikoku', en: 'Teacher in Shikoku' } }),
      entry({ id: 'b', slug: 'b', file: 'books/b.epub', cover: 'covers/b.png', title: 'ダゴン', titleReading: 'だごん', author: 'ハワード・フィリップス・ラヴクラフト', genres: ['horror'], characters: 5000, level: { score: 5 }, description: { ja: '怪奇', es: 'Bote a la deriva', en: 'Boat adrift' }, license: { id: 'cc-by', name: 'CC BY 2.1 JP', url: 'https://creativecommons.org/licenses/by/2.1/jp/' } }),
      entry({ id: 'c', slug: 'c', file: 'books/c.epub', cover: 'covers/c.png', title: 'ＲＵＲ', titleReading: 'あーるゆーあーる', author: 'カレル・チャペック', genres: ['scifi', 'drama'], characters: 54000, level: { score: 4 }, description: { ja: '戯曲', es: 'Fábrica de robots', en: 'Robot factory' }, license: { id: 'cc-by', name: 'CC BY 2.1 JP', url: 'https://creativecommons.org/licenses/by/2.1/jp/' } }),
      entry({ id: 'd', slug: 'd', file: 'books/d.epub', cover: 'covers/d.png', title: 'よだかの星', titleReading: 'よだかのほし', author: '宮沢賢治', genres: ['children', 'fantasy'], characters: 5000, level: { score: 2 }, description: { ja: '童話', es: 'Chotacabras', en: 'Nighthawk' } }),
    ],
  });
  const ids = (list) => list.map((item) => item.id).join(',');
  const find = (filters, language = 'es') => ids(filterLibraryBooks(shelf, { ...NO_LIBRARY_FILTERS, ...filters }, language));
  assert.equal(find({}), 'a,b,c,d');
  assert.equal(find({ query: '坊っちゃん' }), 'a');
  assert.equal(find({ query: 'ぼっちゃん' }), 'a', 'by the reading');
  assert.equal(find({ query: 'ボッチャン' }), 'a', 'katakana and hiragana are the same to a search');
  assert.equal(find({ query: 'ダゴン' }), 'b');
  assert.equal(find({ query: 'だごん' }), 'b');
  assert.equal(find({ query: 'rur' }), 'c', 'full-width and half-width letters match');
  assert.equal(find({ query: 'ＲＵＲ' }), 'c');
  assert.equal(find({ query: 'ラヴクラフト' }), 'b', 'by author');
  assert.equal(find({ query: 'ワード ラヴ' }), 'b', 'every word must match, in any order');
  assert.equal(find({ query: 'ワード 宮沢' }), '', 'a word that matches no book empties the list');
  assert.equal(find({ query: 'shikoku' }, 'es'), 'a', 'description, ignoring case');
  assert.equal(find({ query: 'chotacabras' }, 'es'), 'd');
  assert.equal(find({ query: 'chotacabras' }, 'en'), '', 'the description searched is the one shown');
  assert.equal(find({ query: '  ' }), 'a,b,c,d', 'a blank search shows everything');
  assert.equal(find({ genre: 'drama' }), 'c');
  assert.equal(find({ genre: 'fantasy' }), 'd');
  assert.equal(find({ license: 'public-domain' }), 'a,d');
  assert.equal(find({ license: 'free' }), 'b,c');
  assert.equal(find({ difficulty: 4 }), 'a,c');
  assert.equal(find({ difficulty: 5, license: 'free' }), 'b');
  assert.equal(find({ difficulty: 2, license: 'free' }), '');
  assert.equal(find({ genre: 'scifi', query: 'robot' }, 'en'), 'c');

  assert.equal(ids(sortLibraryBooks(shelf, 'catalog')), 'a,b,c,d');
  assert.notEqual(sortLibraryBooks(shelf, 'catalog'), shelf, 'a copy, so the catalog itself is never reordered');
  assert.equal(ids(sortLibraryBooks(shelf, 'easiest')), 'd,a,c,b', 'ties (a and c) keep the catalog order');
  assert.equal(ids(sortLibraryBooks(shelf, 'hardest')), 'b,a,c,d');
  assert.equal(ids(sortLibraryBooks(shelf, 'shortest')), 'b,d,c,a', 'b and d tie, and keep the catalog order');
  assert.equal(ids(sortLibraryBooks(shelf, 'longest')), 'a,c,b,d');
  assert.equal(ids(shelf), 'a,b,c,d', 'sorting leaves the original order alone');

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
