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

// An in-memory file system with the same port as the real one of the app.
const createFiles = () => {
  const store = new Map();
  const writes = [];
  return {
    store,
    writes,
    async writeBase64(path, base64, append) {
      writes.push(path);
      const bytes = Buffer.from(base64, 'base64');
      store.set(path, append ? Buffer.concat([store.get(path) ?? Buffer.alloc(0), bytes]) : bytes);
    },
    async writeText(path, text) { writes.push(path); store.set(path, Buffer.from(text, 'utf8')); },
    async readText(path) { return store.has(path) ? store.get(path).toString('utf8') : null; },
    async readBlob(path, type) { return store.has(path) ? new Blob([store.get(path)], { type }) : null; },
    async list(directory) {
      return [...store]
        .filter(([path]) => path.startsWith(`${directory}/`) && !path.slice(directory.length + 1).includes('/'))
        .map(([path, data]) => ({ name: path.slice(directory.length + 1), size: data.length }));
    },
    async size(path) { return store.has(path) ? store.get(path).length : null; },
    async remove(path) { store.delete(path); },
  };
};
const memoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
};

try {
  const { createNativeBookStore, createStateMirror, bookFileKey, isMirroredKey } = await server.ssrLoadModule('/src/utils/nativeStorage.ts');
  const bytesOf = async (blob) => Buffer.from(await blob.arrayBuffer());
  const book = (id, extra = {}) => ({
    id, name: `${id}.epub`, title: `タイトル ${id}`, creator: '著者', lastOpened: 1000,
    blob: new Blob([Buffer.from(`epub ${id}`)], { type: 'application/epub+zip' }), ...extra,
  });

  // File names: short and stable, whatever the id.
  const longId = encodeURIComponent(`${'とても長い題名'.repeat(40)}.epub|題|著者`);
  const key = await bookFileKey(longId);
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal(await bookFileKey(longId), key);
  assert.notEqual(await bookFileKey(`${longId}x`), key);

  // Save, list, get, remove.
  {
    const files = createFiles();
    const store = createNativeBookStore(files);
    await store.save(book('a', { lastOpened: 1 }));
    await store.save(book('b', { lastOpened: 3, printedPages: 120, cover: new Blob([Buffer.from([1, 2, 3])], { type: 'image/png' }) }));
    await store.save(book('c', { lastOpened: 2 }));

    const listed = await store.list();
    assert.deepEqual(listed.map((item) => item.id), ['b', 'c', 'a'], 'newest first');
    assert.equal(listed[0].printedPages, 120);
    assert.equal(listed[0].blobLoaded, false, 'a listed book does not carry its text');
    assert.equal(listed[0].blob.size, 0);
    assert.deepEqual([...await bytesOf(listed[0].cover)], [1, 2, 3], 'the cover comes with the list');
    assert.equal(listed[1].cover, undefined);

    const full = await store.get('b');
    assert.equal(full.blobLoaded, true);
    assert.equal((await bytesOf(full.blob)).toString(), 'epub b');
    assert.equal(await store.get('nope'), null);

    const keyOfB = await bookFileKey('b');
    await store.remove('b');
    assert.deepEqual((await store.list()).map((item) => item.id), ['c', 'a']);
    assert.equal(await store.get('b'), null);
    assert.equal([...files.store.keys()].filter((path) => path.includes(keyOfB)).length, 0, 'every file of the book is gone');
  }

  // A large book is written in pieces and comes back byte for byte.
  {
    const files = createFiles();
    const store = createNativeBookStore(files);
    const data = Buffer.alloc(7 * 1024 * 1024 + 123);
    for (let index = 0; index < data.length; index += 1) data[index] = (index * 31 + 7) & 255;
    await store.save(book('big', { blob: new Blob([data], { type: 'application/epub+zip' }) }));
    const back = await store.get('big');
    assert.equal(back.blob.size, data.length);
    assert.ok(Buffer.compare(await bytesOf(back.blob), data) === 0, 'identical bytes');
  }

  // Saving again does not rewrite the text, and a book without its text only updates the details.
  {
    const files = createFiles();
    const store = createNativeBookStore(files);
    const original = book('r');
    await store.save(original);
    const epubPath = [...files.store.keys()].find((path) => path.endsWith('.epub'));
    const before = files.writes.filter((path) => path === epubPath).length;
    await store.save({ ...original, lastOpened: 5000 });
    assert.equal(files.writes.filter((path) => path === epubPath).length, before, 'the text is not written twice');
    assert.equal((await store.list())[0].lastOpened, 5000, 'but the details are');

    const [light] = await store.list();
    await store.save({ ...light, cover: new Blob([Buffer.from([9])], { type: 'image/png' }) });
    assert.equal((await bytesOf((await store.get('r')).blob)).toString(), 'epub r', 'a light save leaves the text alone');
    assert.deepEqual([...await bytesOf((await store.get('r')).cover)], [9]);
    await store.save({ ...(await store.get('r')), cover: undefined, lastOpened: 6000 });
    assert.ok((await store.get('r')).cover, 'a save without a cover keeps the one there is');
  }

  // A damaged entry does not hide the others, and a book without its text is not handed out.
  {
    const files = createFiles();
    const store = createNativeBookStore(files);
    await store.save(book('ok'));
    files.store.set('yomisuba/books/broken.json', Buffer.from('{not json'));
    assert.deepEqual((await store.list()).map((item) => item.id), ['ok']);
    await store.save(book('half'));
    for (const path of [...files.store.keys()]) {
      if (path.endsWith('.epub') && files.store.get(path).toString() === 'epub half') files.store.delete(path);
    }
    assert.equal(await store.get('half'), null);
  }

  // Reading data: the right keys, copied, and restored only when the storage was cleared.
  assert.ok(isMirroredKey('yomisuba_settings_v1'));
  assert.ok(isMirroredKey('yomisuba_book_x_position'));
  assert.ok(!isMirroredKey('yomisuba_book_x_pagination'), 'rebuilt by the app');
  assert.ok(!isMirroredKey('yomisuba_translation_cache_v1'));
  assert.ok(!isMirroredKey('other_site_key'));
  {
    const files = createFiles();
    const storage = memoryStorage({
      yomisuba_settings_v1: '{"language":"es"}',
      yomisuba_book_x_position: '{"page":42}',
      yomisuba_book_x_pagination: '{"huge":true}',
      unrelated: '1',
    });
    const mirror = createStateMirror(files, storage);
    await mirror.snapshot();
    const saved = JSON.parse(files.store.get('yomisuba/state.json').toString()).entries;
    assert.deepEqual(Object.keys(saved).sort(), ['yomisuba_book_x_position', 'yomisuba_settings_v1']);

    // Nothing is restored while the storage is intact, and nothing is overwritten.
    storage.setItem('yomisuba_book_x_position', '{"page":50}');
    assert.equal(await mirror.restoreIfCleared('yomisuba_settings_v1'), 0);
    assert.equal(storage.getItem('yomisuba_book_x_position'), '{"page":50}');

    // Cleared: it comes back.
    const cleared = memoryStorage();
    assert.equal(await createStateMirror(files, cleared).restoreIfCleared('yomisuba_settings_v1'), 2);
    assert.equal(cleared.getItem('yomisuba_book_x_position'), '{"page":42}');
    assert.equal(cleared.getItem('yomisuba_settings_v1'), '{"language":"es"}');

    // An empty storage never replaces a good copy with nothing.
    await createStateMirror(files, memoryStorage()).snapshot();
    assert.equal(JSON.parse(files.store.get('yomisuba/state.json').toString()).entries.yomisuba_settings_v1, '{"language":"es"}');

    // Partial storage loss: book keys are restored even if settings (sentinel) are already present.
    const partialStorage = memoryStorage({ yomisuba_settings_v1: '{"language":"es"}' });
    assert.equal(await createStateMirror(files, partialStorage).restoreIfCleared('yomisuba_settings_v1'), 1);
    assert.equal(partialStorage.getItem('yomisuba_book_x_position'), '{"page":42}', 'missing book data is recovered');

    // Safe merge: a snapshot with partial storage preserves other stored keys in state.json.
    const singleKeyStorage = memoryStorage({ yomisuba_settings_v1: '{"language":"ja"}' });
    await createStateMirror(files, singleKeyStorage).snapshot();
    const mergedSaved = JSON.parse(files.store.get('yomisuba/state.json').toString()).entries;
    assert.equal(mergedSaved.yomisuba_settings_v1, '{"language":"ja"}', 'updated key is written');
    assert.equal(mergedSaved.yomisuba_book_x_position, '{"page":42}', 'absent key is preserved');

    // Explicit deletion removes key from state.json.
    await createStateMirror(files, memoryStorage({ yomisuba_settings_v1: '{"language":"ja"}' })).snapshot('yomisuba_book_x_position');
    const afterDelete = JSON.parse(files.store.get('yomisuba/state.json').toString()).entries;
    assert.equal(afterDelete.yomisuba_book_x_position, undefined, 'explicitly deleted key is removed');

    // Corrupted state.json recovers from state.backup.json.
    files.store.set('yomisuba/state.json', Buffer.from('{corrupted'));
    const recovered = memoryStorage();
    assert.ok((await createStateMirror(files, recovered).restoreIfCleared()) > 0, 'restores from backup file');
    assert.ok(recovered.getItem('yomisuba_settings_v1'), 'settings restored from backup');

    // No copy yet, or a damaged one without backup: the app just starts empty.
    assert.equal(await createStateMirror(createFiles(), memoryStorage()).restoreIfCleared('yomisuba_settings_v1'), 0);
    const damaged = createFiles();
    damaged.store.set('yomisuba/state.json', Buffer.from('nope'));
    assert.equal(await createStateMirror(damaged, memoryStorage()).restoreIfCleared('yomisuba_settings_v1'), 0);
  }

  console.log('PASS: books and reading data are kept in the app storage (chunked writes, light listings, no rewrites) and restored only when the WebView storage was cleared.');
} finally {
  await server.close();
}
