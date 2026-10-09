import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
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
  const {
    isTranslationFavorite,
    MAX_TRANSLATION_FAVORITES,
    readTranslationFavorites,
    toggleTranslationFavorite,
    writeTranslationFavorites,
  } = await server.ssrLoadModule('/src/utils/translationFavorites.ts');
  const key = 'test-favorites';
  const candidate = {
    query: '走る',
    kind: 'dictionary',
    response: 'Definición: correr',
  };

  const added = toggleTranslationFavorite(key, [], candidate);
  assert.equal(added.length, 1);
  assert.equal(isTranslationFavorite(added, candidate), true);
  assert.equal(readTranslationFavorites(key)[0].response, candidate.response);

  const removed = toggleTranslationFavorite(key, added, candidate);
  assert.deepEqual(removed, []);
  assert.deepEqual(readTranslationFavorites(key), []);

  assert.equal(MAX_TRANSLATION_FAVORITES, 5000);
  const manyFavorites = Array.from({ length: 5001 }, (_, index) => ({
    id: `favorite-${index}`,
    savedAt: index,
    query: 'x',
    kind: 'dictionary',
    response: '',
  }));
  assert.equal(writeTranslationFavorites(key, manyFavorites).length, 5000);

  console.log('PASS: favorites persist locally and toggle on/off by definition.');
} finally {
  await server.close();
}
