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
  const { normalizeNote, readTextAnnotations, MAX_NOTE_LENGTH } = await server.ssrLoadModule('/src/utils/textAnnotations.ts');
  const { annotationsToMarkdown } = await server.ssrLoadModule('/src/utils/annotationExport.ts');

  // --- The note itself -----------------------------------------------------------
  assert.equal(normalizeNote('  覚えておく  '), '覚えておく', 'trimmed');
  assert.equal(normalizeNote('   '), undefined, 'a blank note is no note');
  assert.equal(normalizeNote(''), undefined);
  assert.equal(normalizeNote(42), undefined, 'not text');
  assert.equal(normalizeNote(undefined), undefined);
  assert.equal(normalizeNote('あ'.repeat(MAX_NOTE_LENGTH + 500)).length, MAX_NOTE_LENGTH, 'cut at the limit');

  // --- Reading what was stored -----------------------------------------------------
  const store = new Map();
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  const base = { spineIndex: 0, quote: '吾輩', prefix: '', suffix: 'は猫' };
  store.set('book', JSON.stringify([
    { ...base, id: 'a', note: '  一人称  ' },
    { ...base, id: 'b' },
    { ...base, id: 'c', note: 42 },
    { ...base, id: 'd', note: '   ' },
    { ...base, id: 'e', quote: '' },
    { id: 'f' },
  ]));
  const read = readTextAnnotations('book');
  assert.deepEqual(read.map((item) => item.id), ['a', 'b', 'c', 'd'], 'damaged entries are dropped, the underline of a bad note stays');
  assert.equal(read[0].note, '一人称', 'a note is kept, trimmed');
  for (const item of read.slice(1)) assert.equal('note' in item, false, `${item.id} has no note`);
  store.set('old', JSON.stringify([{ ...base, id: 'x' }]));
  assert.deepEqual(readTextAnnotations('old'), [{ ...base, id: 'x' }], 'annotations saved before notes existed read as they were');

  // --- Export --------------------------------------------------------------------------
  const markdown = annotationsToMarkdown('吾輩は猫である', [
    { spineIndex: 1, quote: '二章の引用', note: '第二章のメモ', chapterLabel: '二', pageLabel: 'p. 12' },
    { spineIndex: 0, quote: '一行目\n二行目', chapterLabel: '一', pageLabel: 'p. 3' },
    { spineIndex: 1, quote: 'メモなし', chapterLabel: '二' },
    { spineIndex: 0, quote: '一章の引用', note: '  覚える  ', chapterLabel: '一', pageLabel: 'p. 4' },
  ]);
  assert.equal(markdown, [
    '# 吾輩は猫である',
    '',
    '## 一',
    '',
    '> 一行目',
    '> 二行目',
    '*p. 3*',
    '',
    '> 一章の引用',
    '*p. 4*',
    '',
    '覚える',
    '',
    '## 二',
    '',
    '> 二章の引用',
    '*p. 12*',
    '',
    '第二章のメモ',
    '',
    '> メモなし',
    '',
  ].join('\n'), 'by chapter in book order, creation order within a chapter, notes under their quote');
  assert.equal(annotationsToMarkdown('  ', []), '# —\n');

  console.log('PASS: notes are trimmed and limited, bad ones are dropped without losing the underline, old annotations still read, and the export is Markdown by chapter.');
} finally {
  await server.close();
}
