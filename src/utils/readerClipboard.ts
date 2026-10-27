import { Capacitor, registerPlugin } from '@capacitor/core';

interface ReaderClipboardPlugin {
  readText(): Promise<{ text: string }>;
  writeText(options: { text: string }): Promise<void>;
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

export const writeClipboardText = async (text: string): Promise<void> => {
  if (Capacitor.isNativePlatform()) {
    await ReaderClipboard.writeText({ text });
    return;
  }
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard access is unavailable.');
  }
  await navigator.clipboard.writeText(text);
};
