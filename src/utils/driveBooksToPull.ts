/**
 * Which books still have to take their reading data (position, bookmarks, notes...) from Google Drive.
 *
 * A book opens with the data this device keeps, without waiting for Drive: Drive only holds something
 * newer when another device has written there, and then the person is asked whether to load it. Once
 * they load it, every book takes Drive's data the next time it opens here (the book being read takes it
 * at once). This remembers which ones have, across launches.
 */
const STORAGE_KEY = 'yomisuba_drive_books_to_pull';

interface BooksToPull {
  /** Since when Drive has data from another device that this device loaded. */
  since: number;
  /** The books that have taken it already. */
  pulled: string[];
}

const read = (): BooksToPull | null => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as BooksToPull | null;
    return value && typeof value.since === 'number' && Array.isArray(value.pulled) ? value : null;
  } catch {
    return null;
  }
};

const write = (value: BooksToPull) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // At worst a book takes Drive's data once more.
  }
};

/** Data from another device was loaded: every book takes Drive's data when it next opens. */
export function markAllBooksToPull(): void {
  write({ since: Date.now(), pulled: [] });
}

/**
 * Whether a book has still to take Drive's data. With nothing recorded (the first launch of a version
 * that keeps this record) every book takes it once, as every opening did before.
 */
export function bookNeedsPull(bookKey: string): boolean {
  const value = read();
  return !value || !value.pulled.includes(bookKey);
}

/** The book took Drive's data. */
export function markBookPulled(bookKey: string): void {
  const value = read() ?? { since: Date.now(), pulled: [] };
  if (value.pulled.includes(bookKey)) return;
  write({ ...value, pulled: [...value.pulled, bookKey] });
}
