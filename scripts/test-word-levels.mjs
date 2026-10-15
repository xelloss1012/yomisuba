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
  const { loadWordLevels, classifyWord, classifyEntry, difficultyOf, isWithinLevel } =
    await server.ssrLoadModule('/src/utils/wordLevels.ts');
  const data = await loadWordLevels();
  const level = (form, options) => classifyWord(data, form, options);

  // JLPT words, with their kana spelling sharing the level.
  assert.deepEqual(level('食べる'), { jlpt: 5, band: 'common' }); // N5, though not in the newspapers' top 3,000
  assert.deepEqual(level('たべる'), level('食べる'));
  // Words the JLPT lists key by kana (する) without lending the level to homophones (刷る).
  assert.equal(level('する').jlpt, 5);
  assert.equal(level('刷る').jlpt, 2); // its own N2, not the N5 of する
  assert.equal(level('志').jlpt, 1);

  // Without JLPT level: frequency band from JMdict.
  assert.deepEqual(level('暴虐'), { band: 'common' });

  // Unlisted forms: nothing unless the caller says it is a single word; then
  // rare when a kanji is outside the jōyō set (智 is jinmeiyō), uncommon otherwise.
  assert.equal(level('邪智'), null);
  assert.deepEqual(level('邪智', { fallback: true }), { band: 'rare' });
  assert.deepEqual(level('メロス', { fallback: true }), { band: 'uncommon' });

  // Entries are classified by their kanji: the frog is not the N5 かえる (帰る).
  assert.notEqual(classifyEntry(data, { kanji: ['蛙'], kana: ['かえる'] })?.jlpt, 5);
  assert.equal(classifyEntry(data, { kanji: [], kana: ['かえる'] })?.jlpt, 5);

  // Sorting: easier and more frequent words first.
  const sorted = ['志', '暴虐', '食べる', '挨拶'].sort((a, b) => difficultyOf(level(a)) - difficultyOf(level(b)));
  assert.deepEqual(sorted, ['食べる', '挨拶', '暴虐', '志']);

  // "My level": an N5 word is known from N5 on; an N1 word only at N1.
  assert.equal(isWithinLevel(data, '食べる', level('食べる'), 5), true);
  assert.equal(isWithinLevel(data, '志', level('志'), 3), false);
  assert.equal(isWithinLevel(data, '志', level('志'), 1), true);
  // Words without a JLPT level count as known only from the levels whose band covers them.
  assert.equal(isWithinLevel(data, '暴虐', level('暴虐'), 2), false);
  assert.equal(isWithinLevel(data, 'メロス', null, 1), false);

  console.log('PASS: word levels classify JLPT words, kana spellings, homophones and unlisted words, sort by usefulness and respect the reader level.');
} finally {
  await server.close();
}
