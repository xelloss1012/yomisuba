import { Capacitor, registerPlugin } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { ReaderSettingsState } from '../types/epub';
import { RecentBook, saveRecentBook } from './recentBooks';
import { extractEpubCoverBlob } from './epubParser';
import { TranslationFavorite } from './translationFavorites';
import { DictionaryHistoryData } from './translationHistory';
import { FREQUENT_QUERIES_VERSION, FrequentQuery } from './frequentQueries';
import { AVAILABLE_LANGUAGES, TRANSLATION_LANGUAGES, tr } from './i18n';
import { FURIGANA_MODES } from './furigana';
import { parseProgress, StudyProgress } from './studyProgress';
import {
  describeGoogleDriveAuthError,
  recordGoogleDriveAuthDiagnostic,
} from './googleDriveDiagnostics';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_SESSION_EXPECTED_KEY = 'yomisuba_google_drive_session_expected';
const DRIVE_SESSION_SCOPE_VERSION_KEY = 'yomisuba_google_drive_scope_version';
const DRIVE_SESSION_SCOPE_VERSION = 'drive.file.v1';
const DRIVE_PROFILE_KEY = 'yomisuba_google_drive_profile';
// Google access tokens last an hour; a resume within this time keeps the token.
const ACCESS_TOKEN_REUSE_MS = 45 * 60 * 1000;
const PENDING_READER_DATA_KEY = 'yomisuba_pending_drive_reader_data_v1';
const DRIVE_FOLDER_NAME = '.yomisuba';
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const SETTINGS_FILE_NAME = 'settings.json';
const SETTINGS_FILE_TYPE = 'application/json';
const MAX_BOOK_SIZE = 100 * 1024 * 1024;
const COVER_THUMBNAIL_MAX_WIDTH = 160;
const COVER_THUMBNAIL_QUALITY = 0.72;
const MAX_COVER_METADATA_LENGTH = 32 * 1024;
const DRIVE_REQUEST_TIMEOUT_MS = 12_000;
const GOOGLE_AUTH_TIMEOUT_MS = 12_000;
const GOOGLE_LOGIN_TIMEOUT_MS = 60_000;
// Several requests per book: a new device (no folder cache yet) on a mobile network needs time.
const READER_RESTORE_TIMEOUT_MS = 20_000;
const DEVICE_FILE_NAME = 'device.json';

// ─── Segmented per-book storage ───────────────────────────────────────────────
// Each book lives in its own folder (named after the real book title) and each
// kind of reader data is stored in a separate file so that saving one piece only
// touches that piece's file instead of rewriting everything at once.
const READING_FILE_NAME = 'reading.json';
const BOOKMARKS_FILE_NAME = 'bookmarks.json';
const ANNOTATIONS_FILE_NAME = 'annotations.json';
const HISTORY_FILE_NAME = 'history.json';
const FAVORITES_FILE_NAME = 'favorites.json';
const BOOK_SETTINGS_FILE_NAME = 'settings.json';

export type ReaderDataGroup = 'reading' | 'bookmarks' | 'annotations' | 'history' | 'favorites';

/** Stable identity of a book, used to derive its Drive folder and validate files. */
export interface BookDriveIdentity {
  bookKey: string;
  title: string;
  creator: string;
}

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
  formatVersion?: 1;
  bookKey: string;
  title: string;
  creator: string;
  printedPages?: number;
  chapterPageCounts?: number[];
  position?: { spineIndex: number; page: number; pageCount?: number; textOffset?: number };
  bookmarks: Array<{ spineIndex: number; page: number; pageCount?: number; textOffset?: number }>;
  annotations: Array<{ id: string; spineIndex: number; quote: string; prefix: string; suffix: string; note?: string }>;
  translationHistory: Array<{
    id: string;
    queriedAt: number;
    query: string;
    kind: 'dictionary' | 'translation' | 'ai';
    provider?: string;
    response?: string;
    data?: DictionaryHistoryData;
  }>;
  favorites: TranslationFavorite[];
  frequentQueries?: FrequentQuery[];
  frequentQueriesVersion?: number;
  /** Which groups changed since the last upload, so only those files are written. */
  dirtyGroups?: ReaderDataGroup[];
}

/** Native (Android) silent renewal of the Drive token: see GoogleDriveTokenPlugin.java. */
interface GoogleDriveTokenPlugin {
  authorize(options: { scopes: string[] }): Promise<{ accessToken: string }>;
}
const GoogleDriveToken = registerPlugin<GoogleDriveTokenPlugin>('GoogleDriveToken');

let initializePromise: Promise<void> | null = null;
let currentSession: { session: GoogleDriveSession; obtainedAt: number } | null = null;
const readerBackupQueues = new Map<string, Promise<void>>();
const driveFolderCache = new Map<string, Promise<string>>();
export const googleDriveConfigured = Boolean(import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID);
const DRIVE_SCOPES = ['email', 'profile', DRIVE_FILE_SCOPE];

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

function initializeGoogleLogin(): Promise<void> {
  const webClientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) throw new Error(tr('drive.missingId'));
  if (!initializePromise) {
    recordGoogleDriveAuthDiagnostic('initialize:started');
    initializePromise = withTimeout(
      SocialLogin.initialize({ google: { webClientId, mode: 'online' } }),
      GOOGLE_AUTH_TIMEOUT_MS,
      'La conexión con Google está tardando demasiado. Puedes seguir usando la aplicación sin Drive e intentarlo más tarde.',
    ).then(() => {
      recordGoogleDriveAuthDiagnostic('initialize:succeeded');
    }).catch((error: unknown) => {
      recordGoogleDriveAuthDiagnostic('initialize:failed', error);
      initializePromise = null;
      throw error;
    });
  }
  return initializePromise;
}

export async function signInToGoogleDrive(): Promise<GoogleDriveSession> {
  recordGoogleDriveAuthDiagnostic('sign-in:started');
  try {
    await initializeGoogleLogin();
    recordGoogleDriveAuthDiagnostic('credential-picker:requested');
    const result = await withTimeout(
      SocialLogin.login({ provider: 'google', options: { scopes: DRIVE_SCOPES } }),
      GOOGLE_LOGIN_TIMEOUT_MS,
      'El inicio de sesión de Google no respondió. Puedes seguir usando la aplicación sin Drive e intentarlo más tarde.',
    );
    recordGoogleDriveAuthDiagnostic(
      `credential-picker:resolved responseType=${result.result.responseType}`,
    );
    if (result.result.responseType !== 'online') {
      throw new Error(tr('err.gdBadSignIn'));
    }
    const accessToken = result.result.accessToken?.token;
    if (!accessToken) {
      throw new Error(tr('err.gdNoAccessToken'));
    }
    if (!result.result.idToken) {
      throw new Error(tr('err.gdNoIdToken'));
    }
    recordGoogleDriveAuthDiagnostic('tokens:received; validating identity');
    const session = await createGoogleDriveSession(accessToken, result.result.idToken);
    localStorage.setItem(DRIVE_SESSION_EXPECTED_KEY, 'true');
    localStorage.setItem(DRIVE_SESSION_SCOPE_VERSION_KEY, DRIVE_SESSION_SCOPE_VERSION);
    recordGoogleDriveAuthDiagnostic('sign-in:succeeded');
    return rememberSession(session);
  } catch (error) {
    recordGoogleDriveAuthDiagnostic('sign-in:failed', error);
    throw new Error(describeGoogleDriveAuthError(error));
  }
}

