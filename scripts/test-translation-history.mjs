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
    buildDictionaryHistoryResponse,
    formatDictionaryHistoryResponse,
    readTranslationHistory,
    saveTranslationHistoryEntry,
  } = await server.ssrLoadModule('/src/utils/translationHistory.ts');

  const entries = [
    {
      language: 'es',
      kanji: ['猫'],
      kana: ['ねこ'],
      senses: [{ partOfSpeech: ['n'], glosses: ['gato'] }],
    },
  ];

  const { response, data } = buildDictionaryHistoryResponse('猫', ['猫', 'ねこ'], entries);

  // The structured contract uses fixed English-keyed property names.
  assert.deepEqual(Object.keys(data).sort(), ['baseForm', 'entries', 'searchTerms']);
  assert.deepEqual(Object.keys(data.entries[0]).sort(), ['kana', 'kanji', 'language', 'senses']);
  assert.equal(data.baseForm, '猫');
  assert.deepEqual(data.searchTerms, ['猫', 'ねこ']);

  // The canonical stored response is language-neutral (English labels),
  // never the language of the UI used at save time.
  assert.match(response, /^Base form: 猫/);
  assert.match(response, /^Terms: 猫, ねこ$/m);
  assert.match(response, /^Reading: ねこ$/m);
  assert.ok(!response.includes('Forma base'));
  assert.ok(!response.includes('Términos'));
  assert.ok(!response.includes('Lectura'));

  // Display translation happens at render time using the selected language.
  const es = formatDictionaryHistoryResponse(data, 'es');
  assert.match(es, /^Forma base: 猫/);
  assert.match(es, /^Términos: 猫, ねこ$/m);
  assert.match(es, /^Lectura: ねこ$/m);
  const en = formatDictionaryHistoryResponse(data, 'en');
  assert.match(en, /^Base form: 猫/);
  assert.match(en, /^Terms: 猫, ねこ$/m);

  // The structured `data` survives a save/read round-trip through storage.
  const key = 'test-history';
  const history = saveTranslationHistoryEntry(key, [], {
    kind: 'dictionary',
    query: '猫',
    response,
    data,
  });
  const [stored] = readTranslationHistory(key);
  assert.equal(stored.query, '猫');
  assert.deepEqual(stored.data, data);

  // Entries whose `data` is malformed are rejected on read.
  storage.set(key, JSON.stringify([
    { id: 'a', queriedAt: 1, query: 'x', kind: 'dictionary', response: 'r', data: { nope: true } },
  ]));
  assert.deepEqual(readTranslationHistory(key), []);

  console.log('PASS: dictionary history stores an English contract and translates on display.');
} finally {
  await server.close();
}
