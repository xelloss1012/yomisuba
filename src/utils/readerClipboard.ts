import { Capacitor, registerPlugin } from '@capacitor/core';

interface ReaderClipboardPlugin {
  readText(): Promise<{ text: string }>;
}

const ReaderClipboard = registerPlugin<ReaderClipboardPlugin>('ReaderClipboard');

export const canReadClipboard = () =>
  Capacitor.isNativePlatform() ||
  (typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText));

export const readClipboardText = async (): Promise<string> => {
  if (Capacitor.isNativePlatform()) {
    const { text } = await ReaderClipboard.readText();
    return text;
  }
  if (!navigator.clipboard?.readText) {
    throw new Error('Clipboard access is unavailable.');
  }
  return navigator.clipboard.readText();
};
