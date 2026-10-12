import React from 'react';
import { CloudDownload, CloudUpload, LogIn, LogOut, RefreshCw, Trash2 } from 'lucide-react';
import { GoogleDriveBook, GoogleDriveSession } from '../utils/googleDriveBackup';
import { BookCoverThumbnail } from './BookCoverThumbnail';
import { RecentBook } from '../utils/recentBooks';
import { t } from '../utils/i18n';

interface Props {
  configured: boolean;
  session: GoogleDriveSession | null;
  settingsDate: string | null;
  localBooks: RecentBook[];
  cloudBooks: GoogleDriveBook[];
  busy: boolean;
  language?: 'es' | 'en';
  onSignIn: () => void;
  onSignOut: () => void;
  onRestoreSettings: () => void;
  onUploadBook: (book: RecentBook) => void;
  onDownloadBook: (book: GoogleDriveBook) => void;
  onDeleteBook: (book: GoogleDriveBook) => void;
  onRefreshBooks: () => void;
}

export const GoogleDriveBackupPanel: React.FC<Props> = ({
  configured,
  session,
  settingsDate,
  localBooks,
  cloudBooks,
  busy,
  language = 'es',
  onSignIn,
  onSignOut,
  onRestoreSettings,
  onUploadBook,
  onDownloadBook,
  onDeleteBook,
  onRefreshBooks,
}) => (
  <section className="mt-6 w-full min-w-0 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3 text-left dark:border-indigo-900/60 dark:bg-indigo-950/20 sm:p-4">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t('drive.title', language)}</h2>
        <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
          {t('drive.subtitle', language)}
        </p>
      </div>
      {!session ? (
        <button
          type="button"
          onClick={onSignIn}
          disabled={!configured || busy}
          className="inline-flex min-h-10 max-w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          title={!configured ? t('drive.signInTitle', language) : undefined}
        >
          <LogIn className="h-4 w-4" /> {t('drive.signIn', language)}
        </button>
      ) : (
        <div className="flex max-w-full min-w-0 items-center gap-2">
          <span className="min-w-0 max-w-48 truncate text-xs text-zinc-600 dark:text-zinc-300">
            {session.name || session.email || t('drive.googleAccount', language)}
          </span>
          <button
            type="button"
            onClick={onSignOut}
            disabled={busy}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-2 text-xs text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <LogOut className="h-3.5 w-3.5" /> {t('drive.signOutBtn', language)}
          </button>
        </div>
      )}
    </div>

    {!configured && (
      <p className="mt-3 rounded-lg bg-white/70 p-2 text-[11px] text-amber-800 dark:bg-zinc-900/70 dark:text-amber-300">
        {t('drive.missingId', language)}
      </p>
    )}

    {session && (
      <div className="mt-4 space-y-4 border-t border-indigo-200 pt-4 dark:border-indigo-900/60">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="w-full min-w-0 text-[11px] text-zinc-600 dark:text-zinc-400 sm:w-auto sm:flex-1">
            {t('drive.backupNotice', language)}
            {settingsDate ? new Date(settingsDate).toLocaleString() : t('drive.notCreated', language)}.
          </span>
          <button
            type="button"
            onClick={onRestoreSettings}
            disabled={busy || !settingsDate}
            className="inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-indigo-300 px-2.5 py-2 text-[11px] font-semibold text-indigo-800 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-200 dark:hover:bg-zinc-900 sm:w-auto"
          >
            <CloudDownload className="h-3.5 w-3.5" /> {t('drive.restore', language)}
          </button>
        </div>

        <div className="grid gap-4 border-t border-indigo-200 pt-4 dark:border-indigo-900/60 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              {t('drive.localBooks', language)}
            </h3>
            {localBooks.length ? (
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {localBooks.map((book) => (
                  <div key={book.id} className="flex min-w-0 flex-col gap-2 rounded-lg bg-white/70 px-2.5 py-2 dark:bg-zinc-900/60">
                    <span className="block min-w-0 break-words text-[11px] text-zinc-700 dark:text-zinc-300">{book.title}</span>
                    <button
                      type="button"
                      onClick={() => onUploadBook(book)}
                      disabled={busy}
                      className="inline-flex min-h-10 w-full max-w-full self-stretch items-center justify-center gap-1.5 rounded-md bg-indigo-100/70 px-2.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60 sm:w-auto sm:self-end"
                      aria-label={`${t('drive.ariaSave', language)} ${book.title}`}
                      title={t('drive.uploadTitle', language)}
                    >
                      <CloudUpload className="h-3.5 w-3.5" />
                      <span>{t('drive.upload', language)}</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {t('drive.noLocalBooks', language)}
              </p>
            )}
            <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
              {t('drive.uploadNote', language)}
            </p>
          </div>

          <div>
            <div className="mb-2 flex min-w-0 items-center gap-2">
              <h3 className="mr-auto min-w-0 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                {t('drive.books', language)}
              </h3>
              <button
                type="button"
                onClick={onRefreshBooks}
                disabled={busy}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-white disabled:opacity-50 dark:hover:bg-zinc-800"
                aria-label={t('drive.ariaRefresh', language)}
                title={t('drive.refreshTitle', language)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mb-2 text-[10px] text-zinc-500 dark:text-zinc-400">
              {t('drive.cloudNotice', language)}
            </p>
            {cloudBooks.length ? (
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {cloudBooks.map((book) => {
                  const isExisting = localBooks.some((localBook) => localBook.title === book.title && localBook.creator === book.creator);
                  return (
                    <div key={book.id} className="flex min-w-0 flex-col gap-2 rounded-lg bg-white/70 px-2.5 py-2 dark:bg-zinc-900/60 sm:flex-row sm:items-center">
                      <BookCoverThumbnail src={book.coverDataUrl} title={book.title} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] text-zinc-700 dark:text-zinc-300">{book.title}</span>
                        <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">
                          {(book.size / 1024 / 1024).toFixed(1)} MB
                          {book.creator ? ` · ${book.creator}` : ''}
                        </span>
                      </span>
                      <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                        <button
                          type="button"
                          onClick={() => onDownloadBook(book)}
                          disabled={busy}
                          className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-indigo-100/70 px-2.5 py-2 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60 sm:flex-none"
                          aria-label={`${isExisting ? t('drive.ariaRestore', language) : t('drive.ariaDownload', language)} ${book.title}`}
                          title={isExisting ? t('drive.ariaRestore', language) : t('drive.ariaDownload', language)}
                        >
                          <CloudDownload className="h-4 w-4" />
                          <span className="text-[10px] font-semibold">
                            {isExisting ? t('drive.update', language) : t('drive.download', language)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteBook(book)}
                          disabled={busy}
                          className="inline-flex min-h-10 w-10 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                          aria-label={`${t('drive.ariaDelete', language)} ${book.title} ${t('drive.titleDrive', language)}`}
                          title={t('drive.deleteTitle', language)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {t('drive.noCloudBooks', language)}
              </p>
            )}
          </div>
        </div>
        <p className="border-t border-indigo-200 pt-3 text-[10px] text-zinc-500 dark:border-indigo-900/60 dark:text-zinc-400">
          {t('drive.footerNotice', language)}
        </p>
      </div>
    )}
  </section>
);
