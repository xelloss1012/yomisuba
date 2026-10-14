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
  const { getDictionarySearchTerms } = await server.ssrLoadModule('/src/utils/dictionary.ts');
  const lookup = await getDictionarySearchTerms('おぶって');
  const firstTwoReadings = lookup.entries
    .slice(0, 2)
    .map((entry) => entry.kana.find((reading) => ['おぶる', 'おぶう'].includes(reading)));
  const expectedVerbReadings = ['おぶる', 'おぶう'];

  assert.equal(
    lookup.hasCompleteMatch,
    true,
    `Expected a complete conjugation match; got terms: ${lookup.searchTerms.join(', ')}`,
  );
  assert.equal(
    lookup.hasCompleteTextMatch,
    true,
    'Expected a conjugated verb token to count as a full-text match for history purposes.',
  );
  assert.deepEqual(
    firstTwoReadings,
    expectedVerbReadings,
    `Expected both conjugated verbs before partial matches; got: ${firstTwoReadings.join(', ')}`,
  );
  assert(
    lookup.entries.findIndex((entry) => entry.kana.includes('おぶ')) >= 2,
    'Expected the partial noun おぶ to rank below both verb matches.',
  );

  // Test conjugated compound phrase: 肩をすくめて -> 肩をすくめる
  const kataLookup = await getDictionarySearchTerms('肩をすくめて');
  assert.equal(kataLookup.hasCompleteMatch, true, 'Expected complete match for 肩をすくめて');
  assert.equal(kataLookup.hasCompleteTextMatch, true, 'Expected hasCompleteTextMatch for 肩をすくめて');
  assert.equal(kataLookup.baseForm, '肩をすくめる', 'Expected baseForm to be 肩をすくめる');
  assert(
    kataLookup.entries[0]?.kanji.includes('肩をすくめる') || kataLookup.entries[0]?.kanji.includes('肩を竦める'),
    `Expected 肩をすくめる as first entry, got: ${kataLookup.entries[0]?.kanji.join(', ')}`,
  );

  // Test conjugated compound phrase: 気がした -> 気がする
  const kiLookup = await getDictionarySearchTerms('気がした');
  assert.equal(kiLookup.hasCompleteMatch, true, 'Expected complete match for 気がした');
  assert.equal(kiLookup.hasCompleteTextMatch, true, 'Expected hasCompleteTextMatch for 気がした');
  assert.equal(kiLookup.baseForm, '気がする', 'Expected baseForm to be 気がする');
  assert(
    kiLookup.entries[0]?.kanji.includes('気がする'),
    `Expected 気がする as first entry, got: ${kiLookup.entries[0]?.kanji.join(', ')}`,
  );

  // A multi-word phrase where only an internal word has a definition must NOT
  // count as a full-text match for history purposes: the menu may show that
  // word's definition, but the whole phrase must not be stored as a dictionary
  // history entry (it can still be stored as a translation instead).
  const phrase = await getDictionarySearchTerms('猫が好きです');
  if (phrase.hasCompleteMatch && !phrase.entries.some((entry) => entry.kanji.includes('猫が好きです'))) {
    assert.equal(
      phrase.hasCompleteTextMatch,
      false,
      'Expected a partial phrase match to be rejected for dictionary history.',
    );
  }

  console.log('PASS: Dictionary searches correctly prioritize conjugated phrases (肩をすくめて, 気がした, おぶって).');
} finally {
  await server.close();
}
