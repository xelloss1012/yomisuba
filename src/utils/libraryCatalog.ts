/**
 * The free book library: public-domain Japanese books, listed in a catalog and
 * downloaded one by one when the reader asks for them. Everything lives in the
 * public yomisuba-library repository (built by scripts/build-library.mjs, which
 * also checks that every work is in the public domain); nothing is bundled with
 * the app. A downloaded book is opened like any imported EPUB, so it ends up in
 * the local library and follows the usual rules (it is not copied to Drive).
 */
import type { UiLanguage } from './i18n';

const configuredBaseUrl = import.meta.env.VITE_LIBRARY_BASE_URL;
export const LIBRARY_BASE_URL = configuredBaseUrl
  ? configuredBaseUrl.replace(/\/?$/, '/')
  : 'https://raw.githubusercontent.com/xelloss1012/yomisuba-library/main/';
export const LIBRARY_REPOSITORY_URL = 'https://github.com/xelloss1012/yomisuba-library';
export const LIBRARY_ATTRIBUTION_URL = `${LIBRARY_REPOSITORY_URL}/blob/main/ATTRIBUTION.md`;

/** Catalog formats this version of the app understands (2 added licences other than public domain). */
const SUPPORTED_SCHEMAS = [1, 2];

export const LIBRARY_GENRES = [
  'fantasy', 'scifi', 'mystery', 'horror', 'romance', 'historical', 'humor', 'drama', 'children', 'nonfiction',
] as const;
export type LibraryGenre = typeof LIBRARY_GENRES[number];

/** 1 = most accessible … 5 = hardest, estimated from the app's JLPT word lists (not an official level). */
export type LibraryDifficulty = 1 | 2 | 3 | 4 | 5;

export interface LibraryBook {
  id: string;
  slug: string;
  title: string;
  titleReading: string;
  author: string;
  genres: LibraryGenre[];
  description: Partial<Record<UiLanguage, string>>;
  /** Path inside the library repository. */
  file: string;
  cover: string;
  bytes: number;
  /** Hex SHA-256 of the EPUB, checked after downloading. */
  sha256: string;
  characters: number;
  /** Paperback pages, roughly: an EPUB has no fixed pages. */
  pages: number;
  difficulty: LibraryDifficulty;
  source: { name: string; url: string };
  license: LibraryLicense;
}

/**
 * Public domain, or a Creative Commons licence that lets the work be adapted and
 * redistributed with credit (BY, BY-SA); the build script accepts nothing else.
 */
export type LibraryLicenseId = 'public-domain' | 'cc-by' | 'cc-by-sa';

export interface LibraryLicense {
  id: LibraryLicenseId;
  /** "CC BY 4.0"; empty for public domain, which the interface words itself. */
  name: string;
  /** Terms of a Creative Commons licence. */
  url: string | null;
  creditRole: 'translator' | 'author' | null;
  creditName: string;
  authorDied: string;
}

const LICENSE_IDS: LibraryLicenseId[] = ['public-domain', 'cc-by', 'cc-by-sa'];
const CC_TERMS_PREFIX = 'https://creativecommons.org/licenses/';

const SAFE_PATH = /^(books|covers)\/[a-z0-9-]+\.(epub|png)$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * Reads a catalog the repository published. Entries that do not have the expected
 * shape are dropped instead of failing the whole list, and paths and links are
 * restricted so a wrong entry cannot point the app anywhere else.
 */
