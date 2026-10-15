import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createServer } from 'vite';

// Minimal in-memory IndexedDB: one database with object stores keyed by `id`.
const stores = new Map();
const later = (callback) => setTimeout(callback, 0);
globalThis.indexedDB = {
  open() {
    const request = {};
    later(() => {
      const db = {
        objectStoreNames: { contains: (name) => stores.has(name) },
        createObjectStore: (name) => stores.set(name, new Map()),
        close() {},
        transaction(name) {
          const transaction = {};
          const store = stores.get(name);
          const done = (result) => {
            const op = { result };
            later(() => transaction.oncomplete?.());
            return op;
          };
          transaction.objectStore = () => ({
            get: (key) => done(store.get(key)),
            put: (value) => done(store.set(value.id, value) && value.id),
            delete: (key) => done(store.delete(key) && undefined),
          });
          return transaction;
        },
      };
      request.result = db;
      if (!stores.size) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  },
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

// Published files, served by a fake fetch; everything else (the bundled English
// JMdict) goes to the real one.
const published = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const file = [...published.entries()].find(([name]) => String(url).endsWith(`/${name}`));
  if (!file) return realFetch(url, init);
  return new Response(file[1], { headers: { 'content-length': String(file[1].length) } });
};
const publish = (name, entries) => published.set(name, gzipSync(JSON.stringify(entries)));

const root = resolve(import.meta.dirname, '..');
const server = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
});

const originalConsoleError = console.error;
console.error = () => {}; // Node has no Worker: the tokenizer error is expected here.

try {
  const dictionaries = await server.ssrLoadModule('/src/utils/optionalDictionaries.ts');
  const { getDictionarySearchTerms } = await server.ssrLoadModule('/src/utils/dictionary.ts');
  const { OPTIONAL_DICTIONARIES, downloadOptionalDictionary, deleteOptionalDictionary, getOptionalDictionaryStatus } = dictionaries;
  const languages = async (query, language, options) =>
    (await getDictionarySearchTerms(query, language, options)).entries.map((entry) => `${entry.language}:${entry.kanji[0] || entry.kana[0]}`);
  // Dictionaries in the order their first entry appears (one dictionary can hold several homographs).
  const order = (entries) => [...new Set(entries)];

  // French has an entry for 猫 and, for 猫舌, only a longer word that starts with it.
  publish(OPTIONAL_DICTIONARIES.fr.file, [
    { id: 'f1', k: ['猫'], r: ['ねこ'], s: [{ p: [], g: ['chat'] }] },
    { id: 'f2', k: ['猫舌症'], r: [], s: [{ p: [], g: ['(fictif) aversion pour le chaud'] }] },
  ]);
  publish(OPTIONAL_DICTIONARIES.ja.file, [{ id: 'w1', k: ['猫'], r: ['ねこ'], s: [{ p: ['名詞'], g: ['ネコ科の動物。'] }], y: ['ニャンコ'] }]);

  // Not installed: a French interface falls back to English, then Spanish.
  assert.deepEqual(order(await languages('猫', 'fr')), ['en:猫', 'es:猫']);

  const progress = [];
  await downloadOptionalDictionary('fr', (step) => progress.push(step));
  assert.ok(progress.at(-1).loaded === progress.at(-1).total && progress.at(-1).total > 0, 'progress reaches the total');
  const status = await getOptionalDictionaryStatus('fr');
  assert.equal(status.installed, true);
  assert.equal(status.outdated, false);

  // Installed: its exact entry comes first...
  assert.deepEqual(order(await languages('猫', 'fr')), ['fr:猫', 'en:猫', 'es:猫']);
  // ...but an exact English entry beats a partial match in the preferred dictionary.
  const nekojita = await languages('猫舌', 'fr');
  assert.deepEqual(order(nekojita).slice(0, 2), ['en:猫舌', 'es:猫舌']);
  assert.ok(nekojita.indexOf('fr:猫舌症') > nekojita.lastIndexOf('es:猫舌'), 'the partial French match follows the exact ones');
  // Other interface languages are unaffected by the French dictionary.
  assert.deepEqual(order(await languages('猫', 'es')), ['es:猫', 'en:猫']);
  assert.ok(!(await languages('猫', 'de')).some((entry) => entry.startsWith('fr:')));

  // Japanese definitions lead with a Japanese interface, ahead of the translation language.
  await downloadOptionalDictionary('ja', () => {});
  const japanese = await getDictionarySearchTerms('猫', 'fr', { includeJapanese: true });
  assert.deepEqual([...new Set(japanese.entries.map((entry) => entry.language))], ['ja', 'fr', 'en', 'es']);
  assert.deepEqual(japanese.entries[0].synonyms, ['ニャンコ']);

  // Removing a dictionary drops it from lookups straight away.
  await deleteOptionalDictionary('fr');
  assert.ok(!(await languages('猫', 'fr')).some((entry) => entry.startsWith('fr:')));

  // A corrupt download is rejected and never stored.
  published.set(OPTIONAL_DICTIONARIES.ko.file, gzipSync('not a dictionary'));
  await assert.rejects(downloadOptionalDictionary('ko', () => {}));
  assert.equal((await getOptionalDictionaryStatus('ko')).installed, false);

  console.log('PASS: optional dictionaries download, validate, lead their language unless English has an exact match, and drop out when removed.');
} finally {
  console.error = originalConsoleError;
  await server.close();
}