/** Keeps the session in memory (for resumes) and its profile on disk (for silent restores). */
function rememberSession(session: GoogleDriveSession): GoogleDriveSession {
  currentSession = { session, obtainedAt: Date.now() };
  localStorage.setItem(DRIVE_PROFILE_KEY, JSON.stringify({ email: session.email, name: session.name }));
  return session;
}

function forgetSession() {
  currentSession = null;
  localStorage.removeItem(DRIVE_SESSION_EXPECTED_KEY);
  localStorage.removeItem(DRIVE_SESSION_SCOPE_VERSION_KEY);
  localStorage.removeItem(DRIVE_PROFILE_KEY);
}

/**
 * On Android, a new Drive token without any UI, or null when Google needs the
 * user (or the APK predates the native plugin) and the regular flow must run.
 * Drive needs no ID token, so the account's name and email come from the last
 * sign-in, or from Google's userinfo endpoint with the new token.
 */
async function restoreSessionSilently(): Promise<GoogleDriveSession | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { accessToken } = await withTimeout(
      GoogleDriveToken.authorize({ scopes: DRIVE_SCOPES }),
      GOOGLE_AUTH_TIMEOUT_MS,
      'Google no respondió al renovar el acceso a Drive.',
    );
    if (!accessToken) return null;
    let profile: { email?: unknown; name?: unknown } = {};
    try {
      profile = JSON.parse(localStorage.getItem(DRIVE_PROFILE_KEY) || '{}');
    } catch {
      // Read it again from Google below.
    }
    if (typeof profile.email !== 'string' || !profile.email) {
      profile = await (await driveRequest(accessToken, 'https://www.googleapis.com/oauth2/v3/userinfo')).json();
    }
    return {
      accessToken,
      email: typeof profile.email === 'string' ? profile.email : '',
      name: typeof profile.name === 'string' ? profile.name : '',
    };
  } catch {
    return null;
  }
}

async function createGoogleDriveSession(accessToken: string, idToken: string): Promise<GoogleDriveSession> {
  const { claims } = await withTimeout(
    SocialLogin.decodeIdToken({ idToken }),
    GOOGLE_AUTH_TIMEOUT_MS,
    'Google tardó demasiado en validar la sesión.',
  );
  return {
    accessToken,
    email: typeof claims.email === 'string' ? claims.email : '',
    name: typeof claims.name === 'string' ? claims.name : '',
  };
}

export async function restoreGoogleDriveSession(): Promise<GoogleDriveSession | null> {
  await initializeGoogleLogin();
  const expectedSession = localStorage.getItem(DRIVE_SESSION_EXPECTED_KEY) === 'true';
  if (
    expectedSession
    && localStorage.getItem(DRIVE_SESSION_SCOPE_VERSION_KEY) !== DRIVE_SESSION_SCOPE_VERSION
  ) {
    await withTimeout(
      SocialLogin.logout({ provider: 'google' }),
      GOOGLE_AUTH_TIMEOUT_MS,
      'No se pudo cerrar a tiempo la sesión anterior de Google.',
    );
    forgetSession();
    return null;
  }
  if (Capacitor.isNativePlatform() && expectedSession) {
    const silent = await restoreSessionSilently();
    if (silent) return rememberSession(silent);
    try {
      await withTimeout(
        SocialLogin.refresh({ provider: 'google', options: { scopes: DRIVE_SCOPES } }),
        GOOGLE_AUTH_TIMEOUT_MS,
        'La sesión de Google tardó demasiado en restaurarse.',
      );
    } catch (error) {
      const { isLoggedIn } = await withTimeout(
        SocialLogin.isLoggedIn({ provider: 'google' }),
        GOOGLE_AUTH_TIMEOUT_MS,
        'Google no respondió al comprobar la sesión.',
      );
      if (!isLoggedIn) {
        forgetSession();
        throw new Error(tr('err.gdSessionRevoked'));
      }
      throw error;
    }
  }
  const { isLoggedIn } = await withTimeout(
    SocialLogin.isLoggedIn({ provider: 'google' }),
    GOOGLE_AUTH_TIMEOUT_MS,
    'Google no respondió al comprobar la sesión.',
  );
  if (!isLoggedIn) {
    if (expectedSession) forgetSession();
    return null;
  }

  if (Capacitor.isNativePlatform() && !expectedSession) {
    await withTimeout(
      SocialLogin.refresh({ provider: 'google', options: { scopes: DRIVE_SCOPES } }),
      GOOGLE_AUTH_TIMEOUT_MS,
      'La sesión de Google tardó demasiado en restaurarse.',
    );
  }
  const authorization = await withTimeout(
    SocialLogin.getAuthorizationCode({ provider: 'google' }),
    GOOGLE_AUTH_TIMEOUT_MS,
    'Google no respondió al recuperar el acceso a Drive.',
  );
  if (!authorization.accessToken || !authorization.jwt) {
    throw new Error(tr('err.gdSessionNoToken'));
  }
  const session = await createGoogleDriveSession(authorization.accessToken, authorization.jwt);
  localStorage.setItem(DRIVE_SESSION_EXPECTED_KEY, 'true');
  localStorage.setItem(DRIVE_SESSION_SCOPE_VERSION_KEY, DRIVE_SESSION_SCOPE_VERSION);
  return rememberSession(session);
}

/**
 * Called on every return to the app. A token obtained less than 45 minutes ago
 * is still good, so nothing is asked of Google (asking used to bring up the
 * sign-in sheet on most returns).
 */
export async function refreshGoogleDriveSession(): Promise<GoogleDriveSession | null> {
  if (currentSession && Date.now() - currentSession.obtainedAt < ACCESS_TOKEN_REUSE_MS) {
    return currentSession.session;
  }
  return restoreGoogleDriveSession();
}

export async function signOutGoogleDrive(): Promise<void> {
  await withTimeout(
    SocialLogin.logout({ provider: 'google' }),
    GOOGLE_AUTH_TIMEOUT_MS,
    'Google tardó demasiado en cerrar la sesión.',
  );
  forgetSession();
}

async function driveRequest(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DRIVE_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(tr('err.gdTimeout'));
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new Error(tr('err.gdSessionExpired'));
    }
    throw new Error(tr('err.gdHttp', { status: response.status, detail: detail || response.statusText }));
  }
  return response;
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
      // Should there ever be two folders of the same name, every device picks the same one.
      orderBy: 'createdTime',
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
    if (!folder.id) throw new Error(tr('err.gdNoFolderId', { name }));
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

