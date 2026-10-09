import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { ReaderSettingsState } from '../types/epub';
import { RecentBook, saveRecentBook } from './recentBooks';
import { extractEpubCoverBlob } from './epubParser';
import { TranslationFavorite } from './translationFavorites';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_SESSION_EXPECTED_KEY = 'ereader_google_drive_session_expected';
const DRIVE_FOLDER_NAME = '.ereader';
const READER_FOLDER_NAME = DRIVE_FOLDER_NAME;
const BOOKS_FOLDER_NAME = 'books';
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const SETTINGS_FILE_NAME = 'EReader settings.json';
const SETTINGS_FILE_TYPE = 'application/json';
const BOOK_STATE_PREFIX = 'EReader reading data - ';
const MAX_BOOK_SIZE = 100 * 1024 * 1024;
const COVER_THUMBNAIL_MAX_WIDTH = 160;
const COVER_THUMBNAIL_QUALITY = 0.72;
const MAX_COVER_METADATA_LENGTH = 32 * 1024;

interface DriveFile {
  id: string;
  name: string;
  description?: string;
  size?: string;
  modifiedTime?: string;
  mimeType?: string;
}

export interface GoogleDriveSession {
  accessToken: string;
  email: string;
  name: string;
}

export interface GoogleDriveBook {
  id: string;
  name: string;
  title: string;
  creator: string;
  size: number;
  modifiedTime: string | null;
  coverDataUrl?: string;
}

export interface ReaderBookBackup {
  bookKey: string;
  title: string;
  creator: string;
  position: { spineIndex: number; page: number; pageCount?: number; textOffset?: number };
  bookmarks: Array<{ spineIndex: number; page: number; pageCount?: number; textOffset?: number }>;
  annotations: Array<{ id: string; spineIndex: number; quote: string; prefix: string; suffix: string }>;
  translationHistory: Array<{
    id: string;
    queriedAt: number;
    query: string;
    kind: 'dictionary' | 'translation' | 'ai';
    provider?: string;
    response: string;
  }>;
  favorites: TranslationFavorite[];
}

let initializePromise: Promise<void> | null = null;
const readerBackupQueues = new Map<string, Promise<void>>();
const driveFolderCache = new Map<string, Promise<string>>();
export const googleDriveConfigured = Boolean(import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID);
const DRIVE_SCOPES = ['email', 'profile', DRIVE_FILE_SCOPE, DRIVE_READONLY_SCOPE];

function initializeGoogleLogin(): Promise<void> {
  const webClientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) throw new Error('Falta configurar VITE_GOOGLE_WEB_CLIENT_ID.');
  if (!initializePromise) {
    initializePromise = SocialLogin.initialize({
      google: { webClientId, mode: 'online' },
    }).catch((error: unknown) => {
      initializePromise = null;
      throw error;
    });
  }
  return initializePromise;
}

export async function signInToGoogleDrive(): Promise<GoogleDriveSession> {
  await initializeGoogleLogin();
  const result = await SocialLogin.login({
    provider: 'google',
    options: { scopes: DRIVE_SCOPES },
  });
  if (result.result.responseType !== 'online') {
    throw new Error('Google devolvió una respuesta de inicio de sesión no compatible.');
  }
  const accessToken = result.result.accessToken?.token;
  if (!accessToken) {
    throw new Error('Google no concedió un token de acceso a Drive. Vuelve a iniciar sesión y acepta el permiso solicitado.');
  }
  if (!result.result.idToken) {
    throw new Error('Google no devolvió un token de identidad válido. Vuelve a iniciar sesión.');
  }
  const session = await createGoogleDriveSession(accessToken, result.result.idToken);
  localStorage.setItem(DRIVE_SESSION_EXPECTED_KEY, 'true');
  return session;
}

async function createGoogleDriveSession(accessToken: string, idToken: string): Promise<GoogleDriveSession> {
  const { claims } = await SocialLogin.decodeIdToken({ idToken });
  return {
    accessToken,
    email: typeof claims.email === 'string' ? claims.email : '',
    name: typeof claims.name === 'string' ? claims.name : '',
  };
}

