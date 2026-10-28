import React from 'react';
import { createPortal } from 'react-dom';
import { CloudDownload, Smartphone } from 'lucide-react';
import { useLanguage, useT } from '../i18n/LanguageContext';

export interface DriveConflict {
  /** The device that wrote to Drive last; null when an older version did (it did not say). */
  deviceName: string | null;
  savedAt: string | null;
  /** The book being read, with its position here and in Drive, already worded. */
  book?: { title: string; from: string | null; to: string | null };
}

interface Props {
  conflict: DriveConflict | null;
  onLoad: () => void;
  onKeep: () => void;
}

/** Asks whether Drive's data, saved by another device, replaces this device's. */
export const DriveConflictModal: React.FC<Props> = ({ conflict, onLoad, onKeep }) => {
  const t = useT();
  const language = useLanguage();
  if (!conflict) return null;

  const date = conflict.savedAt ? new Date(conflict.savedAt) : null;
  const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleString(language) : null;
  const book = conflict.book;
  let move: string | null = null;
  if (book?.to && book.from && book.from !== book.to) move = t('driveConflict.move', { title: book.title, from: book.from, to: book.to });
  else if (book?.to && book.from === book.to) move = t('driveConflict.same', { title: book.title, to: book.to });
  else if (book?.to) move = t('driveConflict.moveTo', { title: book.title, to: book.to });

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="drive-conflict-title"
        aria-describedby="drive-conflict-text"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-t-2xl border border-zinc-200 bg-white p-5 text-left shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
      >
        <h2 id="drive-conflict-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {t('driveConflict.title')}
        </h2>
        <div id="drive-conflict-text" className="mt-3 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
          <p>
            {conflict.deviceName
              ? t(when ? 'driveConflict.lastSaved' : 'driveConflict.lastSavedNoDate', { device: conflict.deviceName, date: when ?? '' })
              : t('driveConflict.olderVersion')}
          </p>
          {move && <p className="rounded-lg bg-indigo-50 px-3 py-2 font-medium text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200">{move}</p>}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('driveConflict.explain')}</p>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onLoad}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 active:scale-95"
          >
            <CloudDownload className="h-4 w-4" /> {t('driveConflict.load')}
          </button>
          <button
            type="button"
            onClick={onKeep}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Smartphone className="h-4 w-4" /> {t('driveConflict.keep')}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
};
