import { Capacitor, registerPlugin } from '@capacitor/core';

interface ReaderFullscreenPlugin {
  setEnabled(options: { enabled: boolean }): Promise<void>;
}

const ReaderFullscreen = registerPlugin<ReaderFullscreenPlugin>('ReaderFullscreen');

export const setReaderFullscreen = async (enabled: boolean): Promise<void> => {
  if (Capacitor.isNativePlatform()) {
    await ReaderFullscreen.setEnabled({ enabled });
    return;
  }

  if (enabled) {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } else if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
};
