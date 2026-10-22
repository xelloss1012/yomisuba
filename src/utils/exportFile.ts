import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** A file name the systems accept, made from a title: no path characters, not too long, with its extension. */
export function exportFileName(title: string, suffix: string, extension: string): string {
  const clean = (text: string) => text.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const base = clean(`${clean(title) || 'Yomisuba'} ${clean(suffix)}`).slice(0, 80).trim();
  return `${base}.${extension.replace(/^\./, '')}`;
}

export interface SavedFile {
  /** 'downloaded' in the browser; 'shared' in the app, where the share sheet lets the reader pick where it goes. */
  how: 'downloaded' | 'shared';
}

/**
 * Hands a text file to the reader. In the browser it is downloaded; in the Android app it is written to
 * the app's cache and offered to the share sheet (Drive, Files, mail, another app…): the app asks for no
 * storage permission, and the file does not stay on the device unless the reader sends it somewhere.
 */
export async function saveTextFile(
  filename: string,
  content: string,
  mimeType: string,
  shareTitle: string,
): Promise<SavedFile> {
  if (Capacitor.isNativePlatform()) {
    const path = `exports/${filename}`;
    await Filesystem.writeFile({ path, data: content, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Share.share({ title: filename, dialogTitle: shareTitle, files: [uri] });
    return { how: 'shared' };
  }
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked later: some browsers start the download after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { how: 'downloaded' };
}
