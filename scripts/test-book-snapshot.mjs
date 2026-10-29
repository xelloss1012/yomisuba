import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';

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
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const { bookSnapshot, removeBookFavorites, toggleBookFavorite } = await server.ssrLoadModule('/src/utils/bookSnapshot.ts');
  const { notesToAnki } = await server.ssrLoadModule('/src/utils/studyExport.ts');

  const book = { bookKey: 'yomisuba_book_k', title: 'こころ', creator: '夏目漱石' };
  const set = (suffix, value) => storage.set(`${book.bookKey}_${suffix}`, typeof value === 'string' ? value : JSON.stringify(value));
  set('position', { spineIndex: 3, page: 2, pageCount: 9 });
  set('printed_pages', '250');
  set('pagination', { a: { counts: [2, 9, 4], savedAt: 5 } });
  set('bookmark', { spineIndex: 1, page: 0 });
  set('annotations', [{ id: 'n', spineIndex: 2, quote: '先生', prefix: 'a', suffix: 'b', note: 'nota' }]);
  set('translation_history', [{ id: 'h', queriedAt: 1, query: '先生', kind: 'dictionary', response: 'x' }]);
  set('frequent_queries', [{ key: '先生', query: '先生', count: 2, updatedAt: 1 }]);
  set('frequent_queries_version', '2');

  // --- The whole book, as the reader sends it -----------------------------------------------
  const snapshot = bookSnapshot(localStorage, book, ['favorites']);
  assert.deepEqual(snapshot.position, { spineIndex: 3, page: 2, pageCount: 9 });
  assert.equal(snapshot.printedPages, 250);
  assert.deepEqual(snapshot.chapterPageCounts, [2, 9, 4]);
  assert.deepEqual(snapshot.bookmarks, [{ spineIndex: 1, page: 0 }], 'an old single bookmark is a list of one');
  assert.equal(snapshot.annotations[0].prefix, 'a', 'notes go up as they are, anchors included');
  assert.equal(snapshot.translationHistory.length, 1);
  assert.equal(snapshot.frequentQueriesVersion, 2);
  assert.deepEqual(snapshot.favorites, []);
  assert.deepEqual(snapshot.dirtyGroups, ['favorites'], 'only the favorites changed');

  // --- A favorite saved and removed with the book closed --------------------------------------
  const candidate = { query: '先生', kind: 'dictionary', response: 'maestro' };
  const added = toggleBookFavorite(book, candidate);
  assert.equal(added.favorites.length, 1);
  assert.equal(added.favorites[0].query, '先生');
  assert.equal(added.bookmarks.length, 1, 'the rest of the book goes with it');
  assert.equal(toggleBookFavorite(book, candidate).favorites.length, 0, 'the star again removes it');
  toggleBookFavorite(book, candidate);
  toggleBookFavorite(book, { ...candidate, query: '猫' });
  assert.deepEqual(removeBookFavorites(book, (favorite) => favorite.query === '先生').favorites.map((favorite) => favorite.query), ['猫']);

  // --- Notes as Anki cards ---------------------------------------------------------------------
  const anki = notesToAnki([
    { book: { bookKey: 'k', title: 'こころ' }, annotation: { id: 'a', spineIndex: 1, quote: '私はその人を<常に>先生と呼んでいた。', prefix: '', suffix: '', note: 'Primera\nfrase' } },
    { book: { bookKey: 'k', title: 'こころ' }, annotation: { id: 'b', spineIndex: 4, quote: '鎌倉', prefix: '', suffix: '' } },
  ], (spine) => `Capítulo ${spine + 1}`);
  assert.equal(anki, '#separator:tab\n#html:true\n#columns:Front\tBack\n'
    + '私はその人を&lt;常に&gt;先生と呼んでいた。\tPrimera<br>frase<br><small>こころ · Capítulo 2</small>\n'
    + '鎌倉\t<small>こころ · Capítulo 5</small>\n');

  console.log('PASS: a book changed with the reader closed goes to Drive whole, favorites are saved and removed, and notes export to Anki.');
} finally {
  await server.close();
}
