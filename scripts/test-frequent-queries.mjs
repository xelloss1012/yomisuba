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
  const { readFrequentQueries, recordFrequentQuery, FREQUENT_QUERIES_DEDUP_WINDOW_MS, MAX_QUERY_CONTEXTS } =
    await server.ssrLoadModule('/src/utils/frequentQueries.ts');
  const { HISTORY_DEDUP_WINDOW_MS } = await server.ssrLoadModule('/src/utils/translationHistory.ts');
  assert.equal(
    FREQUENT_QUERIES_DEDUP_WINDOW_MS,
    HISTORY_DEDUP_WINDOW_MS,
    'frequent queries and history must share the same de-dup window',
  );
  const key = 'test-frequent-queries';
  storage.set(key, JSON.stringify([{ key: 'antiguo', query: 'antiguo', count: 35, updatedAt: Date.now() }]));
  let queries = readFrequentQueries(key);
  assert.deepEqual(queries, []);
  assert.equal(storage.has(key), false);
  queries = recordFrequentQuery(key, queries, '猫');
  queries = recordFrequentQuery(key, queries, '  猫  ');
  queries = recordFrequentQuery(key, queries, '猫が好き');

  // The repeat inside the de-dup window refreshes the entry but must not add a
  // query — same rule the history applies to its entries. With equal counts the
  // list falls back to `updatedAt`, so the last recorded term comes first.
  assert.deepEqual(
    queries.map(({ query, count }) => ({ query, count })),
    [{ query: '猫が好き', count: 1 }, { query: '猫', count: 1 }],
  );
  assert.equal(readFrequentQueries(key).find((item) => item.key === '猫')?.count, 1);
  assert.equal(storage.get(`${key}_version`), '2');

  // The window slides: a repeat keeps the count and pushes `updatedAt` forward,
  // so the next repeat is measured from the last consultation.
  const windowKey = 'test-frequent-queries-window';
  const inside = [{ key: '猫', query: '猫', count: 3, updatedAt: Date.now() - HISTORY_DEDUP_WINDOW_MS / 2 }];
  const slid = recordFrequentQuery(windowKey, inside, '猫');
  assert.equal(slid.length, 1);
  assert.equal(slid[0].count, 3, 'repeat inside the window must not increment');
  assert.ok(slid[0].updatedAt > inside[0].updatedAt, 'the window slides forward');

  // Outside the window the same term is a new consultation again.
  const stale = [
    { key: '猫', query: '猫', count: 3, updatedAt: Date.now() - HISTORY_DEDUP_WINDOW_MS - 1000 },
  ];
  const grown = recordFrequentQuery(windowKey, stale, '猫');
  assert.equal(grown[0].count, 4, 'outside the window the query counts again');

  // Looked up from the text: once per sentence, however long ago; another sentence counts at once.
  const textKey = 'test-frequent-queries-text';
  let q = recordFrequentQuery(textKey, [], '激怒', 'メロスは激怒した。');
  q = recordFrequentQuery(textKey, q, '激怒', 'メロスは激怒した。');
  assert.equal(q[0].count, 1, 'the same sentence is the same appearance');
  q = recordFrequentQuery(textKey, q, '激怒', '王は激怒した。');
  assert.equal(q[0].count, 2, 'another sentence is a new appearance, even right away');
  q = [{ ...q[0], updatedAt: Date.now() - 86_400_000 }];
  q = recordFrequentQuery(textKey, q, '激怒', 'メロスは激怒した。');
  assert.equal(q[0].count, 2, 'rereading the first sentence a day later does not count');
  for (let index = 0; index < 6; index += 1) q = recordFrequentQuery(textKey, q, '激怒', `文${index}。`);
  assert.equal(q[0].count, 8);
  assert.equal(q[0].contexts.length, MAX_QUERY_CONTEXTS, 'only the last sentences are remembered');
  assert.ok(!JSON.stringify(q).includes('文0'), 'the sentences are kept as fingerprints, not as text');
  // A count from before sentences were remembered falls back to the window.
  const legacy = [{ key: '王', query: '王', count: 2, updatedAt: Date.now() }];
  assert.equal(recordFrequentQuery(textKey, legacy, '王', '王は激怒した。')[0].count, 2);

  console.log('PASS: frequent queries normalize, de-dup within the window, count, sort, and persist.');
} finally {
  await server.close();
}