export async function restoreGoogleDriveSession(): Promise<GoogleDriveSession | null> {
  await initializeGoogleLogin();
  const expectedSession = localStorage.getItem(DRIVE_SESSION_EXPECTED_KEY) === 'true';
  if (Capacitor.isNativePlatform() && expectedSession) {
    try {
      await SocialLogin.refresh({
        provider: 'google',
        options: { scopes: DRIVE_SCOPES },
      });
    } catch (error) {
      const { isLoggedIn } = await SocialLogin.isLoggedIn({ provider: 'google' });
      if (!isLoggedIn) {
        localStorage.removeItem(DRIVE_SESSION_EXPECTED_KEY);
        throw new Error('La sesión de Google ha caducado o se ha revocado. Vuelve a conectar la cuenta.');
      }
      throw error;
    }
  }
  const { isLoggedIn } = await SocialLogin.isLoggedIn({ provider: 'google' });
  if (!isLoggedIn) {
    if (expectedSession) localStorage.removeItem(DRIVE_SESSION_EXPECTED_KEY);
    return null;
  }

  if (Capacitor.isNativePlatform() && !expectedSession) {
    await SocialLogin.refresh({
      provider: 'google',
      options: { scopes: DRIVE_SCOPES },
    });
  }
  const authorization = await SocialLogin.getAuthorizationCode({ provider: 'google' });
  if (!authorization.accessToken || !authorization.jwt) {
    throw new Error('La sesión de Google no tiene un token válido para Drive. Vuelve a conectar la cuenta.');
  }
  const session = await createGoogleDriveSession(authorization.accessToken, authorization.jwt);
  localStorage.setItem(DRIVE_SESSION_EXPECTED_KEY, 'true');
  return session;
}

export async function refreshGoogleDriveSession(): Promise<GoogleDriveSession | null> {
  return restoreGoogleDriveSession();
}

export async function signOutGoogleDrive(): Promise<void> {
  await SocialLogin.logout({ provider: 'google' });
  localStorage.removeItem(DRIVE_SESSION_EXPECTED_KEY);
}

async function driveRequest(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new Error('La sesión de Google ha caducado. Vuelve a iniciar sesión para continuar.');
    }
    throw new Error(`Google Drive respondió ${response.status}: ${detail || response.statusText}`);
  }
  return response;
}

async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateDriveFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const cacheKey = `${accessToken}:${parentId || 'root'}:${name}`;
  const cached = driveFolderCache.get(cacheKey);
  if (cached) return cached;

  const pending = (async () => {
    const parentQuery = parentId ? `'${parentId}' in parents` : "'root' in parents";
    const query = new URLSearchParams({
      q: `name = '${name}' and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and ${parentQuery} and trashed = false`,
      spaces: 'drive',
      pageSize: '100',
      fields: 'files(id)',
    });
    const response = await driveRequest(accessToken, `https://www.googleapis.com/drive/v3/files?${query}`);
    const result = await response.json() as { files?: Array<{ id: string }> };
    if (result.files?.[0]) return result.files[0].id;

    const created = await driveRequest(accessToken, 'https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        name,
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });
    const folder = await created.json() as { id?: string };
    if (!folder.id) throw new Error(`Google Drive no devolvió el identificador de la carpeta «${name}».`);
    return folder.id;
  })();
  const promise = pending.catch((error: unknown) => {
    driveFolderCache.delete(cacheKey);
    throw error;
  });
  driveFolderCache.set(cacheKey, promise);
  return promise;
}

async function getDriveFolderId(accessToken: string): Promise<string> {
  return getOrCreateDriveFolder(accessToken, DRIVE_FOLDER_NAME);
}

async function getReaderBooksFolderId(accessToken: string): Promise<string> {
  const readerFolderId = await getOrCreateDriveFolder(accessToken, READER_FOLDER_NAME);
  return getOrCreateDriveFolder(accessToken, BOOKS_FOLDER_NAME, readerFolderId);
}

async function findFile(accessToken: string, name: string): Promise<DriveFile | null> {
  const folderId = await getDriveFolderId(accessToken);
  const query = new URLSearchParams({
    q: `name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`,
    spaces: 'drive',
    pageSize: '100',
    fields: 'files(id,name,description,size,modifiedTime)',
    orderBy: 'modifiedTime desc',
  });
  const response = await driveRequest(accessToken, `https://www.googleapis.com/drive/v3/files?${query}`);
  const result = await response.json() as { files?: DriveFile[] };
  return result.files?.[0] || null;
}

