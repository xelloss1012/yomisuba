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
  const { bookPage, comparePositions, describeDevice, getDeviceId, latestPaginationCounts } = await server.ssrLoadModule('/src/utils/driveDevice.ts');

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

  // --- This device's last measured layout ---------------------------------------------------
  assert.deepEqual(latestPaginationCounts(JSON.stringify({
    a: { counts: [1, 2], savedAt: 1 },
    b: { counts: [3, 4], savedAt: 5 },
    c: { counts: [0, 4], savedAt: 9 },
  })), [3, 4], 'the newest valid layout');
  assert.equal(latestPaginationCounts(null), undefined);
  assert.equal(latestPaginationCounts('not json'), undefined);

  // --- Positions here and in Drive, in each way of counting pages ---------------------------
  // Here the book has 2 + 10 + 20 = 32 pages; the other device, with a bigger screen, 1 + 5 + 10 = 16.
  const here = [2, 10, 20];
  const there = [1, 5, 10];
  const compared = comparePositions({
    local: { spineIndex: 1, page: 4, pageCount: 10 },
    localCounts: here,
    remote: { spineIndex: 2, page: 4, pageCount: 10 },
    remoteCounts: there,
    printedPages: 200,
  });
  assert.deepEqual(compared.device, { from: 7, to: 21, total: 32, layout: 'here' }, 'both counted with the pages of this device');
  assert.deepEqual(compared.percent, { from: 22, to: 69 }, 'each position with its own layout');
  assert.deepEqual(compared.printed, { from: 40, to: 134, total: 200 });
  assert.deepEqual(compared.chapter, { from: 2, to: 3, total: 3 });

  const withoutHere = comparePositions({ local: { spineIndex: 0, page: 0 }, remote: { spineIndex: 1, page: 2, pageCount: 5 }, remoteCounts: there });
  assert.equal(withoutHere.device.layout, 'drive', 'without a layout here, the one in Drive is used');
  assert.deepEqual([withoutHere.device.from, withoutHere.device.to, withoutHere.device.total], [1, 4, 16]);
  assert.equal(withoutHere.printed, null);

  const nothingHere = comparePositions({ local: null, remote: { spineIndex: 1, page: 0 } });
  assert.equal(nothingHere.device, null);
  assert.deepEqual(nothingHere.percent, { from: null, to: null });
  assert.deepEqual(nothingHere.chapter, { from: null, to: 2, total: null });

  console.log('PASS: the device keeps one identifier, is named by model or system and browser, positions are placed in the whole book and compared in each way of counting pages.');
} finally {
  await server.close();
}
