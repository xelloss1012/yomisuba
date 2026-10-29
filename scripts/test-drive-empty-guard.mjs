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

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

// A Drive with one flat namespace: enough for files looked up by name.
const files = new Map();
let nextId = 1;
const json = (body, headers = {}) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ...headers } });
globalThis.fetch = async (url, init = {}) => {
  const target = new URL(url);
  const method = init.method || 'GET';
  if (target.hostname === 'upload.test') {
    const name = decodeURIComponent(target.pathname.slice(1));
    files.get(name).content = await new Response(init.body).text();
    return json({ id: files.get(name).id, name });
  }
  if (target.pathname.startsWith('/upload/drive/v3/files')) {
    const { name } = JSON.parse(init.body);
    if (!files.has(name)) files.set(name, { id: `f${nextId++}`, name, content: '' });
    return json({}, { Location: `https://upload.test/${encodeURIComponent(name)}` });
  }
  if (method === 'POST') {
    const { name } = JSON.parse(init.body);
    const folder = { id: `d${nextId++}`, name };
    files.set(name, folder);
    return json({ id: folder.id });
  }
  if (target.searchParams.get('alt') === 'media') {
    const file = [...files.values()].find((item) => target.pathname.endsWith(`/${item.id}`));
    return new Response(file.content);
  }
  const name = /name = '([^']*)'/.exec(target.searchParams.get('q') || '')?.[1];
  const found = files.get(name);
  return json({ files: found ? [{ id: found.id, name: found.name }] : [] });
};

try {
  const drive = await server.ssrLoadModule('/src/utils/googleDriveBackup.ts');
  const bookKey = `yomisuba_book_${encodeURIComponent('猫|漱石')}`;
  const favorite = { id: 'a', savedAt: 1, query: '猫', kind: 'translation', response: 'cat' };
  const book = (favorites, dirtyGroups) => ({
    formatVersion: 1, bookKey, title: '猫', creator: '漱石',
    bookmarks: [], annotations: [], translationHistory: [], favorites,
    ...(dirtyGroups ? { dirtyGroups } : {}),
  });
  const remoteFavorites = () => JSON.parse(files.get('favorites.json').content).items;

  await drive.saveGoogleDriveReaderData('token', book([favorite], ['favorites']));
  assert.deepEqual(remoteFavorites(), [favorite]);

  // A full copy (no group changed on purpose) that has no favorites does not empty Drive: the device may
  // simply not have them yet, so Drive's are kept and brought here.
  await drive.saveGoogleDriveReaderData('token', book([]));
  assert.deepEqual(remoteFavorites(), [favorite]);
  assert.deepEqual(JSON.parse(localStorage.getItem(`${bookKey}_translation_favorites`)), [favorite]);

  // Removing the last favorite on purpose empties Drive, and the removed one does not come back.
  localStorage.removeItem(`${bookKey}_translation_favorites`);
  await drive.saveGoogleDriveReaderData('token', book([], ['favorites']));
  assert.deepEqual(remoteFavorites(), []);
  assert.equal(localStorage.getItem(`${bookKey}_translation_favorites`), null);

  // While waiting in the queue, the changed groups add up, so the emptied list still goes up as empty.
  drive.queueGoogleDriveReaderData(book([], ['favorites']));
  drive.queueGoogleDriveReaderData({ ...book([], ['bookmarks']), bookmarks: [] });
  assert.deepEqual(drive.getPendingGoogleDriveReaderData()[bookKey].dirtyGroups, ['favorites', 'bookmarks']);
  await drive.syncPendingGoogleDriveReaderData('token');
  assert.deepEqual(remoteFavorites(), []);
  assert.deepEqual(drive.getPendingGoogleDriveReaderData(), {});

  // An empty copy that only moved the reading place does not replace a queued copy with data, but one that
  // removed the last favorite does.
  drive.queueGoogleDriveReaderData(book([favorite], ['favorites']));
  drive.queueGoogleDriveReaderData(book([], ['reading']));
  assert.deepEqual(drive.getPendingGoogleDriveReaderData()[bookKey].favorites, [favorite]);
  drive.queueGoogleDriveReaderData(book([], ['favorites']));
  assert.deepEqual(drive.getPendingGoogleDriveReaderData()[bookKey].favorites, []);
  localStorage.clear();

  // A queued full copy stays full: later changes do not narrow what it writes.
  drive.queueGoogleDriveReaderData(book([favorite]));
  drive.queueGoogleDriveReaderData(book([favorite], ['favorites']));
  assert.equal(drive.getPendingGoogleDriveReaderData()[bookKey].dirtyGroups, undefined);

  console.log('PASS: Drive keeps its data against empty full copies, but a list emptied on purpose stays empty.');
} finally {
  await server.close();
}
