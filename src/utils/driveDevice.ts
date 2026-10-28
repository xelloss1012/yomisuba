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

/** The chapter page counts this device measured last for a book, from its pagination cache. */
export function latestPaginationCounts(raw: string | null): number[] | undefined {
  try {
    const store = raw ? JSON.parse(raw) as Record<string, { counts?: unknown; savedAt?: number }> : null;
    if (!store || typeof store !== 'object') return undefined;
    const valid = Object.values(store)
      .filter((entry) => Array.isArray(entry?.counts) && entry.counts.length > 0
        && entry.counts.every((count) => Number.isInteger(count) && count > 0))
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    return valid[0]?.counts as number[] | undefined;
  } catch {
    return undefined;
  }
}

export interface PositionPair {
  from: number | null;
  to: number | null;
}

/** Where this device's position and Drive's fall in each way of counting pages. */
export interface PositionComparison {
  /** Pages of this device's layout, or of Drive's when this device has not measured the book. */
  device: (PositionPair & { total: number; layout: 'here' | 'drive' }) | null;
  printed: (PositionPair & { total: number }) | null;
  percent: PositionPair;
  chapter: PositionPair & { total: number | null };
}

/**
 * Compares a position here with one in Drive. Each position is placed in the book with the layout it
 * was saved with; the pages of the device are both counted with the same layout.
 */
export function comparePositions(input: {
  local: BookPosition | null;
  localCounts?: number[];
  remote: BookPosition | null;
  remoteCounts?: number[];
  printedPages?: number;
}): PositionComparison {
  const { local, remote } = input;
  const localCounts = input.localCounts?.length ? input.localCounts : undefined;
  const remoteCounts = input.remoteCounts?.length ? input.remoteCounts : undefined;
  // How far into the book a position is, from 0 (first page) to 1 (last page).
  const progress = (position: BookPosition | null, counts: number[] | undefined) => {
    const whole = position ? bookPage(position, counts) : null;
    return whole ? { ratio: whole.total <= 1 ? 0 : (whole.page - 1) / (whole.total - 1), whole } : null;
  };
  const localProgress = progress(local, localCounts ?? remoteCounts);
  const remoteProgress = progress(remote, remoteCounts ?? localCounts);
  const percent = (value: typeof localProgress) => (value ? Math.round((value.whole.page / value.whole.total) * 100) : null);

  const layout = localCounts ?? remoteCounts;
  const device = layout
    ? {
      from: local ? bookPage(local, layout)?.page ?? null : null,
      to: remote ? bookPage(remote, layout)?.page ?? null : null,
      total: layout.reduce((sum, count) => sum + Math.max(1, Math.round(count)), 0),
      layout: localCounts ? 'here' as const : 'drive' as const,
    }
    : null;

  const printedTotal = input.printedPages && input.printedPages > 0 ? Math.round(input.printedPages) : 0;
  const printedPage = (value: typeof localProgress) => (value
    ? Math.max(1, Math.min(printedTotal, Math.round(value.ratio * (printedTotal - 1)) + 1))
    : null);
  const printed = printedTotal ? { from: printedPage(localProgress), to: printedPage(remoteProgress), total: printedTotal } : null;

  return {
    device,
    printed,
    percent: { from: percent(localProgress), to: percent(remoteProgress) },
    chapter: {
      from: local ? local.spineIndex + 1 : null,
      to: remote ? remote.spineIndex + 1 : null,
      total: layout ? layout.length : null,
    },
  };
}
