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
  const { readFrequentQueries, recordFrequentQuery } =
    await server.ssrLoadModule('/src/utils/frequentQueries.ts');
  const key = 'test-frequent-queries';
  storage.set(key, JSON.stringify([{ key: 'antiguo', query: 'antiguo', count: 35, updatedAt: Date.now() }]));
  let queries = readFrequentQueries(key);
  assert.deepEqual(queries, []);
  assert.equal(storage.has(key), false);
  queries = recordFrequentQuery(key, queries, '猫');
  queries = recordFrequentQuery(key, queries, '  猫  ');
  queries = recordFrequentQuery(key, queries, '猫が好き');

  assert.deepEqual(
    queries.map(({ query, count }) => ({ query, count })),
    [{ query: '猫', count: 2 }, { query: '猫が好き', count: 1 }],
  );
  assert.equal(readFrequentQueries(key)[0].count, 2);
  assert.equal(storage.get(`${key}_version`), '2');

  console.log('PASS: frequent queries normalize, count, sort, and persist.');
} finally {
  await server.close();
}
