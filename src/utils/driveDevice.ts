import { mapPageToLayout } from './readingPosition';

const DEVICE_ID_KEY = 'yomisuba_device_id';

/** A random identifier of this installation, kept for good. */
export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;
  } catch {
    // Without storage the identifier only lives for this session.
  }
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  try {
    localStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    // See above.
  }
  return id;
}

/** A name a person recognises: the phone model on Android, the system and browser elsewhere. */
export function describeDevice(userAgent: string): string {
  // "(Linux; Android 14; Pixel 7 Build/UQ1A; wv)": the model follows the Android version.
  const parts = /\(([^)]*Android[^)]*)\)/.exec(userAgent)?.[1].split(';').map((part) => part.trim());
  if (parts) {
    const after = parts[parts.findIndex((part) => part.startsWith('Android')) + 1] ?? '';
    const model = after.replace(/\s*Build\/.*$/, '').trim();
    // Browsers that hide the model report it as "K".
    return model && model !== 'K' && !/^wv$/i.test(model) ? `Android · ${model}` : 'Android';
  }
  if (/iPhone|iPad|iPod/.test(userAgent)) return /iPad/.test(userAgent) ? 'iPad' : 'iPhone';
  const system = /Windows/.test(userAgent) ? 'Windows'
    : /Mac OS X|Macintosh/.test(userAgent) ? 'macOS'
      : /CrOS/.test(userAgent) ? 'ChromeOS'
        : /Linux/.test(userAgent) ? 'Linux'
          : '';
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /Firefox\//.test(userAgent) ? 'Firefox'
      : /Chrome\//.test(userAgent) ? 'Chrome'
        : /Safari\//.test(userAgent) ? 'Safari'
          : '';
  return [system, browser].filter(Boolean).join(' · ') || '?';
}

export interface BookPosition {
  spineIndex: number;
  page: number;
  pageCount?: number;
}

/**
 * Where a position falls in the whole book, as page `page` of `total`, using the chapter page counts
 * of one layout (a position saved with another layout is mapped onto it). Null without those counts.
 */
export function bookPage(position: BookPosition, chapterPageCounts: number[] | undefined): { page: number; total: number } | null {
  if (!chapterPageCounts || !chapterPageCounts.length) return null;
  const counts = chapterPageCounts.map((count) => Math.max(1, Math.round(Number(count) || 1)));
  const spine = Math.min(Math.max(0, position.spineIndex), counts.length - 1);
  const before = counts.slice(0, spine).reduce((sum, count) => sum + count, 0);
  const inChapter = Math.min(
    counts[spine] - 1,
    Math.max(0, mapPageToLayout(position.page, position.pageCount, counts[spine])),
  );
  return { page: before + inChapter + 1, total: counts.reduce((sum, count) => sum + count, 0) };
}
