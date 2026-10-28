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
  const { bookPage, describeDevice, getDeviceId } = await server.ssrLoadModule('/src/utils/driveDevice.ts');

  // --- The identifier of this device is made once and kept ---------------------------
  const id = getDeviceId();
  assert.ok(id.length >= 8);
  assert.equal(getDeviceId(), id);
  storage.clear();
  assert.notEqual(getDeviceId(), id, 'another installation, another identifier');

  // --- A name a person recognises ------------------------------------------------------
  assert.equal(describeDevice('Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36'), 'Android · Pixel 7');
  assert.equal(describeDevice('Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'), 'Android · SM-X200');
  assert.equal(describeDevice('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'), 'Android', 'a hidden model is not a name');
  assert.equal(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'), 'Windows · Chrome');
  assert.equal(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0'), 'Windows · Edge');
  assert.equal(describeDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'iPad');
  assert.equal(describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0'), 'Linux · Firefox');

  // --- Where a position falls in the whole book -------------------------------------------
  const counts = [2, 10, 20];
  assert.deepEqual(bookPage({ spineIndex: 0, page: 0 }, counts), { page: 1, total: 32 });
  assert.deepEqual(bookPage({ spineIndex: 1, page: 4, pageCount: 10 }, counts), { page: 7, total: 32 });
  assert.deepEqual(bookPage({ spineIndex: 2, page: 9, pageCount: 10 }, counts), { page: 32, total: 32 }, 'a position of another layout is mapped onto this one');
  assert.deepEqual(bookPage({ spineIndex: 9, page: 0 }, counts), { page: 13, total: 32 }, 'a chapter beyond the counts is the last one');
  assert.equal(bookPage({ spineIndex: 1, page: 3 }, undefined), null);
  assert.equal(bookPage({ spineIndex: 1, page: 3 }, []), null);

  console.log('PASS: the device keeps one identifier, is named by model or system and browser, and positions are placed in the whole book.');
} finally {
  await server.close();
}