async function listBookFiles(accessToken: string): Promise<DriveFile[]> {
  const folderId = await getReaderBooksFolderId(accessToken);
  const query = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    spaces: 'drive',
    pageSize: '1000',
    fields: 'nextPageToken,files(id,name,description,size,modifiedTime,mimeType)',
    orderBy: 'name',
  });
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) query.set('pageToken', pageToken);
    const response = await driveRequest(accessToken, `https://www.googleapis.com/drive/v3/files?${query}`);
    const result = await response.json() as { nextPageToken?: string; files?: DriveFile[] };
    files.push(...(result.files || []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return files.filter((file) => file.name.toLowerCase().endsWith('.epub'));
}

async function uploadFile(
  accessToken: string,
  name: string,
  mimeType: string,
  blob: Blob,
  existing: DriveFile | null,
  description?: string,
  parentFolderId?: string,
): Promise<DriveFile> {
  const folderId = parentFolderId || await getDriveFolderId(accessToken);
  const baseUrl = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}`
    : 'https://www.googleapis.com/upload/drive/v3/files';
  const uploadQuery = new URLSearchParams({ uploadType: 'resumable', fields: 'id,name,modifiedTime' });
  const response = await driveRequest(accessToken, `${baseUrl}?${uploadQuery}`, {
    method: existing ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(blob.size),
    },
    body: JSON.stringify({
      name,
      mimeType,
      ...(!existing ? { parents: [folderId] } : {}),
      ...(description ? { description } : {}),
    }),
  });
  const uploadUrl = response.headers.get('Location');
  if (!uploadUrl) throw new Error('Google Drive no devolvió la dirección para subir el archivo.');
  const result = await driveRequest(accessToken, uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  });
  return await result.json() as DriveFile;
}

async function downloadFile(accessToken: string, file: DriveFile): Promise<Blob> {
  const response = await driveRequest(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
  );
  return response.blob();
}

export async function createCoverThumbnailDataUrl(cover: Blob): Promise<string | undefined> {
  if (typeof document === 'undefined') return undefined;
  const url = URL.createObjectURL(cover);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('No se pudo leer la imagen de portada.'));
      element.src = url;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) return undefined;
    const scale = Math.min(1, COVER_THUMBNAIL_MAX_WIDTH / width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', COVER_THUMBNAIL_QUALITY);
    return dataUrl.startsWith('data:image/') ? dataUrl : undefined;
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function getDriveFile(accessToken: string, id: string): Promise<DriveFile> {
  const query = new URLSearchParams({ fields: 'id,name,description,size,modifiedTime,mimeType' });
  const response = await driveRequest(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?${query}`,
  );
  return await response.json() as DriveFile;
}

export async function saveGoogleDriveSettings(
  accessToken: string,
  settings: ReaderSettingsState,
): Promise<string | null> {
  const file = await findFile(accessToken, SETTINGS_FILE_NAME);
  const saved = await uploadFile(
    accessToken,
    SETTINGS_FILE_NAME,
    SETTINGS_FILE_TYPE,
    new Blob([JSON.stringify({ formatVersion: 1, settings })], { type: SETTINGS_FILE_TYPE }),
    file,
  );
  return saved.modifiedTime || new Date().toISOString();
}

export async function restoreGoogleDriveSettings(accessToken: string): Promise<ReaderSettingsState> {
  const file = await findFile(accessToken, SETTINGS_FILE_NAME);
  if (!file) throw new Error('No hay una copia de ajustes en esta cuenta de Google Drive.');
  const data: unknown = JSON.parse(await (await downloadFile(accessToken, file)).text());
  const savedSettings = data && typeof data === 'object'
    ? (data as { settings?: unknown }).settings
    : undefined;
  if (!savedSettings || typeof savedSettings !== 'object' || Array.isArray(savedSettings)) {
    throw new Error('El archivo de ajustes de Google Drive no tiene un formato válido.');
  }
  const settings = {
    autoNightMode: false,
    aiApiKeys: {},
    openRouterModel: 'openrouter/free',
    showFurigana: true,
    autoAnalyzePage: false,
    autoRotate: false,
    ...(savedSettings as Record<string, unknown>),
  };
  if (!isReaderSettings(settings)) {
    throw new Error('El archivo de ajustes de Google Drive no tiene un formato válido.');
  }
  return settings;
}

