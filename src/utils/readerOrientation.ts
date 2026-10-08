import { registerPlugin } from '@capacitor/core';

interface ReaderOrientationPlugin {
  setAutoRotate(options: { enabled: boolean }): Promise<void>;
}

const ReaderOrientation = registerPlugin<ReaderOrientationPlugin>('ReaderOrientation');

export const setReaderAutoRotate = (enabled: boolean): Promise<void> =>
  ReaderOrientation.setAutoRotate({ enabled });
