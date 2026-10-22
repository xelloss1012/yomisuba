import { Capacitor, registerPlugin } from '@capacitor/core';
import { importFileAsEpub, ImportLabels, isImportable } from './importFile';
import { importUrlAsEpub, UrlImportLabels } from './urlImport';
import { textToEpub, TITLE_CHARACTERS, truncate } from './textToEpub';

/** What another app shared, as the Android side reports it. */
export interface SharedPayload {
  text?: string;
  title?: string;
  fileName?: string;
  mimeType?: string;
  /** The file, in base64. */
  data?: string;
  error?: string;
}

interface ShareTargetPlugin {
  getPending(): Promise<SharedPayload>;
  addListener(event: 'shared', listener: () => void): Promise<{ remove: () => Promise<void> }>;
}

const ShareTarget = registerPlugin<ShareTargetPlugin>('ShareTarget');

const WEB_ADDRESS = /^https?:\/\/\S+$/i;

/** The address in a shared text when that is all it is (apps often add a title before it). */
export function sharedAddress(text: string): string | null {
  const trimmed = text.trim();
  if (WEB_ADDRESS.test(trimmed)) return trimmed;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  return lines.length > 1 && lines.length <= 3 && last && WEB_ADDRESS.test(last) ? last : null;
}

const fromBase64 = (data: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(data);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export type SharedLabels = ImportLabels & UrlImportLabels & { pastedAuthor: string };

/** What was shared as a book that the reader opens: a page by its address, a file, or the text itself. */
export async function sharedToBook(payload: SharedPayload, labels: SharedLabels): Promise<File> {
  if (payload.data !== undefined) {
    const file = new File([fromBase64(payload.data)], payload.fileName || 'shared', { type: payload.mimeType || '' });
    if (!isImportable(file)) throw new Error('unsupported');
    return importFileAsEpub(file, labels);
  }
  const text = (payload.text ?? '').trim();
  if (!text) throw new Error('empty');
  const address = sharedAddress(text);
  if (address) return importUrlAsEpub(address, labels);
  const title = payload.title?.trim() || truncate(text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? '', TITLE_CHARACTERS);
  const converted = await textToEpub(text, { title, author: labels.pastedAuthor });
  return new File([converted.blob], `${converted.title}.epub`, { type: 'application/epub+zip' });
}

/** Calls `onShared` for what other apps share, including what was shared to open the app. Returns how to stop. */
export function watchSharedContent(onShared: (payload: SharedPayload) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  let stopped = false;
  const pickUp = async () => {
    try {
      const payload = await ShareTarget.getPending();
      if (!stopped && Object.keys(payload).length > 0) onShared(payload);
    } catch {
      // No share target in this build: nothing arrives.
    }
  };
  let handle: { remove: () => Promise<void> } | undefined;
  void ShareTarget.addListener('shared', () => { void pickUp(); }).then((added) => {
    if (stopped) void added.remove();
    else handle = added;
  }).catch(() => undefined);
  void pickUp();
  return () => {
    stopped = true;
    if (handle) void handle.remove();
  };
}
