import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { NativeFiles } from './nativeStorage';

// The app's private folder: no permission is needed, other apps cannot read it, and the system does
// not clear it when the WebView's own storage is cleared.
const directory = Directory.Data;

/** The real file port, over Capacitor's Filesystem plugin. Only meant for the native app. */
export const nativeFiles: NativeFiles = {
  async writeBase64(path, data, append) {
    if (append) await Filesystem.appendFile({ path, data, directory });
    else await Filesystem.writeFile({ path, data, directory, recursive: true });
  },

  async writeText(path, text) {
    await Filesystem.writeFile({ path, data: text, directory, encoding: Encoding.UTF8, recursive: true });
  },

  async readText(path) {
    try {
      const { data } = await Filesystem.readFile({ path, directory, encoding: Encoding.UTF8 });
      return typeof data === 'string' ? data : await data.text();
    } catch {
      return null;
    }
  },

  async readBlob(path, type) {
    try {
      await Filesystem.stat({ path, directory });
    } catch {
      return null;
    }
    try {
      // The WebView reads a file of the app straight from disk: no base64 detour through the bridge.
      const { uri } = await Filesystem.getUri({ path, directory });
      const response = await fetch(Capacitor.convertFileSrc(uri));
      if (response.ok) return new Blob([await response.arrayBuffer()], { type });
    } catch {
      // falls through to the plugin's own read
    }
    try {
      const { data } = await Filesystem.readFile({ path, directory });
      if (typeof data !== 'string') return data;
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return new Blob([bytes], { type });
    } catch {
      return null;
    }
  },

  async list(path) {
    try {
      const { files } = await Filesystem.readdir({ path, directory });
      return files.filter((file) => file.type === 'file').map((file) => ({ name: file.name, size: file.size }));
    } catch {
      return [];
    }
  },

  async size(path) {
    try {
      return (await Filesystem.stat({ path, directory })).size;
    } catch {
      return null;
    }
  },

  async remove(path) {
    try {
      await Filesystem.deleteFile({ path, directory });
    } catch {
      // already gone
    }
  },
};
