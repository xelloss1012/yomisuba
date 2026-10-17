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

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
  };
};

const release = (tag, overrides = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/xelloss1012/yomisuba/releases/tag/${tag}`,
  assets: [{ name: 'yomisuba.apk', browser_download_url: `https://github.com/xelloss1012/yomisuba/releases/download/${tag}/yomisuba.apk` }],
  ...overrides,
});

try {
  const update = await server.ssrLoadModule('/src/utils/updateCheck.ts');
  const { isNewerVersion, parseRelease, checkForUpdate, APP_VERSION } = update;

  // The version the build reports is the one in package.json.
  const { version } = JSON.parse((await import('node:fs')).readFileSync(resolve(root, 'package.json'), 'utf8'));
  assert.equal(APP_VERSION, version);

  // Versions compare number by number, so 1.10.0 is newer than 1.9.0; anything else is never newer.
  assert.equal(isNewerVersion('v1.1.0', '1.0.0'), true);
  assert.equal(isNewerVersion('1.10.0', '1.9.0'), true);
  assert.equal(isNewerVersion('2.0.0', '1.99.99'), true);
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false);
  assert.equal(isNewerVersion('1.0.0', '1.0.1'), false);
  assert.equal(isNewerVersion('latest', '1.0.0'), false);
  assert.equal(isNewerVersion('1.1.0-beta', '1.0.0'), false);

  // A release is read only if its links stay inside this repository's releases.
  assert.deepEqual(parseRelease(release('v1.2.0')), {
    version: '1.2.0',
    releaseUrl: 'https://github.com/xelloss1012/yomisuba/releases/tag/v1.2.0',
    apkUrl: 'https://github.com/xelloss1012/yomisuba/releases/download/v1.2.0/yomisuba.apk',
  });
  assert.equal(parseRelease(release('v1.2.0', { assets: [] })).apkUrl, null);
  assert.equal(parseRelease(release('v1.2.0', { assets: [{ name: 'yomisuba.apk', browser_download_url: 'https://evil.example/yomisuba.apk' }] })).apkUrl, null);
  assert.equal(parseRelease(release('v1.2.0', { html_url: 'https://evil.example/release' })), null);
  assert.equal(parseRelease(release('nightly')), null);
  assert.equal(parseRelease(null), null);
  assert.equal(parseRelease('text'), null);

  const respond = (body, status = 200) => {
    const calls = [];
    const fetchFake = async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(body), { status });
    };
    return { fetchFake, calls };
  };
  const HOUR = 60 * 60 * 1000;
  let clock = 1_000_000;
  const environment = (storage, fetchFake) => ({ currentVersion: '1.0.0', now: () => clock, fetch: fetchFake, storage });

  // Asks GitHub, remembers the answer and does not ask again within a day.
  {
    const storage = memoryStorage();
    const { fetchFake, calls } = respond(release('v1.1.0'));
    const found = await checkForUpdate({}, environment(storage, fetchFake));
    assert.equal(found.version, '1.1.0');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /api\.github\.com\/repos\/xelloss1012\/yomisuba\/releases\/latest$/);
    clock += 23 * HOUR;
    assert.equal((await checkForUpdate({}, environment(storage, fetchFake))).version, '1.1.0', 'answers from the stored check');
    assert.equal(calls.length, 1);
    clock += 2 * HOUR;
    await checkForUpdate({}, environment(storage, fetchFake));
    assert.equal(calls.length, 2, 'asks again after a day');
    await checkForUpdate({ force: true }, environment(storage, fetchFake));
    assert.equal(calls.length, 3, 'force skips the wait');
  }

  // Nothing to report when the installed version is the latest (or ahead), and the stored answer
  // follows an upgrade of the app without asking again.
  {
    const storage = memoryStorage();
    const { fetchFake, calls } = respond(release('v1.1.0'));
    assert.equal(await checkForUpdate({}, { ...environment(storage, fetchFake), currentVersion: '1.1.0' }), null);
    assert.equal(await checkForUpdate({}, { ...environment(storage, fetchFake), currentVersion: '1.2.0' }), null);
    assert.equal(calls.length, 1);
    assert.equal((await checkForUpdate({}, { ...environment(storage, fetchFake), currentVersion: '1.0.0' })).version, '1.1.0');
  }

  // The reader's switch: off means GitHub is not asked at all.
  {
    const storage = memoryStorage();
    const { fetchFake, calls } = respond(release('v1.1.0'));
    assert.equal(update.isUpdateCheckEnabled(storage), true);
    update.setUpdateCheckEnabled(false, storage);
    assert.equal(update.isUpdateCheckEnabled(storage), false);
    assert.equal(await checkForUpdate({ force: true }, environment(storage, fetchFake)), null);
    assert.equal(calls.length, 0);
    update.setUpdateCheckEnabled(true, storage);
    assert.equal((await checkForUpdate({}, environment(storage, fetchFake))).version, '1.1.0');
  }

  // "Not now" hides one version only.
  {
    const storage = memoryStorage();
    assert.equal(update.isUpdateDismissed('1.1.0', storage), false);
    update.dismissUpdate('1.1.0', storage);
    assert.equal(update.isUpdateDismissed('1.1.0', storage), true);
    assert.equal(update.isUpdateDismissed('1.2.0', storage), false);
  }

  // A failing or odd answer never breaks the app, and keeps what was known.
  {
    const storage = memoryStorage();
    const ok = respond(release('v1.1.0'));
    await checkForUpdate({}, environment(storage, ok.fetchFake));
    clock += 48 * HOUR;
    const down = respond({ message: 'rate limited' }, 403);
    assert.equal((await checkForUpdate({}, environment(storage, down.fetchFake))).version, '1.1.0', 'keeps the stored answer');
    assert.equal(down.calls.length, 1);
    const offline = async () => { throw new TypeError('Failed to fetch'); };
    assert.equal((await checkForUpdate({}, environment(storage, offline))).version, '1.1.0');
    const fresh = memoryStorage();
    assert.equal(await checkForUpdate({}, environment(fresh, offline)), null);
    const garbage = respond({ tag_name: 7 });
    assert.equal(await checkForUpdate({ force: true }, environment(memoryStorage(), garbage.fetchFake)), null);
  }

  // Storage that throws (private mode) is tolerated.
  {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
    const { fetchFake } = respond(release('v1.1.0'));
    assert.equal((await checkForUpdate({}, environment(broken, fetchFake))).version, '1.1.0');
  }

  console.log('PASS: update check compares versions, asks GitHub at most daily, accepts only this repository\'s release links, honours the off switch and survives failures.');
} finally {
  await server.close();
}
