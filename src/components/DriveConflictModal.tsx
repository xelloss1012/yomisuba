import React from 'react';
import { createPortal } from 'react-dom';
import { CloudDownload, Smartphone } from 'lucide-react';
import { useLanguage, useT } from '../i18n/LanguageContext';
import type { PaginationMode } from '../types/epub';
import type { PositionComparison } from '../utils/driveDevice';

export interface DriveConflict {
  /** The device that wrote to Drive last; null when an older version did (it did not say). */
  deviceName: string | null;
  savedAt: string | null;
  /** The way of counting pages the person uses, shown first. */
  paginationMode: PaginationMode;
  /** The book being read, with its position here and in Drive. */
  book?: { title: string; comparison: PositionComparison };
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
  const comparison = book?.comparison;
  const of = (value: number | null, total: number | null) => (value === null
    ? '—'
    : total ? t('driveConflict.valueOf', { value, total }) : String(value));
  const rows: { mode: PaginationMode | 'chapter'; label: string; from: string; to: string }[] = [];
  if (comparison?.device) {
    const { device } = comparison;
    rows.push({
      mode: 'device',
      label: device.layout === 'here'
        ? t('driveConflict.rowDevice')
        : conflict.deviceName ? t('driveConflict.rowDeviceOf', { device: conflict.deviceName }) : t('driveConflict.rowDeviceOther'),
      from: of(device.from, device.total),
      to: of(device.to, device.total),
    });
  }
  if (comparison?.printed) {
    rows.push({ mode: 'printed', label: t('driveConflict.rowPrinted'), from: of(comparison.printed.from, comparison.printed.total), to: of(comparison.printed.to, comparison.printed.total) });
  }
  if (comparison && (comparison.percent.from !== null || comparison.percent.to !== null)) {
    const percent = (value: number | null) => (value === null ? '—' : `${value}%`);
    rows.push({ mode: 'percent', label: t('driveConflict.rowPercent'), from: percent(comparison.percent.from), to: percent(comparison.percent.to) });
  }
  if (comparison) {
    rows.push({ mode: 'chapter', label: t('driveConflict.rowChapter'), from: of(comparison.chapter.from, comparison.chapter.total), to: of(comparison.chapter.to, comparison.chapter.total) });
  }
  // The way of counting the person uses goes first; the rest follow for reference.
  rows.sort((a, b) => Number(b.mode === conflict.paginationMode) - Number(a.mode === conflict.paginationMode));

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
          {book && rows.length > 0 && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
              <p className="px-3 pt-2 font-medium text-zinc-900 dark:text-zinc-100">{t('driveConflict.where', { title: book.title })}</p>
              <table className="mt-1 w-full text-left text-xs">
                <thead>
                  <tr className="text-zinc-500 dark:text-zinc-400">
                    <th scope="col" className="px-3 py-1 font-normal"><span className="sr-only">{t('driveConflict.rowKind')}</span></th>
                    <th scope="col" className="px-2 py-1 font-normal">{t('driveConflict.here')}</th>
                    <th scope="col" className="px-3 py-1 font-normal">{t('driveConflict.drive')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const current = row.mode === conflict.paginationMode;
                    return (
                      <tr
                        key={row.mode}
                        className={current
                          ? 'bg-indigo-50 font-medium text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200'
                          : 'border-t border-zinc-100 dark:border-zinc-800'}
                      >
                        <th scope="row" className="px-3 py-1.5 font-normal">
                          {row.label}
                          {current && <span className="block text-[11px] opacity-75">{t('driveConflict.current')}</span>}
                        </th>
                        <td className="whitespace-nowrap px-2 py-1.5">{row.from}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">{row.to}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
