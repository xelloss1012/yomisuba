import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'yomisuba_google_drive_auth_diagnostics_v1';
const MAX_ENTRIES = 40;
let entries: string[] | null = null;

const redact = (value: string) => value
  .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
  .replace(/\bya29\.[A-Za-z0-9._-]+\b/g, '[redacted-token]')
  .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]')
  .replace(/\b[A-Za-z0-9._-]+\.apps\.googleusercontent\.com\b/g, '[redacted-client-id]')
  .slice(0, 240);

export const describeGoogleDriveAuthError = (error: unknown) => {
  if (typeof error === 'string') return redact(error);
  if (error instanceof Error) {
    const codedError = error as Error & { code?: unknown };
    const code = typeof codedError.code === 'string' ? ` [${redact(codedError.code)}]` : '';
    return redact(`${error.name}${code}: ${error.message}`);
  }
  if (error && typeof error === 'object') {
    const detail = error as { code?: unknown; message?: unknown };
    const code = typeof detail.code === 'string' ? ` [${redact(detail.code)}]` : '';
    const message = typeof detail.message === 'string' ? detail.message : 'Unknown error';
    return redact(`${message}${code}`);
  }
  return redact(String(error));
};

const readEntries = () => {
  if (entries) return entries;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    entries = Array.isArray(saved)
      ? saved.filter((line): line is string => typeof line === 'string').slice(-MAX_ENTRIES)
      : [];
  } catch {
    entries = [];
  }
  return entries;
};

export const recordGoogleDriveAuthDiagnostic = (event: string, error?: unknown) => {
  const lines = readEntries();
  const detail = error === undefined ? '' : ` — ${describeGoogleDriveAuthError(error)}`;
  lines.push(`${new Date().toISOString()} [${Capacitor.getPlatform()}] ${redact(event)}${detail}`);
  if (lines.length > MAX_ENTRIES) lines.splice(0, lines.length - MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Keep diagnostics in memory if local storage is unavailable.
  }
};

export const getGoogleDriveAuthDiagnostics = () => [
  `Yomisuba Google sign-in diagnostics`,
  `Platform: ${Capacitor.getPlatform()}`,
  ...readEntries(),
].join('\n');
