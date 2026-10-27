import React, { useState } from 'react';
import { Check, CloudDownload, Copy, Loader2, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { GoogleDriveSession } from '../utils/googleDriveBackup';
import { useT } from '../i18n/LanguageContext';

interface Props {
  configured: boolean;
  session: GoogleDriveSession | null;
  settingsDate: string | null;
  busy: boolean;
  signingIn: boolean;
  error: string | null;
  onCopyDiagnostics: () => Promise<void>;
  onSignIn: () => void;
  onSignOut: () => void;
  onRestoreSettings: () => void;
  onRefreshBooks: () => void;
}

/** The Google account only: the books themselves (and their Drive actions) live in the book shelf. */
export const GoogleDriveBackupPanel: React.FC<Props> = ({
  configured,
  session,
  settingsDate,
  busy,
  signingIn,
  error,
  onCopyDiagnostics,
  onSignIn,
  onSignOut,
  onRestoreSettings,
  onRefreshBooks,
}) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const handleCopyDiagnostics = async () => {
    try {
      await onCopyDiagnostics();
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyFailed(true);
      setCopied(false);
    }
  };
  return (
    <section className="mt-6 w-full min-w-0 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3 text-left dark:border-indigo-900/60 dark:bg-indigo-950/20">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-[12rem] flex-1">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t('drive.title')}</h2>
          <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
            {session ? session.name || session.email || t('drive.googleAccount') : t('drive.subtitle')}
          </p>
        </div>
        {!session ? (
          <button
            type="button"
            onClick={onSignIn}
            disabled={!configured || busy}
            className="inline-flex min-h-10 max-w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            title={!configured ? t('drive.signInTitle') : undefined}
          >
            <LogIn className="h-4 w-4" /> {t('drive.signIn')}
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onRefreshBooks}
              disabled={busy}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-white disabled:opacity-50 dark:hover:bg-zinc-800"
              aria-label={t('drive.ariaRefresh')}
              title={t('drive.refreshTitle')}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onSignOut}
              disabled={busy}
              className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-2 text-xs text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <LogOut className="h-3.5 w-3.5" /> {t('drive.signOutBtn')}
            </button>
          </div>
        )}
      </div>

      {signingIn && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-white/70 p-2 text-[11px] text-indigo-800 dark:bg-zinc-900/70 dark:text-indigo-200">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('drive.signInPending')}
        </p>
      )}

      {error && !session && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200">
          <p className="font-semibold">{t('drive.authError')}</p>
          <p className="mt-1 break-words">{error}</p>
          <button
            type="button"
            onClick={() => void handleCopyDiagnostics()}
            className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 font-semibold hover:bg-rose-100 dark:border-rose-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? t('drive.diagnosticsCopied') : t('drive.copyDiagnostics')}
          </button>
          {copyFailed && <p className="mt-1">{t('drive.copyDiagnosticsFailed')}</p>}
        </div>
      )}

      {!configured && (
        <p className="mt-3 rounded-lg bg-white/70 p-2 text-[11px] text-amber-800 dark:bg-zinc-900/70 dark:text-amber-300">
          {t('drive.missingId')}
        </p>
      )}

      {session && (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 border-t border-indigo-200 pt-3 dark:border-indigo-900/60">
          <span className="w-full min-w-0 text-[11px] text-zinc-600 dark:text-zinc-400 sm:w-auto sm:flex-1">
            {t('drive.backupNotice')}
            {settingsDate ? new Date(settingsDate).toLocaleString() : t('drive.notCreated')}.
          </span>
          <button
            type="button"
            onClick={onRestoreSettings}
            disabled={busy || !settingsDate}
            className="inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-indigo-300 px-2.5 py-2 text-[11px] font-semibold text-indigo-800 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-200 dark:hover:bg-zinc-900 sm:w-auto"
          >
            <CloudDownload className="h-3.5 w-3.5" /> {t('drive.restore')}
          </button>
        </div>
      )}
    </section>
  );
};
