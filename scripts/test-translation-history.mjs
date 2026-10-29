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
    getHistoryEntryResponse,
    HISTORY_PREVIEW_LENGTH,
    HISTORY_DEDUP_WINDOW_MS,
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

  // A) Dictionary entries are stored WITHOUT the redundant `response` text: it is
  // re-derived from `data` on display. Only `data` is persisted.
  const key = 'test-history';
  const history = saveTranslationHistoryEntry(key, [], {
    kind: 'dictionary',
    query: '猫',
    response,
    data,
  });
  assert.equal(history[0].response, undefined, 'dictionary entry must not persist response');
  assert.ok(!('response' in history[0]));
  const [stored] = readTranslationHistory(key);
  assert.equal(stored.query, '猫');
  assert.deepEqual(stored.data, data);
  // getHistoryEntryResponse re-renders from data in any UI language.
  assert.match(getHistoryEntryResponse(stored, 'es'), /^Forma base: 猫/);
  assert.match(getHistoryEntryResponse(stored, 'en'), /^Base form: 猫/);

  // B) Long translation/AI answers are truncated to a short preview in the
  // history so they cannot bloat storage.
  const longText = 'あ'.repeat(5000);
  const tkey = 'test-history-translation';
  const [translation] = saveTranslationHistoryEntry(tkey, [], {
    kind: 'translation',
    query: '長い段落',
    response: longText,
  });
  assert.ok(translation.response.length <= HISTORY_PREVIEW_LENGTH + 2);
  assert.ok(translation.response.startsWith('あ'));
  assert.ok(translation.response.endsWith('…'));

  // Entries whose `data` is malformed are rejected on read.
  storage.set(key, JSON.stringify([
    { id: 'a', queriedAt: 1, query: 'x', kind: 'dictionary', response: 'r', data: { nope: true } },
  ]));
  assert.deepEqual(readTranslationHistory(key), []);

  // An entry with neither `response` nor valid `data` is also rejected.
  storage.set(key, JSON.stringify([
    { id: 'a', queriedAt: 1, query: 'x', kind: 'translation' },
  ]));
  assert.deepEqual(readTranslationHistory(key), []);

  // C) De-duplication by kind + query within the time window.
  const dkey = 'test-history-dedup';
  let h = [];
  // Same dictionary word consulted three times in a row → single entry.
  h = saveTranslationHistoryEntry(dkey, h, { kind: 'dictionary', query: '猫', response: 'r', data });
  h = saveTranslationHistoryEntry(dkey, h, { kind: 'dictionary', query: '猫', response: 'r', data });
  h = saveTranslationHistoryEntry(dkey, h, { kind: 'dictionary', query: '猫', response: 'r', data });
  assert.equal(h.length, 1, 'repeated same-kind word must not stack');

  // A → B → A still keeps a single entry for A (it is refreshed to the top).
  h = saveTranslationHistoryEntry(dkey, h, { kind: 'dictionary', query: '犬', response: 'r', data });
  assert.equal(h.length, 2);
  h = saveTranslationHistoryEntry(dkey, h, { kind: 'dictionary', query: '猫', response: 'r', data });
  assert.equal(h.length, 2, 'A→B→A must not duplicate A');
  assert.equal(h[0].query, '猫', 'refreshed entry moves to the top');

  // Same word but a different kind is a distinct entry.
  h = saveTranslationHistoryEntry(dkey, h, { kind: 'translation', query: '猫', response: 'gato' });
  assert.equal(h.filter((e) => e.query === '猫').length, 2, 'dictionary vs translation are different entries');

  // Outside the dedup window, the same word is appended again.
  const stale = [{
    id: 'old', queriedAt: Date.now() - HISTORY_DEDUP_WINDOW_MS - 1000,
    query: '古い', kind: 'dictionary', data,
  }];
  const grown = saveTranslationHistoryEntry(dkey, stale, { kind: 'dictionary', query: '古い', response: 'r', data });
  assert.equal(grown.length, 2, 'same word outside the window is a new entry');

  // D) Looked up from the text: the sentence decides, not the time.
  const s1 = '吾輩は猫である。';
  const s2 = '名前はまだ無い猫。';
  const old = [{ id: 'o', queriedAt: Date.now() - 3 * 86_400_000, query: '猫', kind: 'dictionary', data, context: s1 }];
  let c = saveTranslationHistoryEntry(dkey, old, { kind: 'dictionary', query: '猫', response: 'r', data, context: `  ${s1}
` });
  assert.equal(c.length, 1, 'the same sentence days later is the same appearance');
  assert.equal(c[0].context, s1, 'the sentence is kept on one line');
  c = saveTranslationHistoryEntry(dkey, c, { kind: 'dictionary', query: '猫', response: 'r', data, context: s2 });
  assert.equal(c.length, 2, 'another sentence right away is a new appearance');
  c = saveTranslationHistoryEntry(dkey, c, { kind: 'dictionary', query: '猫', response: 'r', data, context: s1 });
  assert.equal(c.length, 2, 'going back to the first sentence refreshes its entry');
  assert.equal(c[0].context, s1);
  assert.equal(HISTORY_DEDUP_WINDOW_MS, 10 * 60_000, 'with no sentence, the same lookup within 10 minutes');

  console.log('PASS: history de-duplicates dictionary text, previews long translations, and de-dupes by kind+query over time.');
} finally {
  await server.close();
}
