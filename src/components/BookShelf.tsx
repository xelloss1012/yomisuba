import React from 'react';
import { CloudDownload, CloudUpload, CloudOff, Trash2, Check, Smartphone, Clock3, Cloud } from 'lucide-react';
import { GoogleDriveBook } from '../utils/googleDriveBackup';
import { RecentBook } from '../utils/recentBooks';
import { BookCoverThumbnail } from './BookCoverThumbnail';
import { useT } from '../i18n/LanguageContext';

interface Props {
  recentBooks: RecentBook[];
  cloudBooks: GoogleDriveBook[];
  signedIn: boolean;
  isLoading: boolean;
  isDriveBusy: boolean;
  onOpenRecent: (book: RecentBook) => void;
  onRemoveRecentBook: (book: RecentBook) => void;
  onUploadDriveBook: (book: RecentBook) => void;
  onDownloadDriveBook: (book: GoogleDriveBook) => void;
  onDeleteDriveBook: (book: GoogleDriveBook) => void;
}

const actionClass =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const softAction = `${actionClass} bg-indigo-100/70 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60`;
const quietAction = `${actionClass} text-zinc-500 hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300`;

/** The same book, as stored on this device and in Drive: Drive keeps the title and author. */
const sameBook = (local: RecentBook, cloud: GoogleDriveBook) => local.title === cloud.title && local.creator === cloud.creator;

/**
 * Every book in one place: the ones on this device (with their Drive actions next to them) and,
 * when connected, the ones that only exist in Drive and can be downloaded.
 */
export const BookShelf: React.FC<Props> = ({
  recentBooks,
  cloudBooks,
  signedIn,
  isLoading,
  isDriveBusy,
  onOpenRecent,
  onRemoveRecentBook,
  onUploadDriveBook,
  onDownloadDriveBook,
  onDeleteDriveBook,
}) => {
  const t = useT();
  const cloudOnly = cloudBooks.filter((cloud) => !recentBooks.some((local) => sameBook(local, cloud)));

  return (
    <>
      <section className="mt-6 text-left">
        <div className="mb-3 flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t('shelf.title')}</h2>
        </div>

        {recentBooks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 px-3 py-4 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            {t('shelf.empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {recentBooks.map((book) => {
              const cloud = cloudBooks.find((candidate) => sameBook(book, candidate));
              return (
                <li
                  key={book.id}
                  className="min-w-0 rounded-xl border border-zinc-200 bg-white/70 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-800/60"
                >
                  <div className="flex min-w-0 items-center">
                  <button
                    type="button"
                    onClick={() => onOpenRecent(book)}
                    disabled={isLoading}
                    className="block min-w-0 flex-1 py-1 pl-1 text-left transition-colors hover:text-indigo-700 disabled:opacity-50 dark:hover:text-indigo-300"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <BookCoverThumbnail cover={book.cover} title={book.title} />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">{book.title}</span>
                        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{book.creator || book.name}</span>
                        {signedIn && (
                          <span className={`mt-1 inline-flex items-center gap-1 text-[10px] font-medium ${cloud ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                            {cloud ? <Check className="h-3 w-3" /> : <Smartphone className="h-3 w-3" />}
                            {cloud ? t('shelf.inDrive') : t('shelf.deviceOnly')}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveRecentBook(book)}
                    disabled={isLoading || isDriveBusy}
                    title={t('shelf.removeDevice')}
                    aria-label={`${t('shelf.removeDevice')}: ${book.title}`}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  </div>
                  {signedIn && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-1.5 dark:border-zinc-700/60">
                    {!cloud && (
                      <button
                        type="button"
                        onClick={() => onUploadDriveBook(book)}
                        disabled={isDriveBusy}
                        title={t('drive.uploadTitle')}
                        aria-label={`${t('drive.ariaSave')} ${book.title}`}
                        className={softAction}
                      >
                        <CloudUpload className="h-3.5 w-3.5" /> {t('drive.upload')}
                      </button>
                    )}
                    {cloud && (
                      <button
                        type="button"
                        onClick={() => onDeleteDriveBook(cloud)}
                        disabled={isDriveBusy}
                        title={t('drive.deleteTitle')}
                        aria-label={`${t('drive.ariaDelete')} ${book.title} ${t('drive.titleDrive')}`}
                        className={quietAction}
                      >
                        <CloudOff className="h-3.5 w-3.5" /> {t('shelf.removeDrive')}
                      </button>
                    )}
                  </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {signedIn && cloudOnly.length > 0 && (
        <section className="mt-6 text-left">
          <div className="mb-1 flex items-center gap-2">
            <Cloud className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t('shelf.cloudTitle')}</h2>
          </div>
          <p className="mb-3 text-[11px] text-zinc-500 dark:text-zinc-400">{t('shelf.cloudHint')}</p>
          <ul className="space-y-2">
            {cloudOnly.map((book) => (
              <li
                key={book.id}
                className="min-w-0 rounded-xl border border-zinc-200 bg-white/70 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-800/60"
              >
                <span className="flex min-w-0 items-center gap-3 py-1 pl-1">
                  <BookCoverThumbnail src={book.coverDataUrl} title={book.title} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">{book.title}</span>
                    <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {book.creator ? `${book.creator} · ` : ''}{(book.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </span>
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-1.5 dark:border-zinc-700/60">
                  <button
                    type="button"
                    onClick={() => onDownloadDriveBook(book)}
                    disabled={isDriveBusy}
                    title={t('drive.ariaDownload')}
                    aria-label={`${t('drive.ariaDownload')} ${book.title}`}
                    className={softAction}
                  >
                    <CloudDownload className="h-3.5 w-3.5" /> {t('drive.download')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteDriveBook(book)}
                    disabled={isDriveBusy}
                    title={t('drive.deleteTitle')}
                    aria-label={`${t('drive.ariaDelete')} ${book.title} ${t('drive.titleDrive')}`}
                    className={`${quietAction} ml-auto`}
                  >
                    <CloudOff className="h-3.5 w-3.5" /> {t('shelf.removeDrive')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
};
