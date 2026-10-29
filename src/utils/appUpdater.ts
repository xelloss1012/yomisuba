import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

interface AppUpdaterPlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  /** Opens the system setting that lets the app install apps; answers whether it was allowed. */
  openInstallSettings(): Promise<{ allowed: boolean }>;
  /** Downloads the APK and opens Android's installer with it (Android asks the reader to confirm). */
  downloadAndInstall(options: { url: string }): Promise<void>;
  addListener(
    event: 'downloadProgress',
    listener: (progress: { received: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

/** Only the Android app installs its own updates; elsewhere the APK is a download link. */
export const canInstallInApp = (): boolean => Capacitor.getPlatform() === 'android';

export const canInstallPackages = async (): Promise<boolean> => (await AppUpdater.canInstall()).allowed;

export const allowInstallingPackages = async (): Promise<boolean> => (await AppUpdater.openInstallSettings()).allowed;

/** Downloads the update, telling how much has arrived (0–1, or null while the size is unknown), and installs it. */
export const downloadAndInstallUpdate = async (url: string, onProgress: (fraction: number | null) => void): Promise<void> => {
  const listener = await AppUpdater.addListener('downloadProgress', ({ received, total }) => {
    onProgress(total > 0 ? Math.min(1, received / total) : null);
  });
  try {
    await AppUpdater.downloadAndInstall({ url });
  } finally {
    void listener.remove();
  }
};