export async function getGoogleDriveSettingsDate(accessToken: string): Promise<string | null> {
  const file = await findFile(accessToken, SETTINGS_FILE_NAME);
  return file?.modifiedTime || null;
}

export async function listGoogleDriveBooks(accessToken: string): Promise<GoogleDriveBook[]> {
  const files = await listBookFiles(accessToken);
  return files.map((file) => {
    let metadata: Partial<GoogleDriveBook> = {};
    try {
      metadata = JSON.parse(file.description || '{}') as Partial<GoogleDriveBook>;
    } catch {
      // Show the file using its name if old metadata is malformed.
    }
    return {
      id: file.id,
      name: file.name,
      title: typeof metadata.title === 'string' ? metadata.title : file.name.replace(/\.epub$/i, ''),
      creator: typeof metadata.creator === 'string' ? metadata.creator : '',
      size: Number(file.size || 0),
      modifiedTime: file.modifiedTime || null,
      coverDataUrl: typeof metadata.coverDataUrl === 'string' && metadata.coverDataUrl.startsWith('data:image/')
        ? metadata.coverDataUrl
        : undefined,
    };
  });
}

async function findBookFileByMetadata(accessToken: string, book: RecentBook): Promise<DriveFile | null> {
  const files = await listBookFiles(accessToken);
  for (const file of files) {
    if (file.name !== book.name) continue;
    try {
      const metadata = JSON.parse(file.description || '{}') as {
        ereaderManaged?: unknown;
        title?: unknown;
        creator?: unknown;
      };
      if (metadata.ereaderManaged === true && metadata.title === book.title && metadata.creator === book.creator) {
        return file;
      }
    } catch {
      // Leave files without EReader metadata untouched.
    }
  }
  return null;
}

export async function uploadGoogleDriveBook(accessToken: string, book: RecentBook): Promise<void> {
  if (book.blob.size > MAX_BOOK_SIZE) {
    throw new Error(`El EPUB supera el límite de ${Math.round(MAX_BOOK_SIZE / 1024 / 1024)} MB.`);
  }
  const existing = await findBookFileByMetadata(accessToken, book);
  const cover = book.cover || await extractEpubCoverBlob(book.blob);
  const coverDataUrl = cover ? await createCoverThumbnailDataUrl(cover) : undefined;
  // Persist the cover in the file description only when it is small enough that
  // Drive happily accepts it; a big cover must never block the whole upload.
  const storedCover = coverDataUrl && coverDataUrl.length <= MAX_COVER_METADATA_LENGTH ? coverDataUrl : undefined;
  const description = JSON.stringify({
    ereaderManaged: true,
    title: book.title,
    creator: book.creator,
    ...(storedCover ? { coverDataUrl: storedCover } : {}),
  });
  await uploadFile(
    accessToken,
    book.name,
    'application/epub+zip',
    book.blob,
    existing,
    description,
    await getReaderBooksFolderId(accessToken),
  );
}

export async function downloadGoogleDriveBook(accessToken: string, cloudBook: GoogleDriveBook): Promise<RecentBook> {
  const file = await getDriveFile(accessToken, cloudBook.id);
  if (!file.name.toLowerCase().endsWith('.epub')) throw new Error('El archivo seleccionado no tiene extensión .epub.');
  if (Number(file.size || 0) > MAX_BOOK_SIZE) {
    throw new Error(`El EPUB supera el límite de descarga de ${Math.round(MAX_BOOK_SIZE / 1024 / 1024)} MB.`);
  }
  const blob = await downloadFile(accessToken, file);
  const cover = await extractEpubCoverBlob(blob);
  const book: RecentBook = {
    id: encodeURIComponent(`${file.id}|${file.name}`),
    name: file.name,
    title: cloudBook.title,
    creator: cloudBook.creator,
    lastOpened: Date.now(),
    blob: new Blob([blob], { type: 'application/epub+zip' }),
    cover,
  };
  await saveRecentBook(book);
  return book;
}

