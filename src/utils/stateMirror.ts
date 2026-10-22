import { Capacitor } from '@capacitor/core';
import { nativeFiles } from './nativeFiles';
import { createStateMirror, isMirroredKey } from './nativeStorage';

// Always written by the app (settings are saved on the first render), so it is gone only when the storage is.
const SENTINEL_KEY = 'yomisuba_settings_v1';
const SAVE_DELAY_MS = 3000;

/**
 * In the Android app: brings back the reading data if the WebView's storage was cleared, then keeps a copy
 * of it in the app's private files up to date. Never throws: the app starts whatever happens here.
 */
export async function startStateMirror(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const mirror = createStateMirror(nativeFiles, localStorage);
    const restored = await mirror.restoreIfCleared(SENTINEL_KEY);
    if (restored > 0) console.info(`Restored ${restored} saved entries after the WebView storage was cleared.`);

    let timer: number | undefined;
    const save = () => {
      window.clearTimeout(timer);
      timer = undefined;
      mirror.snapshot().catch((error) => console.warn('Could not copy the reading data:', error));
    };
    const schedule = () => {
      if (timer === undefined) timer = window.setTimeout(save, SAVE_DELAY_MS);
    };

    const { setItem, removeItem } = Storage.prototype;
    Storage.prototype.setItem = function patchedSetItem(this: Storage, key: string, value: string) {
      setItem.call(this, key, value);
      if (this === localStorage && isMirroredKey(key)) schedule();
    };
    Storage.prototype.removeItem = function patchedRemoveItem(this: Storage, key: string) {
      removeItem.call(this, key);
      if (this === localStorage && isMirroredKey(key)) schedule();
    };
    // The app can be closed any time: what is pending is written when it goes to the background.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer !== undefined) save(); });
    window.addEventListener('pagehide', () => { if (timer !== undefined) save(); });
    schedule();
  } catch (error) {
    console.warn('Could not start the reading data copy:', error);
  }
}
