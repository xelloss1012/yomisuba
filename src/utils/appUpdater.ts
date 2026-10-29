import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

interface AppUpdaterPlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  /** Opens the system setting that lets the app install apps; answers whether it was allowed. */
  openInstallSettings(): Promise<{ allowed: boolean }>;
  /** Downloads the APK and opens Android's installer with it (Android asks the reader to confirm). */
  downloadAndInstall(options: { url: string; id: string }): Promise<void>;
  addListener(
    event: 'downloadProgress',
    listener: (progress: { id: string; received: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

/** Only the Android app installs its own updates; elsewhere the APK is a download link. */
export const canInstallInApp = (): boolean => Capacitor.getPlatform() === 'android';

export const canInstallPackages = async (): Promise<boolean> => (await AppUpdater.canInstall()).allowed;

export const allowInstallingPackages = async (): Promise<boolean> => (await AppUpdater.openInstallSettings()).allowed;

/** Downloads the update, telling how much has arrived (0–1, or null while the size is unknown), and installs it. */
const downloadAndInstallUpdate = async (url: string, onProgress: (fraction: number | null) => void): Promise<void> => {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let shown = 0;
  const listener = await AppUpdater.addListener('downloadProgress', (progress) => {
    // Only this download's news, and never backwards.
    if (progress.id !== id) return;
    if (progress.total <= 0) {
      onProgress(null);
      return;
    }
    shown = Math.max(shown, Math.min(1, progress.received / progress.total));
    onProgress(shown);
  });
  try {
    await AppUpdater.downloadAndInstall({ url, id });
  } finally {
    void listener.remove();
  }
};

export type UpdateInstallState =
  | { kind: 'idle' }
  | { kind: 'permission' }
  | { kind: 'downloading'; fraction: number | null }
  | { kind: 'installing' }
  | { kind: 'failed'; message: string };

// One update at a time for the whole app: the notice and "Check for updates" can both be on screen, and
// each started its own download into the same file.
let state: UpdateInstallState = { kind: 'idle' };
const subscribers = new Set<() => void>();
const setState = (next: UpdateInstallState) => {
  state = next;
  subscribers.forEach((notify) => notify());
};

export const subscribeUpdateInstall = (notify: () => void): (() => void) => {
  subscribers.add(notify);
  return () => { subscribers.delete(notify); };
};

export const getUpdateInstallState = (): UpdateInstallState => state;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Downloads and installs the update, first asking to be allowed to install apps if need be. */
export const installUpdate = async (url: string): Promise<void> => {
  if (state.kind === 'downloading') return;
  try {
    if (!(await canInstallPackages())) {
      setState({ kind: 'permission' });
      return;
    }
    setState({ kind: 'downloading', fraction: 0 });
    await downloadAndInstallUpdate(url, (fraction) => setState({ kind: 'downloading', fraction }));
    setState({ kind: 'installing' });
  } catch (error) {
    setState({ kind: 'failed', message: messageOf(error) });
  }
};

/** Opens the setting to allow installing apps and, once allowed, goes on with the update. */
export const allowAndInstallUpdate = async (url: string): Promise<void> => {
  try {
    if (await allowInstallingPackages()) await installUpdate(url);
  } catch (error) {
    setState({ kind: 'failed', message: messageOf(error) });
  }
};
