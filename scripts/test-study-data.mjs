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

const memoryStorage = (entries) => {
  const map = new Map(Object.entries(entries).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

const word = (baseForm, kana, gloss) => ({
  baseForm,
  searchTerms: [baseForm],
  entries: [{ language: 'es', kanji: [baseForm], kana: [kana], senses: [{ partOfSpeech: ['n'], glosses: [gloss] }] }],
});
const favorite = (id, savedAt, query, data) => ({ id, savedAt, query, kind: 'dictionary', response: '', data });

try {
  const studyData = await server.ssrLoadModule('/src/utils/studyData.ts');
  const studyExport = await server.ssrLoadModule('/src/utils/studyExport.ts');
  const { bookKeyOf, bookDataKeys, collectStudyData, listStoredBooks, sortVocabulary, wordsPerMonth } = studyData;

  const neko = bookKeyOf('吾輩は猫である', '夏目漱石');
  const kokoro = bookKeyOf('こころ', '夏目漱石');
  const odd = bookKeyOf('A|B', 'C');
  const day = 86_400_000;
  const storage = memoryStorage({
    yomisuba_settings_v1: {},
    [`${neko}_translation_favorites`]: [
      favorite('1', 10 * day, '猫', word('猫', 'ねこ', 'gato')),
      favorite('2', 12 * day, '先生', word('先生', 'せんせい', 'maestro')),
      { id: '3', savedAt: 13 * day, query: 'こんにちは世界', kind: 'translation', response: 'Hola mundo' },
    ],
    [`${kokoro}_translation_favorites`]: [
      favorite('4', 30 * day, '先生', word('先生', 'せんせい', 'profesor')),
      { broken: true },
    ],
    [`${neko}_frequent_queries`]: [
      { key: '先生', query: '先生', count: 3, updatedAt: 12 * day },
      { key: '猫', query: '猫', count: 1, updatedAt: 10 * day },
    ],
    [`${neko}_frequent_queries_version`]: '2',
    [`${kokoro}_frequent_queries`]: [{ key: '先生', query: '先生', count: 4, updatedAt: 30 * day }],
    [`${kokoro}_frequent_queries_version`]: '2',
    [`${odd}_frequent_queries`]: [{ key: '古い', query: '古い', count: 9, updatedAt: 1 }],
    [`${odd}_frequent_queries_version`]: '1',
    [`${kokoro}_annotations`]: [
      { id: 'a', spineIndex: 2, quote: '私はその人を常に先生と呼んでいた', prefix: '', suffix: '', note: '  primera frase  ' },
      { id: 'b', spineIndex: 1, quote: '鎌倉', prefix: '', suffix: '' },
    ],
    [`${neko}_translation_history`]: [
      { id: 'h1', queriedAt: 12 * day, query: '先生', kind: 'dictionary', data: word('先生', 'せんせい', 'maestro') },
      { id: 'h2', queriedAt: 5 * day, query: 'x', kind: 'nope', response: '' },
    ],
    [`${neko}_recent_searches`]: ['猫', '名前'],
    [`${kokoro}_recent_searches`]: ['名前'],
    [`${kokoro}_position`]: { spineIndex: 1, page: 4, pageCount: 10 },
    [`${kokoro}_pagination`]: { k: { counts: [2, 10, 20], savedAt: 1 } },
    [`${kokoro}_bookmark`]: [{ spineIndex: 0, page: 1 }, { spineIndex: 1, page: 2 }],
  });

  // --- Every book with data, on the shelf or not ------------------------------------------
  const books = listStoredBooks(storage, [{ bookKey: odd, title: 'A|B', creator: 'C' }]);
  assert.deepEqual(books.map((book) => book.title).sort(), ['A|B', 'こころ', '吾輩は猫である'].sort());
  assert.equal(books.find((book) => book.bookKey === neko).creator, '夏目漱石');
  assert.ok(bookDataKeys(neko).includes(`${neko}_translation_favorites`));
  assert.ok(bookDataKeys(neko).includes(`${neko}_frequent_queries_version`));

  const data = collectStudyData(storage, books, new Set([neko]));

  // --- The same word saved in two books is one word, found in both ------------------------
  assert.equal(data.vocabulary.length, 3);
  const sensei = data.vocabulary.find((item) => item.word === '先生');
  assert.equal(sensei.reading, 'せんせい');
  assert.deepEqual(sensei.books.map((book) => book.title), ['吾輩は猫である', 'こころ']);
  assert.equal(sensei.firstSavedAt, 12 * day);
  assert.equal(sensei.lastSavedAt, 30 * day);
  assert.equal(sensei.favorite.id, '4', 'the latest favorite is the one shown');
  assert.equal(sensei.lookups, 7, 'looked up 3 times in one book and 4 in the other');
  assert.equal(data.vocabulary.find((item) => item.word === '猫').lookups, 1);
  assert.equal(data.vocabulary.find((item) => item.kinds[0] === 'translation').word, 'こんにちは世界');

  assert.deepEqual(sortVocabulary(data.vocabulary, 'lookups').map((item) => item.word)[0], '先生');
  assert.deepEqual(sortVocabulary(data.vocabulary, 'recent').map((item) => item.word)[0], '先生');
  assert.deepEqual(sortVocabulary(data.vocabulary, 'books').map((item) => item.word)[0], '先生');

  // --- Notes, history, lookups and searches of every book ---------------------------------
  assert.equal(data.notes.length, 2);
  assert.equal(data.notes.find((note) => note.annotation.id === 'a').annotation.note, 'primera frase');
  assert.deepEqual(data.history.map((item) => item.entry.id), ['h1'], 'a damaged entry is left out');
  assert.equal(data.lookups[0].query, '先生');
  assert.equal(data.lookups[0].count, 7);
  assert.equal(data.lookups[0].books.length, 2);
  assert.ok(!data.lookups.some((item) => item.query === '古い'), 'counts of an older format are not counted');
  assert.deepEqual(data.textSearches.find((item) => item.query === '名前').books.length, 2);

  // --- What each book has ------------------------------------------------------------------
  const nekoSummary = data.books.find((book) => book.bookKey === neko);
  const kokoroSummary = data.books.find((book) => book.bookKey === kokoro);
  assert.equal(nekoSummary.onShelf, true);
  assert.equal(kokoroSummary.onShelf, false, 'removed from the shelf, its data is still here');
  assert.deepEqual(
    [kokoroSummary.favorites, kokoroSummary.notes, kokoroSummary.underlines, kokoroSummary.bookmarks, kokoroSummary.lookups],
    [1, 1, 2, 2, 4],
  );
  assert.equal(kokoroSummary.progress, 22, 'page 7 of 32');
  assert.equal(nekoSummary.progress, null, 'no position, no progress');
  assert.equal(data.books[0].bookKey, kokoro, 'the book used last first');

  // --- Words per month --------------------------------------------------------------------
  const at = (month, date) => ({ firstSavedAt: new Date(2026, month, date).getTime() });
  const months = wordsPerMonth([at(8, 3), at(9, 1), at(9, 30), at(2, 1)], 2, new Date(2026, 9, 28).getTime());
  assert.deepEqual(months, [{ month: '2026-09', count: 1 }, { month: '2026-10', count: 2 }], 'older months are left out');

  // --- Exports ---------------------------------------------------------------------------
  const kind = ({ kind: name }) => (name === 'dictionary' ? 'Diccionario' : 'Traducción');
  const csv = studyExport.vocabularyToCsv(sortVocabulary(data.vocabulary, 'word'), {
    word: 'Palabra', reading: 'Lectura', meaning: 'Significado', type: 'Tipo', books: 'Libros', lookups: 'Consultas', firstSaved: 'Guardada', kind,
  });
  assert.ok(csv.startsWith('﻿Palabra,Lectura,Significado,Tipo,Libros,Consultas,Guardada\r\n'));
  assert.ok(csv.includes('先生,せんせい,profesor,Diccionario,吾輩は猫である · こころ,7,1970-01-13'));

  const anki = studyExport.vocabularyToAnki([sensei]);
  assert.equal(anki, '#separator:tab\n#html:true\n#columns:Front\tBack\n先生\t<b>せんせい</b><br>profesor<br><small>吾輩は猫である · こころ</small>\n');
  assert.ok(!studyExport.vocabularyToAnki([{ ...sensei, word: 'a\tb' }]).includes('a\tb'), 'a tab cannot split a card');

  const markdown = studyExport.vocabularyToMarkdown('Vocabulario', [sensei], { kind, books: 'Libros', lookups: 'Consultas' }, 'es');
  assert.ok(markdown.startsWith('# Vocabulario\n\n## 先生（せんせい）\n*Diccionario · 1970-01-13 · Consultas: 7*\n*Libros: 吾輩は猫である · こころ*'));

  const notes = studyExport.notesToMarkdown('Notas', data.notes, (spine) => `Capítulo ${spine + 1}`);
  assert.equal(notes, '# Notas\n\n## こころ\n\n### Capítulo 2\n\n> 鎌倉\n\n### Capítulo 3\n\n> 私はその人を常に先生と呼んでいた\n\nprimera frase\n');

  const history = studyExport.historyToCsv(data.history, { date: 'Fecha', query: 'Consulta', type: 'Tipo', answer: 'Respuesta', book: 'Libro', kind }, 'es');
  assert.ok(history.startsWith('﻿Fecha,Consulta,Tipo,Respuesta,Libro\r\n1970-01-13 00:00,先生,Diccionario,'));
  assert.ok(history.trimEnd().endsWith(',吾輩は猫である'));

  console.log('PASS: the data of every book is found, joined by word and exported.');
} finally {
  await server.close();
}
