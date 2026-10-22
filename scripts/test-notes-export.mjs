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
  const { searchNotes, annotationMatches, findInText } = await server.ssrLoadModule('/src/utils/noteSearch.ts');
  const { exportFileName } = await server.ssrLoadModule('/src/utils/exportFile.ts');
  const { csvCell, favoriteFields, favoritesToCsv, favoritesToMarkdown } = await server.ssrLoadModule('/src/utils/favoritesExport.ts');
  const { normalizeSearchQuery } = await server.ssrLoadModule('/src/utils/bookSearch.ts');

  // --- File names ----------------------------------------------------------------
  assert.equal(exportFileName('吾輩は猫である', 'notas', 'md'), '吾輩は猫である notas.md');
  assert.equal(exportFileName('A/B: C*?<>|"D"', 'favoritos', '.csv'), 'A B C D favoritos.csv', 'no path or reserved characters');
  assert.equal(exportFileName('   ', 'notas', 'md'), 'Yomisuba notas.md', 'a name when the title is blank');
  assert.ok(exportFileName('あ'.repeat(300), 'notas', 'md').length <= 83, 'not too long');

  // --- Searching the notes --------------------------------------------------------
  const note = (id, spineIndex, quote, text, chapterLabel = `第${spineIndex + 1}章`) => ({ id, spineIndex, quote, prefix: '', suffix: '', note: text, chapterLabel });
  const items = [
    note('b', 2, '二つ目', 'Palabra rara: ＡＢＣ de la lista'),
    note('a', 0, '一つ目', 'Es la primera persona.\nVer también el capítulo 3.'),
    { id: 'c', spineIndex: 1, quote: '見当', prefix: '', suffix: '', chapterLabel: '第2章' },
  ];
  assert.deepEqual(searchNotes(items, 'primera').map((hit) => hit.annotation.id), ['a']);
  assert.deepEqual(searchNotes(items, 'abc').map((hit) => hit.annotation.id), ['b'], 'full-width letters and case are folded');
  assert.deepEqual(searchNotes(items, 'PALABRA').map((hit) => hit.annotation.id), ['b']);
  assert.deepEqual(searchNotes(items, 'a').map((hit) => hit.annotation.id), ['a', 'b'], 'in the order of the book');
  assert.deepEqual(searchNotes(items, '見当'), [], 'an underline without a note is not a note');
  assert.deepEqual(searchNotes(items, '一つ目'), [], 'the underlined text itself is the book\'s own text');
  assert.deepEqual(searchNotes(items, '  '), []);
  const hit = searchNotes(items, 'primera persona')[0];
  assert.equal(hit.match, 'primera persona', 'the match keeps the note\'s own spaces');
  assert.equal(hit.before, 'Es la ');
  assert.ok(hit.after.startsWith('.\nVer'));
  assert.deepEqual(findInText('A  b', normalizeSearchQuery('a b')), { start: 0, end: 4 }, 'spaces inside the match are part of it');
  assert.equal(findInText('abc', normalizeSearchQuery('z')), null);

  // --- Filtering the list -----------------------------------------------------------
  assert.equal(annotationMatches(items[0], ''), true);
  assert.equal(annotationMatches(items[0], '二つ目'), true, 'by its underlined text');
  assert.equal(annotationMatches(items[0], 'lista'), true, 'by its note');
  assert.equal(annotationMatches(items[0], '第3章'), true, 'by its chapter');
  assert.equal(annotationMatches(items[0], 'zzz'), false);
  assert.equal(annotationMatches(items[2], '見当'), true, 'an underline without a note');

  // --- Favorites as a table ----------------------------------------------------------
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)", 'a formula is not run by a spreadsheet');
  assert.equal(csvCell('-1 and more'), "'-1 and more");

  const entry = (language, kana, glosses) => ({ language, kanji: ['猫'], kana, senses: glosses.map((g) => ({ partOfSpeech: ['n'], glosses: g })) });
  const dictionary = {
    id: '1', savedAt: Date.UTC(2026, 9, 22, 10), query: '猫が', kind: 'dictionary',
    response: '',
    data: { baseForm: '猫', searchTerms: ['猫'], entries: [entry('es', ['ねこ'], [['gato', 'felino'], ['persona sigilosa']]), entry('en', ['ねこ'], [['cat']])] },
  };
  const translation = { id: '2', savedAt: Date.UTC(2026, 9, 23), query: '吾輩は猫である', kind: 'translation', provider: 'google', response: 'I am a cat.\n\nA famous line, "really".' };
  assert.deepEqual(favoriteFields(dictionary), { word: '猫', reading: 'ねこ', meaning: 'gato; felino · persona sigilosa | cat' });
  assert.deepEqual(favoriteFields(translation), { word: '吾輩は猫である', reading: '', meaning: 'I am a cat. A famous line, "really".' });

  const labels = { word: 'Palabra', reading: 'Lectura', meaning: 'Significado', type: 'Tipo', date: 'Fecha', source: 'Fuente', kind: (favorite) => (favorite.kind === 'dictionary' ? 'Diccionario' : 'Traducción') };
  const csv = favoritesToCsv([dictionary, translation], labels);
  assert.ok(csv.startsWith('﻿'), 'a byte-order mark, so that Excel reads the Japanese');
  assert.deepEqual(csv.slice(1).split('\r\n'), [
    'Palabra,Lectura,Significado,Tipo,Fecha,Fuente',
    '猫,ねこ,gato; felino · persona sigilosa | cat,Diccionario,2026-10-22,',
    '吾輩は猫である,,"I am a cat. A famous line, ""really"".",Traducción,2026-10-23,google',
    '',
  ]);

  const markdown = favoritesToMarkdown('吾輩は猫である · Favoritos', [dictionary, translation], labels, 'es');
  assert.ok(markdown.startsWith('# 吾輩は猫である · Favoritos\n'));
  assert.ok(markdown.includes('## 猫が\n*Diccionario · 2026-10-22*'));
  assert.ok(markdown.includes('gato'), 'the dictionary data is written out');
  assert.ok(markdown.includes('## 吾輩は猫である\n*Traducción · 2026-10-23 · google*\n\nI am a cat.'));

  console.log('PASS: notes are searched with their own spacing, the list filters by text, note and chapter, file names are safe, and favorites export as a safe CSV (with BOM) and as Markdown.');
} finally {
  await server.close();
}