export async function updateGoogleDriveBookCover(
  accessToken: string,
  cloudBook: GoogleDriveBook,
  coverDataUrl: string,
): Promise<void> {
  if (coverDataUrl.length > MAX_COVER_METADATA_LENGTH) return;
  const file = await getDriveFile(accessToken, cloudBook.id);
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(file.description || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    // Rebuild a clean metadata document if the stored one is malformed.
  }
  const query = new URLSearchParams({ fields: 'id' });
  await driveRequest(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cloudBook.id)}?${query}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ description: JSON.stringify({ ...metadata, coverDataUrl }) }),
    },
  );
}

export async function loadGoogleDriveBookCover(
  accessToken: string,
  cloudBook: GoogleDriveBook,
): Promise<string | undefined> {
  const file = await getDriveFile(accessToken, cloudBook.id);
  if (!file.name.toLowerCase().endsWith('.epub')) return undefined;
  if (Number(file.size || 0) > MAX_BOOK_SIZE) return undefined;
  const blob = await downloadFile(accessToken, file);
  const cover = await extractEpubCoverBlob(blob);
  if (!cover) return undefined;
  const coverDataUrl = await createCoverThumbnailDataUrl(cover);
  if (!coverDataUrl) return undefined;
  try {
    await updateGoogleDriveBookCover(accessToken, cloudBook, coverDataUrl);
  } catch {
    // Showing the cover matters more than persisting it to Drive metadata.
  }
  return coverDataUrl;
}

export async function saveGoogleDriveReaderData(
  accessToken: string,
  data: ReaderBookBackup,
): Promise<void> {
  const id = await hashText(data.bookKey);
  const name = `${BOOK_STATE_PREFIX}${id}.json`;
  const previous = readerBackupQueues.get(name) || Promise.resolve();
  const save = previous.catch(() => undefined).then(async () => {
    const existing = await findFile(accessToken, name);
    const json = JSON.stringify({ formatVersion: 1, ...data });
    await uploadFile(accessToken, name, SETTINGS_FILE_TYPE, new Blob([json], { type: SETTINGS_FILE_TYPE }), existing);
  });
  readerBackupQueues.set(name, save);
  try {
    await save;
  } finally {
    if (readerBackupQueues.get(name) === save) readerBackupQueues.delete(name);
  }
}

export async function restoreGoogleDriveReaderData(
  accessToken: string,
  bookKey: string,
): Promise<ReaderBookBackup | null> {
  const id = await hashText(bookKey);
  const file = await findFile(accessToken, `${BOOK_STATE_PREFIX}${id}.json`);
  if (!file) return null;
  const data: unknown = JSON.parse(await (await downloadFile(accessToken, file)).text());
  if (!isReaderBookBackup(data) || data.bookKey !== bookKey) {
    throw new Error('Los datos de lectura de Google Drive no son válidos para este libro.');
  }
  data.favorites ||= [];
  return data;
}

export function applyGoogleDriveReaderData(data: ReaderBookBackup): void {
  const prefix = `ereader_book_${encodeURIComponent(`${data.title}|${data.creator}`)}`;
  localStorage.setItem(`${prefix}_position`, JSON.stringify(data.position));
  if (data.bookmarks.length) localStorage.setItem(`${prefix}_bookmark`, JSON.stringify(data.bookmarks));
  else localStorage.removeItem(`${prefix}_bookmark`);
  if (data.annotations.length) localStorage.setItem(`${prefix}_annotations`, JSON.stringify(data.annotations));
  else localStorage.removeItem(`${prefix}_annotations`);
  if (data.translationHistory.length) {
    localStorage.setItem(`${prefix}_translation_history`, JSON.stringify(data.translationHistory));
  } else {
    localStorage.removeItem(`${prefix}_translation_history`);
  }
  if (data.favorites.length) {
    localStorage.setItem(`${prefix}_translation_favorites`, JSON.stringify(data.favorites));
  } else {
    localStorage.removeItem(`${prefix}_translation_favorites`);
  }
}

