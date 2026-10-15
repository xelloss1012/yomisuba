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

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

try {
  const { AVAILABLE_LANGUAGES, resolveTranslationLanguage, t } = await server.ssrLoadModule('/src/utils/i18n.ts');
  const reference = (await server.ssrLoadModule('/src/i18n/es.ts')).es;
  const referenceKeys = Object.keys(reference).sort();

  // Every interface language has exactly the Spanish keys, with the same
  // placeholders, so no screen silently falls back to Spanish.
  for (const { code } of AVAILABLE_LANGUAGES) {
    const table = (await server.ssrLoadModule(`/src/i18n/${code}.ts`))[code];
    assert.deepEqual(Object.keys(table).sort(), referenceKeys, `${code}: keys differ from es`);
    for (const key of referenceKeys) {
      assert.deepEqual(placeholders(table[key]), placeholders(reference[key]), `${code}: placeholders of ${key}`);
    }
  }

  assert.equal(t('settings.defaultModel', 'ja', { model: 'x/y' }), '既定: x/y');

  // Translation follows the interface, except Japanese, which falls back to English.
  assert.equal(resolveTranslationLanguage('fr'), 'fr');
  assert.equal(resolveTranslationLanguage('ja'), 'en');
  assert.equal(resolveTranslationLanguage('ja', 'es'), 'es');
  assert.equal(resolveTranslationLanguage('de', 'vi'), 'vi');

  console.log(`PASS: ${AVAILABLE_LANGUAGES.length} interface languages share ${referenceKeys.length} keys and placeholders; translation language resolves.`);
} finally {
  await server.close();
}
