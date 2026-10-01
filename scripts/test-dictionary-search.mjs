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
  assert.deepEqual(
    firstTwoReadings,
    expectedVerbReadings,
    `Expected both conjugated verbs before partial matches; got: ${firstTwoReadings.join(', ')}`,
  );
  assert(
    lookup.entries.findIndex((entry) => entry.kana.includes('おぶ')) >= 2,
    'Expected the partial noun おぶ to rank below both verb matches.',
  );

  console.log('PASS: おぶって ranks 負ぶる (おぶる) and 負ぶう (おぶう) before partial matches.');
} finally {
  await server.close();
}
