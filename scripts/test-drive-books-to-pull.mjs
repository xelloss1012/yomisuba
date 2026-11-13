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
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const { bookNeedsPull, markAllBooksToPull, markBookPulled } = await server.ssrLoadModule('/src/utils/driveBooksToPull.ts');

  // Nothing recorded yet (the first launch of this version): every book takes Drive's data once.
  assert.equal(bookNeedsPull('a'), true);
  markBookPulled('a');
  assert.equal(bookNeedsPull('a'), false, 'then it opens with its own data');
  assert.equal(bookNeedsPull('b'), true, 'the others still take it once');
  markBookPulled('b');
  markBookPulled('b');
  assert.equal(bookNeedsPull('b'), false);

  // Another device's data loaded: every book takes it again, once.
  markAllBooksToPull();
  assert.equal(bookNeedsPull('a'), true);
  assert.equal(bookNeedsPull('b'), true);
  markBookPulled('a');
  assert.equal(bookNeedsPull('a'), false);
  assert.equal(bookNeedsPull('b'), true);

  // A damaged record counts as nothing recorded.
  storage.set('yomisuba_drive_books_to_pull', '{oops');
  assert.equal(bookNeedsPull('a'), true);

  console.log('PASS: books open with their own reading data, and take Drive\'s once after another device\'s data is loaded.');
} finally {
  await server.close();
}