export function parseLibraryCatalog(data: unknown): LibraryBook[] {
  if (!isRecord(data) || !Array.isArray(data.books)) throw new Error('El catálogo no tiene un formato válido.');
  if (typeof data.schema !== 'number' || !SUPPORTED_SCHEMAS.includes(data.schema)) {
    throw new Error('El catálogo necesita una versión más reciente de la aplicación.');
  }
  const books: LibraryBook[] = [];
  for (const raw of data.books) {
    if (!isRecord(raw) || !isRecord(raw.source) || !isRecord(raw.license) || !isRecord(raw.level) || !isRecord(raw.description)) continue;
    const genres = Array.isArray(raw.genres)
      ? raw.genres.filter((genre): genre is LibraryGenre => LIBRARY_GENRES.includes(genre as LibraryGenre))
      : [];
    const score = raw.level.score;
    const license = raw.license; // narrowed here; a closure below would lose that
    const licenseId = LICENSE_IDS.find((id) => id === license.id);
    const licenseUrl = typeof license.url === 'string' && license.url.startsWith(CC_TERMS_PREFIX) ? license.url : null;
    if (
      !isText(raw.id) || !isText(raw.slug) || !isText(raw.title) || !isText(raw.author)
      || !isText(raw.file) || !SAFE_PATH.test(raw.file) || !raw.file.endsWith('.epub')
      || !isText(raw.cover) || !SAFE_PATH.test(raw.cover) || !raw.cover.endsWith('.png')
      || !isText(raw.sha256) || !/^[0-9a-f]{64}$/.test(raw.sha256)
      || !isCount(raw.bytes) || !isCount(raw.characters) || !isCount(raw.pages)
      || !isText(raw.source.url) || !raw.source.url.startsWith('https://')
      || typeof score !== 'number' || ![1, 2, 3, 4, 5].includes(score)
      || genres.length === 0
      // A licence the app does not know, or a Creative Commons one without its name and terms, is not shown.
      || !licenseId || (licenseId !== 'public-domain' && (!isText(license.name) || !licenseUrl))
    ) continue;
    const description: LibraryBook['description'] = {};
    for (const [language, text] of Object.entries(raw.description)) {
      if (isText(text)) description[language as UiLanguage] = text;
    }
    books.push({
      id: raw.id,
      slug: raw.slug,
      title: raw.title,
      titleReading: typeof raw.titleReading === 'string' ? raw.titleReading : '',
      author: raw.author,
      genres,
      description,
      file: raw.file,
      cover: raw.cover,
      bytes: raw.bytes,
      sha256: raw.sha256,
      characters: raw.characters,
      pages: raw.pages,
      difficulty: score as LibraryDifficulty,
      source: { name: isText(raw.source.name) ? raw.source.name : 'Aozora Bunko', url: raw.source.url },
      license: {
        id: licenseId,
        name: licenseId === 'public-domain' ? '' : String(license.name),
        url: licenseId === 'public-domain' ? null : licenseUrl,
        creditRole: license.creditRole === 'translator' || license.creditRole === 'author' ? license.creditRole : null,
        creditName: isText(license.creditName) ? license.creditName : '',
        authorDied: isText(license.authorDied) ? license.authorDied : '',
      },
    });
  }
  return books;
}

export const libraryFileUrl = (path: string) => `${LIBRARY_BASE_URL}${path}`;

export async function fetchLibraryCatalog(signal?: AbortSignal): Promise<LibraryBook[]> {
  const response = await fetch(libraryFileUrl('catalog.json'), { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseLibraryCatalog(await response.json());
}

/** Description in the interface language, in English when there is none, then Japanese. */
export const libraryDescription = (book: LibraryBook, language: UiLanguage): string =>
  book.description[language] || book.description.en || book.description.ja || '';

/** Genres of the catalog, in the library's order, that at least one book has. */
export const genresInCatalog = (books: LibraryBook[]): LibraryGenre[] =>
  LIBRARY_GENRES.filter((genre) => books.some((book) => book.genres.includes(genre)));

const sha256Hex = async (blob: Blob): Promise<string | null> => {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** Downloads a book and checks it is the file the catalog describes. */
export async function downloadLibraryBook(
  book: LibraryBook,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<File> {
  const response = await fetch(libraryFileUrl(book.file), { signal });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || book.bytes;
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  onProgress(loaded, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, Math.max(total, loaded));
  }
  const blob = new Blob(chunks, { type: 'application/epub+zip' });
  // A truncated or altered file never reaches the reader.
  const digest = await sha256Hex(blob); // null where Web Crypto is unavailable (insecure origin)
  if (blob.size !== book.bytes || (digest !== null && digest !== book.sha256)) {
    throw new Error('El archivo descargado no coincide con el catálogo.');
  }
  return new File([blob], `${book.slug}.epub`, { type: 'application/epub+zip' });
}
