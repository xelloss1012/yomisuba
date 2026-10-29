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
  const { loadKanjiData, kanjiInfo, kanjiOfText, kunReading, pinyinWithTones } = await server.ssrLoadModule('/src/utils/kanjiInfo.ts');
  const { loadWordLevels, kanjiJlpt } = await server.ssrLoadModule('/src/utils/wordLevels.ts');
  const { wordsWithKanji } = await server.ssrLoadModule('/src/utils/dictionary.ts');

  const data = await loadKanjiData();
  const count = Object.keys(data).length;
  assert.ok(count > 2900 && count < 3100, `the jōyō and jinmeiyō kanji, got ${count}`);

  const geki = kanjiInfo(data, '激', 'es');
  assert.equal(geki.strokes, 16);
  assert.equal(geki.grade, 6);
  assert.deepEqual(geki.on, ['ゲキ']);
  assert.deepEqual(geki.kun, ['はげ.しい']);
  assert.ok(geki.meanings.includes('violento'));
  assert.equal(geki.meaningLanguage, 'es');
  assert.deepEqual(geki.pinyin, ['jī']);
  assert.ok(geki.parts.includes('氵'), 'KRADFILE stand-ins are shown as the part (汁 → 氵)');
  // No German meanings in KANJIDIC2: English instead, said so.
  const german = kanjiInfo(data, '激', 'de');
  assert.equal(german.meaningLanguage, 'en');
  assert.ok(german.meanings.includes('violent'));
  assert.equal(kanjiInfo(data, '鬱', 'es')?.literal ?? null, '鬱', 'a jōyō kanji of secondary school is in');
  assert.equal(kanjiInfo(data, '龘', 'es'), null, 'a rare kanji is not');

  assert.deepEqual(kanjiOfText('激怒した々人々'), ['激', '怒', '人']);
  assert.equal(kunReading('はげ.しい'), 'はげ(しい)');
  assert.equal(kunReading('-がた'), '-がた');
  assert.deepEqual(['hao3', 'zhou1', 'gui4', 'lu:4', 'ma5', 'xue2'].map(pinyinWithTones), ['hǎo', 'zhōu', 'guì', 'lǜ', 'ma', 'xué']);

  const levels = await loadWordLevels();
  assert.equal(kanjiJlpt(levels, '人'), 5);
  assert.equal(kanjiJlpt(levels, '激'), 1);

  const words = await wordsWithKanji('怒', 'es');
  assert.ok(words.some((entry) => entry.kanji.includes('怒る')), 'its words come from the dictionary');
  assert.ok(words.every((entry) => entry.kanji.some((spelling) => spelling.includes('怒'))), 'only words that write it');
  assert.equal(new Set(words.map((entry) => entry.kanji.join('|'))).size, words.length, 'each word once');

  console.log('PASS: kanji cards read KANJIDIC2 and KRADFILE (readings, meanings with English fallback, parts, pinyin), with JLPT levels and example words.');
} finally {
  await server.close();
}
