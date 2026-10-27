import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
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
  const { resolveReadingPage } = await server.ssrLoadModule('/src/utils/readingPosition.ts');
  const locateOffset = (offset) => offset === 420 ? 4 : offset === 999 ? 99 : null;

  assert.equal(resolveReadingPage(
    { page: 1, pageCount: 8, textOffset: 420 },
    8,
    locateOffset,
  ), 4, 'text position wins even when saved and current page counts match');
  assert.equal(resolveReadingPage(
    { page: 1, pageCount: 8, textOffset: 420 },
    12,
    locateOffset,
  ), 4, 'text position wins when pagination differs');
  assert.equal(resolveReadingPage(
    { page: 1, pageCount: 8, textOffset: 1000 },
    12,
    locateOffset,
  ), 2, 'page-ratio mapping remains the fallback if the text anchor is unavailable');
  assert.equal(resolveReadingPage(
    { page: 99, pageCount: 8 },
    6,
    locateOffset,
  ), 5, 'resolved positions are clamped to the chapter');
  assert.equal(resolveReadingPage(
    { page: 99, pageCount: 8, textOffset: 999 },
    6,
    locateOffset,
  ), 5, 'text anchors are clamped to the chapter');

  console.log('PASS: reading position prefers the text anchor and falls back safely.');
} finally {
  await server.close();
}
