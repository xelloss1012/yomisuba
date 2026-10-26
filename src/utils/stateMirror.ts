import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { nativeFiles } from './nativeFiles';
import { createStateMirror, isMirroredKey } from './nativeStorage';

const SAVE_DELAY_MS = 2000;

/**
 * In the Android app: brings back the reading data if the WebView's storage was cleared, then keeps a copy
 * of it in the app's private files up to date. Never throws: the app starts whatever happens here.
 */
export async function startStateMirror(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const mirror = createStateMirror(nativeFiles, localStorage);
    const restored = await mirror.restoreIfCleared();
    if (restored > 0) {
      console.info(`Restored ${restored} saved entries to localStorage from private files.`);
    }

    let timer: number | undefined;
    const pendingDeletedKeys = new Set<string>();

    const save = () => {
      window.clearTimeout(timer);
      timer = undefined;
      const keysToDelete = new Set(pendingDeletedKeys);
      pendingDeletedKeys.clear();
      mirror.snapshot(keysToDelete).catch((error) => console.warn('Could not copy the reading data:', error));
    };

    const schedule = (deletedKey?: string) => {
      if (deletedKey) pendingDeletedKeys.add(deletedKey);
      if (timer === undefined) timer = window.setTimeout(save, SAVE_DELAY_MS);
    };

    const { setItem, removeItem } = Storage.prototype;
    Storage.prototype.setItem = function patchedSetItem(this: Storage, key: string, value: string) {
      setItem.call(this, key, value);
      if ((this === localStorage || (typeof window !== 'undefined' && this === window.localStorage)) && isMirroredKey(key)) {
        schedule();
      }
    };
    Storage.prototype.removeItem = function patchedRemoveItem(this: Storage, key: string) {
      removeItem.call(this, key);
      if ((this === localStorage || (typeof window !== 'undefined' && this === window.localStorage)) && isMirroredKey(key)) {
        schedule(key);
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') save();
    });
    window.addEventListener('pagehide', () => save());
    try {
      void CapacitorApp.addListener('appStateChange', (state) => {
        if (!state.isActive) save();
      });
    } catch {
      // Not running in Capacitor App context
    }

    // Initial safe merge save to ensure state.json and backup exist
    save();
  } catch (error) {
    console.warn('Could not start the reading data copy:', error);
  }
}
