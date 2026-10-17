/**
 * Tells the Android app when a newer release is published on GitHub. It only
 * looks: the reader is sent to the release's APK to download and install it, and
 * Android asks for confirmation as it does for any APK (and only accepts it if it
 * is signed with the same key as the installed app). The web version needs none of
 * this, since every push to main publishes it again.
 *
 * It asks GitHub's public API at most every few hours, and the reader can turn it off.
 */
export const APP_VERSION: string = __APP_VERSION__;

const REPOSITORY = 'xelloss1012/yomisuba';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASES_PREFIX = `https://github.com/${REPOSITORY}/releases/`;
const APK_NAME = 'yomisuba.apk';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const CHECK_KEY = 'yomisuba_update_check_v1';
const ENABLED_KEY = 'yomisuba_update_check_enabled';
const DISMISSED_KEY = 'yomisuba_update_dismissed';

export interface AvailableUpdate {
  version: string;
  releaseUrl: string;
  /** Direct link to the APK; without it the release page is opened instead. */
  apkUrl: string | null;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface UpdateCheckEnvironment {
  currentVersion?: string;
  now?: () => number;
  fetch?: typeof fetch;
  storage?: StorageLike | null;
}

const parts = (version: string): number[] | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

/** Whether `candidate` is a higher version than `current`; false when either is not a x.y.z version. */
export const isNewerVersion = (candidate: string, current: string): boolean => {
  const next = parts(candidate);
  const installed = parts(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
};

/**
 * Reads GitHub's "latest release" answer. Links must stay inside this repository's
 * releases, so a changed answer cannot send the reader elsewhere.
 */
export function parseRelease(data: unknown): AvailableUpdate | null {
  if (typeof data !== 'object' || data === null) return null;
  const release = data as { tag_name?: unknown; html_url?: unknown; assets?: unknown };
  if (typeof release.tag_name !== 'string' || !parts(release.tag_name)) return null;
  if (typeof release.html_url !== 'string' || !release.html_url.startsWith(RELEASES_PREFIX)) return null;
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item): item is { name: string; browser_download_url: string } =>
      typeof item === 'object' && item !== null && (item as { name?: unknown }).name === APK_NAME
      && typeof (item as { browser_download_url?: unknown }).browser_download_url === 'string')
    : undefined;
  return {
    version: release.tag_name.replace(/^v/, ''),
    releaseUrl: release.html_url,
    apkUrl: asset && asset.browser_download_url.startsWith(`${RELEASES_PREFIX}download/`) ? asset.browser_download_url : null,
  };
}

const defaultStorage = (): StorageLike | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const read = (storage: StorageLike | null, key: string): string | null => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const write = (storage: StorageLike | null, key: string, value: string | null) => {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Private mode or full storage: the preference just does not persist.
  }
};

export const isUpdateCheckEnabled = (storage: StorageLike | null = defaultStorage()): boolean =>
  read(storage, ENABLED_KEY) !== 'off';

export const setUpdateCheckEnabled = (enabled: boolean, storage: StorageLike | null = defaultStorage()) =>
  write(storage, ENABLED_KEY, enabled ? null : 'off');

export const isUpdateDismissed = (version: string, storage: StorageLike | null = defaultStorage()): boolean =>
  read(storage, DISMISSED_KEY) === version;

/** "Not now" hides that version's notice; a later release shows it again. */
export const dismissUpdate = (version: string, storage: StorageLike | null = defaultStorage()) =>
  write(storage, DISMISSED_KEY, version);

/** An update read back from storage, held to the same rules as one read from GitHub. */
const asUpdate = (value: unknown): AvailableUpdate | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { version, releaseUrl, apkUrl } = value as Record<string, unknown>;
  if (typeof version !== 'string' || !parts(version)) return null;
  if (typeof releaseUrl !== 'string' || !releaseUrl.startsWith(RELEASES_PREFIX)) return null;
  return {
    version,
    releaseUrl,
    apkUrl: typeof apkUrl === 'string' && apkUrl.startsWith(`${RELEASES_PREFIX}download/`) ? apkUrl : null,
  };
};

interface StoredCheck {
  checkedAt: number;
  release: AvailableUpdate | null;
}

const readStoredCheck = (storage: StorageLike | null): StoredCheck | null => {
  const raw = read(storage, CHECK_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as { checkedAt?: unknown; release?: unknown };
    if (typeof stored.checkedAt !== 'number') return null;
    return { checkedAt: stored.checkedAt, release: asUpdate(stored.release) };
  } catch {
    return null;
  }
};

/**
 * The newer release, if there is one. Asks GitHub only when the last answer is
 * a few hours old (or `force`); between checks it answers from the stored one. A
 * failed request keeps the stored answer and is tried again next time, except when
 * `force` is set: the reader asked, so the failure is reported.
 */
export async function checkForUpdate(
  { force = false }: { force?: boolean } = {},
  environment: UpdateCheckEnvironment = {},
): Promise<AvailableUpdate | null> {
  const currentVersion = environment.currentVersion ?? APP_VERSION;
  const now = (environment.now ?? Date.now)();
  const storage = environment.storage === undefined ? defaultStorage() : environment.storage;
  const stored = readStoredCheck(storage);
  const newerThanInstalled = (release: AvailableUpdate | null) =>
    release && isNewerVersion(release.version, currentVersion) ? release : null;

  if (!isUpdateCheckEnabled(storage)) return null;
  if (!force && stored && now - stored.checkedAt >= 0 && now - stored.checkedAt < CHECK_INTERVAL_MS) {
    return newerThanInstalled(stored.release);
  }
  try {
    const doFetch = environment.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await doFetch(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = parseRelease(await response.json());
    write(storage, CHECK_KEY, JSON.stringify({ checkedAt: now, release } satisfies StoredCheck));
    return newerThanInstalled(release);
  } catch (error) {
    if (force) throw error;
    return newerThanInstalled(stored?.release ?? null);
  }
}
