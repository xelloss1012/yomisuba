import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { ReaderSettingsState } from '../types/epub';
import { RecentBook, saveRecentBook } from './recentBooks';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SETTINGS_FILE_NAME = 'EReader settings.json';
const SETTINGS_FILE_TYPE = 'application/json';
const BOOK_FILE_PREFIX = 'EReader book - ';
const BOOK_STATE_PREFIX = 'EReader reading data - ';
const MAX_BOOK_SIZE = 100 * 1024 * 1024;

interface DriveFile {
  id: string;
  name: string;
  description?: string;
  size?: string;
  modifiedTime?: string;
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
}

export interface ReaderBookBackup {
  bookKey: string;
  title: string;
  creator: string;
  position: { spineIndex: number; page: number; pageCount?: number };
  bookmarks: Array<{ spineIndex: number; page: number; pageCount?: number }>;
  annotations: Array<{ id: string; spineIndex: number; quote: string; prefix: string; suffix: string }>;
  translationHistory: Array<{
    id: string;
    queriedAt: number;
    query: string;
    kind: 'dictionary' | 'translation' | 'ai';
    provider?: string;
    response: string;
  }>;
}

let initializePromise: Promise<void> | null = null;
const readerBackupQueues = new Map<string, Promise<void>>();
export const googleDriveConfigured = Boolean(import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID);

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
    options: { scopes: ['email', 'profile', DRIVE_FILE_SCOPE] },
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
  return createGoogleDriveSession(accessToken, result.result.idToken);
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
  const { isLoggedIn } = await SocialLogin.isLoggedIn({ provider: 'google' });
  if (!isLoggedIn) return null;

  let authorization = await SocialLogin.getAuthorizationCode({ provider: 'google' });
  if (!authorization.accessToken && Capacitor.isNativePlatform()) {
    await SocialLogin.refresh({
      provider: 'google',
      options: { scopes: ['email', 'profile', DRIVE_FILE_SCOPE] },
    });
    authorization = await SocialLogin.getAuthorizationCode({ provider: 'google' });
  }
  if (!authorization.accessToken || !authorization.jwt) {
    throw new Error('La sesión de Google no tiene un token válido para Drive. Vuelve a conectar la cuenta.');
  }
  return createGoogleDriveSession(authorization.accessToken, authorization.jwt);
}

export async function signOutGoogleDrive(): Promise<void> {
  await SocialLogin.logout({ provider: 'google' });
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

async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function findFile(accessToken: string, name: string): Promise<DriveFile | null> {
  const query = new URLSearchParams({
    q: `name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and trashed = false`,
    spaces: 'drive',
    pageSize: '100',
    fields: 'files(id,name,description,size,modifiedTime)',
    orderBy: 'modifiedTime desc',
  });
  const response = await driveRequest(accessToken, `https://www.googleapis.com/drive/v3/files?${query}`);
  const result = await response.json() as { files?: DriveFile[] };
  return result.files?.[0] || null;
}

async function listFiles(accessToken: string, prefix: string): Promise<DriveFile[]> {
  const query = new URLSearchParams({
    q: `name contains '${prefix}' and trashed = false`,
    spaces: 'drive',
    pageSize: '1000',
    fields: 'nextPageToken,files(id,name,description,size,modifiedTime)',
    orderBy: 'modifiedTime desc',
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
  return files;
}

async function uploadFile(
  accessToken: string,
  name: string,
  mimeType: string,
  blob: Blob,
  existing: DriveFile | null,
  description?: string,
): Promise<DriveFile> {
  const baseUrl = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}`
    : 'https://www.googleapis.com/upload/drive/v3/files';
  const response = await driveRequest(accessToken, `${baseUrl}?uploadType=resumable&fields=id,name,modifiedTime`, {
    method: existing ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(blob.size),
    },
    body: JSON.stringify({ name, mimeType, ...(description ? { description } : {}) }),
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
  if (!data || typeof data !== 'object' || !isReaderSettings((data as { settings?: unknown }).settings)) {
    throw new Error('El archivo de ajustes de Google Drive no tiene un formato válido.');
  }
  return (data as { settings: ReaderSettingsState }).settings;
}

export async function getGoogleDriveSettingsDate(accessToken: string): Promise<string | null> {
  const file = await findFile(accessToken, SETTINGS_FILE_NAME);
  return file?.modifiedTime || null;
}

export async function listGoogleDriveBooks(accessToken: string): Promise<GoogleDriveBook[]> {
  const files = await listFiles(accessToken, BOOK_FILE_PREFIX);
  return files.flatMap((file) => {
    const match = file.name.match(/^EReader book - ([a-f0-9]{64})\.epub$/);
    if (!match) return [];
    let metadata: Partial<GoogleDriveBook> = {};
    try {
      metadata = JSON.parse(file.description || '{}') as Partial<GoogleDriveBook>;
    } catch {
      // Show the file using its name if old metadata is malformed.
    }
    return [{
      id: match[1],
      name: typeof metadata.name === 'string' ? metadata.name : file.name,
      title: typeof metadata.title === 'string' ? metadata.title : file.name,
      creator: typeof metadata.creator === 'string' ? metadata.creator : '',
      size: Number(file.size || 0),
      modifiedTime: file.modifiedTime || null,
    }];
  });
}

export async function uploadGoogleDriveBook(accessToken: string, book: RecentBook): Promise<void> {
  if (book.blob.size > MAX_BOOK_SIZE) {
    throw new Error(`El EPUB supera el límite de ${Math.round(MAX_BOOK_SIZE / 1024 / 1024)} MB.`);
  }
  const id = await hashBlob(book.blob);
  const name = `${BOOK_FILE_PREFIX}${id}.epub`;
  const existing = await findFile(accessToken, name);
  const description = JSON.stringify({ name: book.name, title: book.title, creator: book.creator });
  await uploadFile(accessToken, name, 'application/epub+zip', book.blob, existing, description);
}

export async function downloadGoogleDriveBook(accessToken: string, cloudBook: GoogleDriveBook): Promise<RecentBook> {
  const file = await findFile(accessToken, `${BOOK_FILE_PREFIX}${cloudBook.id}.epub`);
  if (!file) throw new Error('No se encontró ese EPUB en Google Drive.');
  if (Number(file.size || 0) > MAX_BOOK_SIZE) {
    throw new Error(`El EPUB supera el límite de descarga de ${Math.round(MAX_BOOK_SIZE / 1024 / 1024)} MB.`);
  }
  const blob = await downloadFile(accessToken, file);
  const book: RecentBook = {
    id: encodeURIComponent(`${cloudBook.name}|${cloudBook.title}|${cloudBook.creator}`),
    name: cloudBook.name,
    title: cloudBook.title,
    creator: cloudBook.creator,
    lastOpened: Date.now(),
    blob: new Blob([blob], { type: 'application/epub+zip' }),
  };
  await saveRecentBook(book);
  return book;
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
  const position = value as { spineIndex?: unknown; page?: unknown; pageCount?: unknown };
  return Number.isInteger(position.spineIndex) && Number(position.spineIndex) >= 0
    && Number.isInteger(position.page) && Number(position.page) >= 0
    && (position.pageCount === undefined
      || (Number.isInteger(position.pageCount) && Number(position.pageCount) > 0));
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
    });
}