/**
 * Google Drive forbids some characters in file/folder names and treats leading/
 * trailing dots specially. Produce a safe, human-readable folder name from the
 * real book title (falling back to the creator and finally to a generic name).
 */
function sanitizeDriveFolderName(raw: string): string {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, 120)
    .trim();
  return cleaned;
}

export function bookFolderName(identity: BookDriveIdentity): string {
  const title = sanitizeDriveFolderName(identity.title);
  if (title) return title;
  const creator = sanitizeDriveFolderName(identity.creator);
  if (creator) return creator;
  return 'Libro sin título';
}

async function getBookFolderId(accessToken: string, identity: BookDriveIdentity): Promise<string> {
  const readerFolderId = await getDriveFolderId(accessToken);
  return getOrCreateDriveFolder(accessToken, bookFolderName(identity), readerFolderId);
}

async function findFile(
  accessToken: string,
  name: string,
  folderIdOverride?: string,
): Promise<DriveFile | null> {
  const folderId = folderIdOverride || await getDriveFolderId(accessToken);
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
  // Under the `drive.file` scope the app only ever sees files it created, so we
  // can locate managed EPUBs by name regardless of the folder they live in
  // (books are now stored inside their own per-book folder).
  const query = new URLSearchParams({
    q: `name contains '.epub' and mimeType != '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false`,
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
  return files.filter((file) => {
    if (!file.name.toLowerCase().endsWith('.epub')) return false;
    try {
      const metadata = JSON.parse(file.description || '{}') as { yomisubaManaged?: unknown };
      return metadata.yomisubaManaged === true;
    } catch {
      return false;
    }
  });
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
  if (!uploadUrl) throw new Error(tr('err.gdNoUploadUrl'));
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
      element.onerror = () => reject(new Error(tr('err.gdCoverRead')));
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
  if (!file) throw new Error(tr('err.gdNoSettingsCopy'));
  const data: unknown = JSON.parse(await (await downloadFile(accessToken, file)).text());
  const savedSettings = data && typeof data === 'object'
    ? (data as { settings?: unknown }).settings
    : undefined;
  if (!savedSettings || typeof savedSettings !== 'object' || Array.isArray(savedSettings)) {
    throw new Error(tr('err.gdSettingsFormat'));
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
    throw new Error(tr('err.gdSettingsFormat'));
  }
  return settings;
}

export async function getGoogleDriveSettingsDate(accessToken: string): Promise<string | null> {
  const file = await findFile(accessToken, SETTINGS_FILE_NAME);
  return file?.modifiedTime || null;
}

/** The device that last wrote to Drive: another one means the copy in Drive may be newer than this device's. */
export interface DriveWriter {
  deviceId: string;
  deviceName: string;
  savedAt: string;
}

const isDriveWriter = (value: unknown): value is DriveWriter => {
  if (!value || typeof value !== 'object') return false;
  const writer = value as Partial<DriveWriter>;
  return typeof writer.deviceId === 'string' && Boolean(writer.deviceId)
    && typeof writer.deviceName === 'string'
    && typeof writer.savedAt === 'string';
};

/** Who wrote last, or null when no device has said so yet (copies made by older versions). */
export async function getGoogleDriveLastWriter(accessToken: string): Promise<DriveWriter | null> {
  const file = await findFile(accessToken, DEVICE_FILE_NAME);
  if (!file) return null;
  try {
    const data: unknown = JSON.parse(await (await downloadFile(accessToken, file)).text());
    const writer = data && typeof data === 'object' ? (data as { writer?: unknown }).writer : undefined;
    return isDriveWriter(writer) ? writer : null;
  } catch {
    return null;
  }
}

/** Records this device as the one whose data Drive now holds. */
export async function claimGoogleDriveWriter(accessToken: string, writer: DriveWriter): Promise<void> {
  const file = await findFile(accessToken, DEVICE_FILE_NAME);
  await uploadFile(
    accessToken,
    DEVICE_FILE_NAME,
    SETTINGS_FILE_TYPE,
    new Blob([JSON.stringify({ formatVersion: 1, writer })], { type: SETTINGS_FILE_TYPE }),
    file,
  );
}

const STUDY_FILE_NAME = 'vocabulary.json';

/** The state of study of the vocabulary as Drive has it, or null when there is none (or it is damaged). */
export async function getGoogleDriveStudyProgress(accessToken: string): Promise<StudyProgress | null> {
  const file = await findFile(accessToken, STUDY_FILE_NAME);
  if (!file) return null;
  try {
    return parseProgress(JSON.parse(await (await downloadFile(accessToken, file)).text()));
  } catch {
    return null;
  }
}

export async function saveGoogleDriveStudyProgress(accessToken: string, progress: StudyProgress): Promise<void> {
  const file = await findFile(accessToken, STUDY_FILE_NAME);
  await uploadFile(
    accessToken,
    STUDY_FILE_NAME,
    SETTINGS_FILE_TYPE,
    new Blob([JSON.stringify(progress)], { type: SETTINGS_FILE_TYPE }),
    file,
  );
}

/** The reading position of a book as Drive has it, without touching anything else. */
export async function getGoogleDriveReadingPosition(
  accessToken: string,
  identity: BookDriveIdentity,
): Promise<{ position: NonNullable<ReaderBookBackup['position']>; chapterPageCounts?: number[]; printedPages?: number } | null> {
  const folderId = await getBookFolderId(accessToken, identity);
  const file = await findFile(accessToken, READING_FILE_NAME, folderId);
  if (!file) return null;
  const data: unknown = JSON.parse(await (await downloadFile(accessToken, file)).text());
  if (!isReadingFile(data, identity.bookKey)) return null;
  const reading = data as { position?: ReaderBookBackup['position']; chapterPageCounts?: number[]; printedPages?: number };
  if (!reading.position) return null;
  return {
    position: reading.position,
    ...(Array.isArray(reading.chapterPageCounts) ? { chapterPageCounts: reading.chapterPageCounts } : {}),
    ...(typeof reading.printedPages === 'number' && reading.printedPages > 0 ? { printedPages: reading.printedPages } : {}),
  };
}

/** Drops the reader data waiting to be uploaded: Drive's copy was chosen over it. */
export function clearPendingGoogleDriveReaderDataQueue(): void {
  try {
    localStorage.removeItem(PENDING_READER_DATA_KEY);
  } catch {
    // Nothing queued can be read either.
  }
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

export async function findGoogleDriveBookForRecentBook(
  accessToken: string,
  book: RecentBook,
): Promise<GoogleDriveBook | null> {
  const file = await findBookFileByMetadata(accessToken, book);
  if (!file) return null;
  let metadata: Partial<GoogleDriveBook> = {};
  try {
    metadata = JSON.parse(file.description || '{}') as Partial<GoogleDriveBook>;
  } catch {
    // findBookFileByMetadata only returns files with valid managed-book metadata.
  }
  return {
    id: file.id,
    name: file.name,
    title: typeof metadata.title === 'string' ? metadata.title : book.title,
    creator: typeof metadata.creator === 'string' ? metadata.creator : book.creator,
    size: Number(file.size || 0),
    modifiedTime: file.modifiedTime || null,
    coverDataUrl: typeof metadata.coverDataUrl === 'string' && metadata.coverDataUrl.startsWith('data:image/')
      ? metadata.coverDataUrl
      : undefined,
  };
}

async function findBookFileByMetadata(accessToken: string, book: RecentBook): Promise<DriveFile | null> {
  const files = await listBookFiles(accessToken);
  for (const file of files) {
    if (file.name !== book.name) continue;
    try {
      const metadata = JSON.parse(file.description || '{}') as {
        yomisubaManaged?: unknown;
        title?: unknown;
        creator?: unknown;
      };
      if (metadata.yomisubaManaged === true && metadata.title === book.title && metadata.creator === book.creator) {
        return file;
      }
    } catch {
      // Leave files without app metadata untouched.
    }
  }
  return null;
}

async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  await driveRequest(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    { method: 'DELETE' },
  );
}

/**
 * Deletes a book from Drive. With `keepData` only the EPUB goes: its reading data stays in its folder and
 * comes back if the same book is uploaded or opened again.
 */
export async function deleteGoogleDriveBook(
  accessToken: string,
  cloudBook: GoogleDriveBook,
  { keepData = false }: { keepData?: boolean } = {},
): Promise<void> {
  const file = await getDriveFile(accessToken, cloudBook.id);
  if (!file.name.toLowerCase().endsWith('.epub')) {
    throw new Error(tr('err.gdNotEpub'));
  }
  let metadata: { yomisubaManaged?: unknown; title?: unknown; creator?: unknown } = {};
  try {
    metadata = JSON.parse(file.description || '{}') as typeof metadata;
  } catch {
    throw new Error(tr('err.gdDeleteNoMeta'));
  }
  if (metadata.yomisubaManaged !== true) {
    throw new Error(tr('err.gdDeleteNotOurs'));
  }

  await deleteDriveFile(accessToken, file.id);
  if (!keepData && typeof metadata.title === 'string' && typeof metadata.creator === 'string') {
    const identity: BookDriveIdentity = {
      bookKey: `yomisuba_book_${encodeURIComponent(`${metadata.title}|${metadata.creator}`)}`,
      title: metadata.title,
      creator: metadata.creator,
    };
    removePendingGoogleDriveReaderData(identity.bookKey);
    await deleteAllBookData(accessToken, identity);
  }
}

/**
 * Removes every segmented data file of a book (and, best effort, the legacy
 * monolithic file from older versions) so no orphan data is left behind.
 */
async function deleteAllBookData(accessToken: string, identity: BookDriveIdentity): Promise<void> {
  let folderId: string;
  try {
    folderId = await getBookFolderId(accessToken, identity);
  } catch {
    return;
  }
  const fileNames = [
    READING_FILE_NAME,
    BOOKMARKS_FILE_NAME,
    ANNOTATIONS_FILE_NAME,
    HISTORY_FILE_NAME,
    FAVORITES_FILE_NAME,
    BOOK_SETTINGS_FILE_NAME,
  ];
  for (const name of fileNames) {
    const existing = await findFile(accessToken, name, folderId);
    if (existing) await deleteDriveFile(accessToken, existing.id);
  }
}

export async function uploadGoogleDriveBook(accessToken: string, book: RecentBook): Promise<void> {
  if (book.blob.size > MAX_BOOK_SIZE) {
    throw new Error(tr('err.gdTooBigUpload', { size: Math.round(MAX_BOOK_SIZE / 1024 / 1024) }));
  }
  const existing = await findBookFileByMetadata(accessToken, book);
  const cover = book.cover || await extractEpubCoverBlob(book.blob);
  const coverDataUrl = cover ? await createCoverThumbnailDataUrl(cover) : undefined;
  // Persist the cover in the file description only when it is small enough that
  // Drive happily accepts it; a big cover must never block the whole upload.
  const storedCover = coverDataUrl && coverDataUrl.length <= MAX_COVER_METADATA_LENGTH ? coverDataUrl : undefined;
  const description = JSON.stringify({
    yomisubaManaged: true,
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
    await getBookFolderId(accessToken, { bookKey: '', title: book.title, creator: book.creator }),
  );
}

export async function downloadGoogleDriveBook(accessToken: string, cloudBook: GoogleDriveBook): Promise<RecentBook> {
  const file = await getDriveFile(accessToken, cloudBook.id);
  if (!file.name.toLowerCase().endsWith('.epub')) throw new Error(tr('err.gdNotEpub'));
  if (Number(file.size || 0) > MAX_BOOK_SIZE) {
    throw new Error(tr('err.gdTooBigDownload', { size: Math.round(MAX_BOOK_SIZE / 1024 / 1024) }));
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
  const identity: BookDriveIdentity = { bookKey: data.bookKey, title: data.title, creator: data.creator };
  const folderId = await getBookFolderId(accessToken, identity);
  // Only the groups flagged as dirty are written. When no flag is present (e.g.
  // the initial full sync from the offline queue) every group is written.
  const groups: ReaderDataGroup[] = data.dirtyGroups && data.dirtyGroups.length
    ? data.dirtyGroups
    : ['reading', 'bookmarks', 'annotations', 'history', 'favorites'];

  await Promise.all(groups.map((group) => saveReaderGroup(accessToken, folderId, identity.bookKey, group, data)));
  clearPendingGoogleDriveReaderData(data);
}

interface DriveRevision {
  id: string;
  modifiedTime?: string;
  size?: string;
}

async function listFileRevisions(accessToken: string, fileId: string): Promise<DriveRevision[]> {
  try {
    const query = new URLSearchParams({ fields: 'revisions(id,modifiedTime,size)', pageSize: '30' });
    const response = await driveRequest(accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/revisions?${query}`);
    const result = await response.json() as { revisions?: DriveRevision[] };
    return result.revisions || [];
  } catch {
    return [];
  }
}

async function downloadRevision(accessToken: string, fileId: string, revisionId: string): Promise<Blob> {
  const response = await driveRequest(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?alt=media`,
  );
  return response.blob();
}

function groupHasData(group: ReaderDataGroup, data: Record<string, unknown>): boolean {
  switch (group) {
    case 'reading': {
      const pos = data.position as { spineIndex?: number; page?: number } | undefined;
      return Boolean(pos && (Number(pos.spineIndex || 0) > 0 || Number(pos.page || 0) > 0));
    }
    case 'bookmarks':
    case 'annotations':
    case 'favorites':
      return Array.isArray(data.items) && data.items.length > 0;
    case 'history':
      return (Array.isArray(data.translationHistory) && data.translationHistory.length > 0)
        || (Array.isArray(data.frequentQueries) && data.frequentQueries.length > 0);
  }
}

function validateGroup(group: ReaderDataGroup, value: unknown, bookKey: string): boolean {
  switch (group) {
    case 'reading': return isReadingFile(value, bookKey);
    case 'bookmarks': return isPositionsFile(value, bookKey);
    case 'annotations': return isAnnotationsFile(value, bookKey);
    case 'history': return isHistoryFile(value, bookKey);
    case 'favorites': return isFavoritesFile(value, bookKey);
  }
}

function applyGroupToLocalStorage(
  group: ReaderDataGroup,
  title: string,
  creator: string,
  remoteData: Record<string, unknown>,
): void {
  const prefix = `yomisuba_book_${encodeURIComponent(`${title}|${creator}`)}`;
  try {
    switch (group) {
      case 'reading': {
        const pos = remoteData.position as ReaderBookBackup['position'];
        if (pos) localStorage.setItem(`${prefix}_position`, JSON.stringify(pos));
        if (remoteData.printedPages) localStorage.setItem(`${prefix}_printed_pages`, String(remoteData.printedPages));
        break;
      }
      case 'bookmarks': {
        const items = remoteData.items as ReaderBookBackup['bookmarks'];
        if (Array.isArray(items) && items.length > 0) {
          localStorage.setItem(`${prefix}_bookmark`, JSON.stringify(items));
        }
        break;
      }
      case 'annotations': {
        const items = remoteData.items as ReaderBookBackup['annotations'];
        if (Array.isArray(items) && items.length > 0) {
          localStorage.setItem(`${prefix}_annotations`, JSON.stringify(items));
        }
        break;
      }
      case 'history': {
        const history = remoteData.translationHistory as ReaderBookBackup['translationHistory'];
        if (Array.isArray(history) && history.length > 0) {
          localStorage.setItem(`${prefix}_translation_history`, JSON.stringify(history));
        }
        if (remoteData.frequentQueries) {
          localStorage.setItem(`${prefix}_frequent_queries`, JSON.stringify(remoteData.frequentQueries));
        }
        break;
      }
      case 'favorites': {
        const items = remoteData.items as TranslationFavorite[];
        if (Array.isArray(items) && items.length > 0) {
          localStorage.setItem(`${prefix}_translation_favorites`, JSON.stringify(items));
        }
        break;
      }
    }
  } catch (error) {
    console.warn(`[DriveSync] Could not apply recovered remote ${group} to localStorage:`, error);
  }
}

/** Serializes one data group to its own JSON file inside the book folder. */
async function saveReaderGroup(
  accessToken: string,
  folderId: string,
  bookKey: string,
  group: ReaderDataGroup,
  data: ReaderBookBackup,
): Promise<void> {
  const fileName = groupFileName(group);
  let payload: unknown;
  switch (group) {
    case 'reading':
      payload = {
        formatVersion: 1,
        bookKey,
        ...(data.position ? { position: data.position } : {}),
        ...(data.printedPages ? { printedPages: data.printedPages } : {}),
        ...(data.chapterPageCounts && data.chapterPageCounts.length ? { chapterPageCounts: data.chapterPageCounts } : {}),
      };
      break;
    case 'bookmarks':
      payload = { formatVersion: 1, bookKey, items: data.bookmarks };
      break;
    case 'annotations':
      payload = { formatVersion: 1, bookKey, items: data.annotations };
      break;
    case 'history':
      payload = {
        formatVersion: 1,
        bookKey,
        translationHistory: data.translationHistory,
        ...(data.frequentQueries ? { frequentQueries: data.frequentQueries } : {}),
        ...(data.frequentQueriesVersion ? { frequentQueriesVersion: data.frequentQueriesVersion } : {}),
      };
      break;
    case 'favorites':
      payload = { formatVersion: 1, bookKey, items: data.favorites };
      break;
  }
  const queueKey = `${folderId}:${fileName}`;
  const previous = readerBackupQueues.get(queueKey) || Promise.resolve();
  const save = previous.catch(() => undefined).then(async () => {
    const existing = await findFile(accessToken, fileName, folderId);

    // Safeguard: Do not overwrite non-empty Drive files with empty local data!
    if (existing) {
      const isLocalEmpty =
        (group === 'bookmarks' && data.bookmarks.length === 0) ||
        (group === 'annotations' && data.annotations.length === 0) ||
        (group === 'favorites' && data.favorites.length === 0) ||
        (group === 'history' && data.translationHistory.length === 0) ||
        (group === 'reading' && (!data.position || (data.position.spineIndex === 0 && data.position.page === 0)));

      if (isLocalEmpty) {
        try {
          const remoteText = await (await downloadFile(accessToken, existing)).text();
          const remoteData = JSON.parse(remoteText) as Record<string, unknown>;
          if (validateGroup(group, remoteData, bookKey) && groupHasData(group, remoteData)) {
            console.warn(`[DriveSync] Guard protected: refusing to overwrite non-empty remote ${group} with empty local data.`);
            applyGroupToLocalStorage(group, data.title, data.creator, remoteData);
            return;
          }
        } catch {
          // If checking remote fails, proceed with normal upload
        }
      }
    }

    const json = JSON.stringify(payload);
    await uploadFile(accessToken, fileName, SETTINGS_FILE_TYPE, new Blob([json], { type: SETTINGS_FILE_TYPE }), existing, undefined, folderId);
  });
  readerBackupQueues.set(queueKey, save);
  try {
    await save;
  } finally {
    if (readerBackupQueues.get(queueKey) === save) readerBackupQueues.delete(queueKey);
  }
}

function groupFileName(group: ReaderDataGroup): string {
  switch (group) {
    case 'reading': return READING_FILE_NAME;
    case 'bookmarks': return BOOKMARKS_FILE_NAME;
    case 'annotations': return ANNOTATIONS_FILE_NAME;
    case 'history': return HISTORY_FILE_NAME;
    case 'favorites': return FAVORITES_FILE_NAME;
  }
}

export async function syncPendingGoogleDriveReaderData(accessToken: string): Promise<void> {
  for (const data of Object.values(getPendingGoogleDriveReaderData())) {
    await saveGoogleDriveReaderData(accessToken, data);
  }
}

export function queueGoogleDriveReaderData(data: ReaderBookBackup): void {
  try {
    const pending = getPendingGoogleDriveReaderData();
    const existing = pending[data.bookKey];
    if (existing) {
      const isNewEmpty = (!data.position || (data.position.spineIndex === 0 && data.position.page === 0))
        && data.bookmarks.length === 0 && data.annotations.length === 0 && data.favorites.length === 0;
      const existingHasData = Boolean(existing.position && (existing.position.spineIndex > 0 || existing.position.page > 0))
        || existing.bookmarks.length > 0 || existing.annotations.length > 0 || existing.favorites.length > 0;
      if (isNewEmpty && existingHasData) {
        return; // Don't replace existing non-empty pending snapshot with empty
      }
    }
    const { dirtyGroups: _ignored, ...snapshot } = data;
    pending[data.bookKey] = { ...snapshot, formatVersion: 1 };
    localStorage.setItem(PENDING_READER_DATA_KEY, JSON.stringify(pending));
  } catch (error) {
    console.warn('No se pudo guardar localmente la cola de sincronización de Drive:', error);
  }
}

export function getPendingGoogleDriveReaderData(): Record<string, ReaderBookBackup> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PENDING_READER_DATA_KEY) || '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter((entry): entry is [string, ReaderBookBackup] =>
        isReaderBookBackup(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function clearPendingGoogleDriveReaderData(data: ReaderBookBackup): void {
  try {
    const pending = getPendingGoogleDriveReaderData();
    const { dirtyGroups: _ignored, ...snapshot } = data;
    if (JSON.stringify(pending[data.bookKey]) !== JSON.stringify({ ...snapshot, formatVersion: 1 })) return;
    delete pending[data.bookKey];
    if (Object.keys(pending).length) {
      localStorage.setItem(PENDING_READER_DATA_KEY, JSON.stringify(pending));
    } else {
      localStorage.removeItem(PENDING_READER_DATA_KEY);
    }
  } catch (error) {
    console.warn('No se pudo limpiar la cola local de sincronización de Drive:', error);
  }
}

export function removePendingGoogleDriveReaderData(bookKey: string): void {
  try {
    const pending = getPendingGoogleDriveReaderData();
    if (!pending[bookKey]) return;
    delete pending[bookKey];
    if (Object.keys(pending).length) {
      localStorage.setItem(PENDING_READER_DATA_KEY, JSON.stringify(pending));
    } else {
      localStorage.removeItem(PENDING_READER_DATA_KEY);
    }
  } catch (error) {
    console.warn('No se pudo quitar de la cola local el respaldo eliminado:', error);
  }
}

export async function restoreGoogleDriveReaderData(
  accessToken: string,
  identity: BookDriveIdentity,
): Promise<ReaderBookBackup | null> {
  return withTimeout((async () => {
    const folderId = await getBookFolderId(accessToken, identity);
    const bookKey = identity.bookKey;
    const present: ReaderDataGroup[] = [];
    const backup: ReaderBookBackup = {
      formatVersion: 1,
      bookKey,
      title: identity.title,
      creator: identity.creator,
      bookmarks: [],
      annotations: [],
      translationHistory: [],
      favorites: [],
    };

    const loadGroup = async (
      group: ReaderDataGroup,
      fileName: string,
      validate: (value: unknown, key: string) => boolean,
      apply: (data: Record<string, unknown>) => void,
    ) => {
      const file = await findFile(accessToken, fileName, folderId);
      if (!file) return;

      let chosenData: Record<string, unknown> | null = null;
      try {
        const text = await (await downloadFile(accessToken, file)).text();
        const data: unknown = JSON.parse(text);
        if (validate(data, bookKey)) {
          chosenData = data as Record<string, unknown>;
        }
      } catch {
        // ignore parse/download error
      }

      // If the latest file exists but has NO data (e.g. was overwritten with empty items),
      // look for previous revisions in Google Drive!
      if (!chosenData || !groupHasData(group, chosenData)) {
        try {
          const revisions = await listFileRevisions(accessToken, file.id);
          // Look backwards from newest revision
          for (let i = revisions.length - 1; i >= 0; i--) {
            const rev = revisions[i];
            try {
              const revBlob = await downloadRevision(accessToken, file.id, rev.id);
              const revData: unknown = JSON.parse(await revBlob.text());
              if (validate(revData, bookKey) && groupHasData(group, revData as Record<string, unknown>)) {
                chosenData = revData as Record<string, unknown>;
                console.info(`[DriveSync] Recovered ${group} from previous revision (${rev.modifiedTime || rev.id})`);
                break;
              }
            } catch {
              continue;
            }
          }
        } catch {
          // ignore revision checking error
        }
      }

      if (chosenData) {
        present.push(group);
        apply(chosenData);
      }
    };

    // The groups are independent files: fetching them at once keeps a new device within the time limit.
    await Promise.all([
      loadGroup('reading', READING_FILE_NAME, isReadingFile, (data) => {
        const position = data.position as ReaderBookBackup['position'];
        if (position) backup.position = position;
        const printedPages = data.printedPages as number | undefined;
        if (printedPages) backup.printedPages = printedPages;
        const chapterPageCounts = data.chapterPageCounts as number[] | undefined;
        if (chapterPageCounts) backup.chapterPageCounts = chapterPageCounts;
      }),
      loadGroup('bookmarks', BOOKMARKS_FILE_NAME, isPositionsFile, (data) => {
        backup.bookmarks = data.items as ReaderBookBackup['bookmarks'];
      }),
      loadGroup('annotations', ANNOTATIONS_FILE_NAME, isAnnotationsFile, (data) => {
        backup.annotations = data.items as ReaderBookBackup['annotations'];
      }),
      loadGroup('history', HISTORY_FILE_NAME, isHistoryFile, (data) => {
        backup.translationHistory = data.translationHistory as ReaderBookBackup['translationHistory'];
        if (data.frequentQueries) backup.frequentQueries = data.frequentQueries as FrequentQuery[];
        if (data.frequentQueriesVersion) backup.frequentQueriesVersion = data.frequentQueriesVersion as number;
      }),
      loadGroup('favorites', FAVORITES_FILE_NAME, isFavoritesFile, (data) => {
        backup.favorites = data.items as TranslationFavorite[];
      }),
    ]);

    if (!present.length) return null;
    // Signal which groups exist remotely so `applyGoogleDriveReaderData` only
    // touches those and never wipes local data for a group with no remote file.
    backup.dirtyGroups = present;
    return backup;
  })(), READER_RESTORE_TIMEOUT_MS, 'La restauración desde Drive tardó demasiado.');
}

export function applyGoogleDriveReaderData(data: ReaderBookBackup): void {
  const prefix = `yomisuba_book_${encodeURIComponent(`${data.title}|${data.creator}`)}`;
  // Only apply the groups that were actually restored from Drive so a missing
  // remote file never destroys local data.
  const restored = new Set<ReaderDataGroup>(data.dirtyGroups);

  if (restored.has('reading') && data.position) {
    localStorage.setItem(`${prefix}_position`, JSON.stringify(data.position));
    if (data.printedPages) localStorage.setItem(`${prefix}_printed_pages`, String(data.printedPages));
  }
  if (restored.has('bookmarks')) {
    if (data.bookmarks.length) localStorage.setItem(`${prefix}_bookmark`, JSON.stringify(data.bookmarks));
    else localStorage.removeItem(`${prefix}_bookmark`);
  }
  if (restored.has('annotations')) {
    if (data.annotations.length) localStorage.setItem(`${prefix}_annotations`, JSON.stringify(data.annotations));
    else localStorage.removeItem(`${prefix}_annotations`);
  }
  if (restored.has('history')) {
    if (data.translationHistory.length) {
      localStorage.setItem(`${prefix}_translation_history`, JSON.stringify(data.translationHistory));
    } else {
      localStorage.removeItem(`${prefix}_translation_history`);
    }
    if (data.frequentQueriesVersion === FREQUENT_QUERIES_VERSION && data.frequentQueries !== undefined) {
      if (data.frequentQueries.length) {
        localStorage.setItem(`${prefix}_frequent_queries`, JSON.stringify(data.frequentQueries));
      } else {
        localStorage.removeItem(`${prefix}_frequent_queries`);
      }
      localStorage.setItem(`${prefix}_frequent_queries_version`, String(FREQUENT_QUERIES_VERSION));
    }
  }
  if (restored.has('favorites')) {
    if (data.favorites.length) {
      localStorage.setItem(`${prefix}_translation_favorites`, JSON.stringify(data.favorites));
    } else {
      localStorage.removeItem(`${prefix}_translation_favorites`);
    }
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
    && typeof settings.openRouterModel === 'string'
    && (settings.language === undefined || AVAILABLE_LANGUAGES.some(({ code }) => code === settings.language))
    && (settings.translationLanguage === undefined
      || TRANSLATION_LANGUAGES.some(({ code }) => code === settings.translationLanguage))
    && (settings.studyLevel === undefined || [1, 2, 3, 4, 5].includes(settings.studyLevel))
    && (settings.furiganaMode === undefined || FURIGANA_MODES.includes(settings.furiganaMode))
    && (settings.furiganaShownMode === undefined
      || FURIGANA_MODES.some((mode) => mode !== 'hidden' && mode === settings.furiganaShownMode));
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

const isDictionaryHistoryData = (value: unknown): value is DictionaryHistoryData => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return typeof data.baseForm === 'string' &&
    Array.isArray(data.searchTerms) &&
    Array.isArray(data.entries);
};

function isAnnotation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const annotation = value as Record<string, unknown>;
  return typeof annotation.id === 'string'
    && Number.isInteger(annotation.spineIndex)
    && Number(annotation.spineIndex) >= 0
    && typeof annotation.quote === 'string'
    && typeof annotation.prefix === 'string'
    && typeof annotation.suffix === 'string'
    && (annotation.note === undefined || typeof annotation.note === 'string');
}

function isHistoryEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string'
    && typeof entry.queriedAt === 'number'
    && Number.isFinite(entry.queriedAt)
    && typeof entry.query === 'string'
    && (entry.kind === 'dictionary' || entry.kind === 'translation' || entry.kind === 'ai')
    && (entry.provider === undefined || ['gemini', 'openai', 'deepseek', 'openrouter'].includes(String(entry.provider)))
    && (entry.response === undefined || typeof entry.response === 'string')
    && (entry.data === undefined || isDictionaryHistoryData(entry.data));
}

function isFavorite(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const favorite = value as Record<string, unknown>;
  return typeof favorite.id === 'string'
    && typeof favorite.savedAt === 'number'
    && Number.isFinite(favorite.savedAt)
    && typeof favorite.query === 'string'
    && (favorite.kind === 'dictionary' || favorite.kind === 'translation' || favorite.kind === 'ai' || favorite.kind === 'glossary')
    && (favorite.provider === undefined || ['gemini', 'openai', 'deepseek', 'openrouter'].includes(String(favorite.provider)))
    && typeof favorite.response === 'string'
    && (favorite.data === undefined || isDictionaryHistoryData(favorite.data))
    && (favorite.context === undefined || typeof favorite.context === 'string');
}

function isFrequentQuery(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const query = value as Record<string, unknown>;
  return typeof query.key === 'string'
    && typeof query.query === 'string'
    && typeof query.count === 'number'
    && Number.isInteger(query.count)
    && query.count > 0
    && typeof query.updatedAt === 'number'
    && Number.isFinite(query.updatedAt);
}

function isReaderBookBackup(value: unknown): value is ReaderBookBackup {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return data.formatVersion === 1
    && typeof data.bookKey === 'string'
    && typeof data.title === 'string'
    && typeof data.creator === 'string'
    && (data.printedPages === undefined || (Number.isInteger(data.printedPages) && Number(data.printedPages) > 0))
    && (data.chapterPageCounts === undefined || (Array.isArray(data.chapterPageCounts)
      && data.chapterPageCounts.every((count) => Number.isInteger(count) && Number(count) > 0)))
    && (data.position === undefined || isReadingPosition(data.position))
    && Array.isArray(data.bookmarks)
    && data.bookmarks.every(isReadingPosition)
    && Array.isArray(data.annotations)
    && data.annotations.every(isAnnotation)
    && Array.isArray(data.translationHistory)
    && data.translationHistory.every(isHistoryEntry)
    && (data.favorites === undefined || (
      Array.isArray(data.favorites)
      && data.favorites.every(isFavorite)
    ))
    && (data.frequentQueriesVersion === undefined || data.frequentQueriesVersion === FREQUENT_QUERIES_VERSION)
    && (data.frequentQueries === undefined || (
      Array.isArray(data.frequentQueries)
      && data.frequentQueries.every(isFrequentQuery)
    ));
}

// ─── Segmented file validators ────────────────────────────────────────────────
// Each per-book file is a small envelope { formatVersion, bookKey, ...payload }.
// `bookKey` must match the requested book so a mismatched/renamed folder is
// rejected instead of silently mixing data between books.
function readSegmentedEnvelope(value: unknown, bookKey: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.formatVersion !== 1 || data.bookKey !== bookKey) return null;
  return data;
}

function isReadingFile(value: unknown, bookKey: string): boolean {
  const data = readSegmentedEnvelope(value, bookKey);
  if (!data) return false;
  if (data.position !== undefined && !isReadingPosition(data.position)) return false;
  if (data.printedPages !== undefined && !(Number.isInteger(data.printedPages) && Number(data.printedPages) > 0)) return false;
  if (data.chapterPageCounts !== undefined && !(Array.isArray(data.chapterPageCounts)
    && data.chapterPageCounts.every((count) => Number.isInteger(count) && Number(count) > 0))) return false;
  return true;
}

function isPositionsFile(value: unknown, bookKey: string): boolean {
  const data = readSegmentedEnvelope(value, bookKey);
  if (!data) return false;
  return Array.isArray(data.items) && data.items.every(isReadingPosition);
}

function isAnnotationsFile(value: unknown, bookKey: string): boolean {
  const data = readSegmentedEnvelope(value, bookKey);
  if (!data) return false;
  return Array.isArray(data.items) && data.items.every(isAnnotation);
}

function isHistoryFile(value: unknown, bookKey: string): boolean {
  const data = readSegmentedEnvelope(value, bookKey);
  if (!data) return false;
  if (!Array.isArray(data.translationHistory) || !data.translationHistory.every(isHistoryEntry)) return false;
  if (data.frequentQueries !== undefined && !(Array.isArray(data.frequentQueries) && data.frequentQueries.every(isFrequentQuery))) return false;
  if (data.frequentQueriesVersion !== undefined && data.frequentQueriesVersion !== FREQUENT_QUERIES_VERSION) return false;
  return true;
}

function isFavoritesFile(value: unknown, bookKey: string): boolean {
  const data = readSegmentedEnvelope(value, bookKey);
  if (!data) return false;
  return Array.isArray(data.items) && data.items.every(isFavorite);
}

/** The reading data of a book that is in Drive, as the keys and values it has in this device's storage. */
export interface DriveStudyBook {
  bookKey: string;
  title: string;
  creator: string;
  entries: Record<string, string>;
}

const STUDY_GROUPS: ReaderDataGroup[] = ['reading', 'bookmarks', 'annotations', 'history', 'favorites'];
const DRIVE_LIST_CHUNK = 25;
const DRIVE_DOWNLOAD_CONCURRENCY = 6;

/** Every page of a listing of Drive files. */
async function listAllDriveFiles(accessToken: string, q: string, fields: string): Promise<Array<DriveFile & { parents?: string[] }>> {
  const files: Array<DriveFile & { parents?: string[] }> = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      q,
      spaces: 'drive',
      pageSize: '1000',
      fields: `nextPageToken, files(${fields})`,
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await driveRequest(accessToken, `https://www.googleapis.com/drive/v3/files?${query}`);
    const result = await response.json() as { files?: Array<DriveFile & { parents?: string[] }>; nextPageToken?: string };
    files.push(...(result.files ?? []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return files;
}

/** Runs the tasks with at most `limit` of them at a time. */
async function inPool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** The entries of this device's storage that a data file of Drive stands for. */
function groupEntries(group: ReaderDataGroup, prefix: string, data: Record<string, unknown>): Record<string, string> {
  const entries: Record<string, string> = {};
  switch (group) {
    case 'reading':
      if (data.position) entries[`${prefix}_position`] = JSON.stringify(data.position);
      if (data.printedPages) entries[`${prefix}_printed_pages`] = String(data.printedPages);
      if (Array.isArray(data.chapterPageCounts) && data.chapterPageCounts.length) {
        entries[`${prefix}_pagination`] = JSON.stringify({ drive: { counts: data.chapterPageCounts, savedAt: 0 } });
      }
      break;
    case 'bookmarks':
      if (Array.isArray(data.items) && data.items.length) entries[`${prefix}_bookmark`] = JSON.stringify(data.items);
      break;
    case 'annotations':
      if (Array.isArray(data.items) && data.items.length) entries[`${prefix}_annotations`] = JSON.stringify(data.items);
      break;
    case 'history':
      if (Array.isArray(data.translationHistory) && data.translationHistory.length) {
        entries[`${prefix}_translation_history`] = JSON.stringify(data.translationHistory);
      }
      if (Array.isArray(data.frequentQueries) && data.frequentQueries.length) {
        entries[`${prefix}_frequent_queries`] = JSON.stringify(data.frequentQueries);
        if (data.frequentQueriesVersion) entries[`${prefix}_frequent_queries_version`] = String(data.frequentQueriesVersion);
      }
      break;
    case 'favorites':
      if (Array.isArray(data.items) && data.items.length) entries[`${prefix}_translation_favorites`] = JSON.stringify(data.items);
      break;
  }
  return entries;
}

/**
 * The reading data in Drive of the books this device does not have: those read only on other devices,
 * or removed here. Only reads: nothing is written to this device or to Drive. Folders named in
 * `skipFolders` (the books this device has) are not downloaded.
 */
export async function listGoogleDriveStudyBooks(
  accessToken: string,
  skipFolders: ReadonlySet<string>,
): Promise<DriveStudyBook[]> {
  const rootId = await getDriveFolderId(accessToken);
  const folders = (await listAllDriveFiles(
    accessToken,
    `'${rootId}' in parents and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false`,
    'id,name',
  )).filter((folder) => !skipFolders.has(folder.name));
  if (!folders.length) return [];

  // One listing for many folders at a time, instead of one per folder.
  const filesByFolder = new Map<string, Map<ReaderDataGroup, DriveFile>>();
  for (let index = 0; index < folders.length; index += DRIVE_LIST_CHUNK) {
    const chunk = folders.slice(index, index + DRIVE_LIST_CHUNK);
    const files = await listAllDriveFiles(
      accessToken,
      `(${chunk.map((folder) => `'${folder.id}' in parents`).join(' or ')}) and mimeType != '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false`,
      'id,name,parents,modifiedTime',
    );
    for (const file of files) {
      const folderId = file.parents?.find((parent) => chunk.some((folder) => folder.id === parent));
      const group = STUDY_GROUPS.find((candidate) => groupFileName(candidate) === file.name);
      if (!folderId || !group) continue;
      const groups = filesByFolder.get(folderId) ?? new Map<ReaderDataGroup, DriveFile>();
      const known = groups.get(group);
      if (!known || (file.modifiedTime ?? '') > (known.modifiedTime ?? '')) groups.set(group, file);
      filesByFolder.set(folderId, groups);
    }
  }

  const downloads = [...filesByFolder.entries()].flatMap(([folderId, groups]) =>
    [...groups.entries()].map(([group, file]) => async () => {
      try {
        const value: unknown = JSON.parse(await (await downloadFile(accessToken, file)).text());
        const bookKey = value && typeof value === 'object' ? (value as { bookKey?: unknown }).bookKey : undefined;
        if (typeof bookKey !== 'string' || !validateGroup(group, value, bookKey)) return null;
        return { folderId, group, bookKey, data: value as Record<string, unknown> };
      } catch {
        return null;
      }
    }));
  const results = await inPool(downloads, DRIVE_DOWNLOAD_CONCURRENCY);

  const books = new Map<string, DriveStudyBook>();
  for (const result of results) {
    if (!result) continue;
    let identity: string;
    try {
      identity = decodeURIComponent(result.bookKey.replace(/^yomisuba_book_/, ''));
    } catch {
      continue;
    }
    const separator = identity.indexOf('|');
    if (separator < 0) continue;
    const book = books.get(result.bookKey) ?? {
      bookKey: result.bookKey,
      title: identity.slice(0, separator),
      creator: identity.slice(separator + 1),
      entries: {},
    };
    Object.assign(book.entries, groupEntries(result.group, result.bookKey, result.data));
    books.set(result.bookKey, book);
  }
  return [...books.values()].filter((book) => Object.keys(book.entries).length > 0);
}