function isReaderSettings(value: unknown): value is ReaderSettingsState {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<ReaderSettingsState>;
  return (settings.writingMode === 'vertical-rl' || settings.writingMode === 'horizontal-tb' || settings.writingMode === 'auto')
    && (settings.progressionDirection === 'rtl' || settings.progressionDirection === 'ltr' || settings.progressionDirection === 'auto')
    && typeof settings.fontSize === 'number'
    && Number.isFinite(settings.fontSize)
    && typeof settings.lineHeight === 'number'
    && Number.isFinite(settings.lineHeight)
    && (settings.fontFamily === 'mincho' || settings.fontFamily === 'gothic' || settings.fontFamily === 'serif' || settings.fontFamily === 'sans')
    && typeof settings.showFurigana === 'boolean'
    && typeof settings.autoAnalyzePage === 'boolean'
    && typeof settings.autoRotate === 'boolean'
    && (settings.theme === 'light' || settings.theme === 'sepia' || settings.theme === 'dark' || settings.theme === 'paper')
    && typeof settings.autoNightMode === 'boolean'
    && typeof settings.letterSpacing === 'number'
    && Number.isFinite(settings.letterSpacing)
    && Boolean(settings.aiApiKeys && typeof settings.aiApiKeys === 'object' && !Array.isArray(settings.aiApiKeys))
    && Object.entries(settings.aiApiKeys || {}).every(([provider, key]) =>
      ['gemini', 'openai', 'deepseek', 'openrouter'].includes(provider) && typeof key === 'string'
    )
    && typeof settings.openRouterModel === 'string';
}

function isReadingPosition(value: unknown): value is ReaderBookBackup['position'] {
  if (!value || typeof value !== 'object') return false;
  const position = value as {
    spineIndex?: unknown;
    page?: unknown;
    pageCount?: unknown;
    textOffset?: unknown;
  };
  return Number.isInteger(position.spineIndex) && Number(position.spineIndex) >= 0
    && Number.isInteger(position.page) && Number(position.page) >= 0
    && (position.pageCount === undefined
      || (Number.isInteger(position.pageCount) && Number(position.pageCount) > 0))
    && (position.textOffset === undefined
      || (Number.isInteger(position.textOffset) && Number(position.textOffset) >= 0));
}

function isReaderBookBackup(value: unknown): value is ReaderBookBackup {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return data.formatVersion === 1
    && typeof data.bookKey === 'string'
    && typeof data.title === 'string'
    && typeof data.creator === 'string'
    && isReadingPosition(data.position)
    && Array.isArray(data.bookmarks)
    && data.bookmarks.every(isReadingPosition)
    && Array.isArray(data.annotations)
    && data.annotations.every((value) => {
      if (!value || typeof value !== 'object') return false;
      const annotation = value as Record<string, unknown>;
      return typeof annotation.id === 'string'
        && Number.isInteger(annotation.spineIndex)
        && Number(annotation.spineIndex) >= 0
        && typeof annotation.quote === 'string'
        && typeof annotation.prefix === 'string'
        && typeof annotation.suffix === 'string';
    })
    && Array.isArray(data.translationHistory)
    && data.translationHistory.every((value) => {
      if (!value || typeof value !== 'object') return false;
      const entry = value as Record<string, unknown>;
      return typeof entry.id === 'string'
        && typeof entry.queriedAt === 'number'
        && Number.isFinite(entry.queriedAt)
        && typeof entry.query === 'string'
        && (entry.kind === 'dictionary' || entry.kind === 'translation' || entry.kind === 'ai')
        && (entry.provider === undefined || ['gemini', 'openai', 'deepseek', 'openrouter'].includes(String(entry.provider)))
        && typeof entry.response === 'string';
    })
    && (data.favorites === undefined || (
      Array.isArray(data.favorites)
      && data.favorites.every((value) => {
        if (!value || typeof value !== 'object') return false;
        const favorite = value as Record<string, unknown>;
        return typeof favorite.id === 'string'
          && typeof favorite.savedAt === 'number'
          && Number.isFinite(favorite.savedAt)
          && typeof favorite.query === 'string'
          && (favorite.kind === 'dictionary' || favorite.kind === 'translation' || favorite.kind === 'ai' || favorite.kind === 'glossary')
          && (favorite.provider === undefined || ['gemini', 'openai', 'deepseek', 'openrouter'].includes(String(favorite.provider)))
          && typeof favorite.response === 'string';
      })
    ));
}
