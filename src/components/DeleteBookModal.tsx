import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

export interface DeleteBookRequest {
  title: string;
  /** 'device': the book on this device's shelf (and, if asked, its copy in Drive); 'drive': only the copy in Drive. */
  scope: 'device' | 'drive';
  /** The book has a copy in Drive that can be deleted along with it. */
  hasDriveCopy: boolean;
  /** Signed in to Google: without a session a copy in Drive cannot be looked for. */
  signedIn: boolean;
}

export interface DeleteBookChoice {
  alsoDrive: boolean;
  keepData: boolean;
}

interface Props {
  request: DeleteBookRequest | null;
  onConfirm: (choice: DeleteBookChoice) => void;
  onCancel: () => void;
}

/**
 * Asks how a book is removed: by default only the book goes, and its progress, notes and vocabulary
 * stay (they come back if the book is added again, and the vocabulary panel keeps showing them).
 */
export const DeleteBookModal: React.FC<Props> = ({ request, onConfirm, onCancel }) => {
  const t = useT();
  const [alsoDrive, setAlsoDrive] = useState(false);
  const [keepData, setKeepData] = useState(true);

  useEffect(() => {
    setAlsoDrive(false);
    setKeepData(true);
  }, [request]);

  if (!request) return null;
  const drive = request.scope === 'drive' || alsoDrive;
  const hint = keepData
    ? t(request.scope === 'drive' ? 'deleteBook.keepHintDrive' : 'deleteBook.keepHint')
    : t(request.scope === 'drive' ? 'deleteBook.dropHintDrive' : drive ? 'deleteBook.dropHintBoth' : 'deleteBook.dropHint');

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center" onClick={onCancel}>
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-book-title"
        className="w-full max-w-md rounded-t-2xl border border-zinc-200 bg-white p-5 text-left shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="delete-book-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {t(request.scope === 'drive' ? 'deleteBook.titleDrive' : 'deleteBook.title', { title: request.title })}
        </h2>
        <div className="mt-3 space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
          {request.scope === 'device' && request.hasDriveCopy && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={alsoDrive} onChange={(event) => setAlsoDrive(event.target.checked)} />
              <span>{t('deleteBook.alsoDrive')}</span>
            </label>
          )}
          {request.scope === 'device' && !request.signedIn && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('deleteBook.noSession')}</p>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={keepData} onChange={(event) => setKeepData(event.target.checked)} />
            <span>{t('deleteBook.keepData')}</span>
          </label>
          <p className={`rounded-lg px-3 py-2 text-xs ${keepData
            ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
            : 'bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200'}`}
          >
            {hint}
          </p>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={() => onConfirm({ alsoDrive: request.scope === 'drive' || alsoDrive, keepData })}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-rose-700 active:scale-95"
          >
            <Trash2 className="h-4 w-4" /> {t(request.scope === 'drive' ? 'common.delete' : 'deleteBook.remove')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {t('common.cancel')}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
};
