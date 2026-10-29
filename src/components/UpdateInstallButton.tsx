import React, { useState } from 'react';
import { Download, Loader2, Settings } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';
import {
  allowInstallingPackages,
  canInstallInApp,
  canInstallPackages,
  downloadAndInstallUpdate,
} from '../utils/appUpdater';
import type { AvailableUpdate } from '../utils/updateCheck';

interface Props {
  update: AvailableUpdate;
  /** What the link to the APK says (outside the Android app). */
  label: string;
  /** What the button says in the Android app, which installs the update itself. */
  installLabel: string;
  className: string;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'permission' }
  | { kind: 'downloading'; fraction: number | null }
  | { kind: 'installing' }
  | { kind: 'failed'; message: string };

/**
 * In the Android app, downloads the update and opens Android's installer with it; the first time, it
 * asks the reader to allow Yomisuba to install apps. Elsewhere, or if anything fails, it is a link to
 * the APK, as before.
 */
export const UpdateInstallButton: React.FC<Props> = ({ update, label, installLabel, className }) => {
  const t = useT();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const link = update.apkUrl ?? update.releaseUrl;

  const downloadLink = (text: string, linkClass = className) => (
    <a href={link} target="_blank" rel="noopener noreferrer" className={linkClass}>
      <Download className="h-3.5 w-3.5" />
      {text}
    </a>
  );

  if (!canInstallInApp() || !update.apkUrl) return downloadLink(label);

  const install = async () => {
    const url = update.apkUrl;
    if (!url) return;
    try {
      if (!(await canInstallPackages())) {
        setStatus({ kind: 'permission' });
        return;
      }
      setStatus({ kind: 'downloading', fraction: 0 });
      await downloadAndInstallUpdate(url, (fraction) => setStatus({ kind: 'downloading', fraction }));
      setStatus({ kind: 'installing' });
    } catch (error) {
      setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const allow = async () => {
    try {
      if (await allowInstallingPackages()) await install();
    } catch (error) {
      setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const plainLink = 'inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline dark:text-indigo-300';

  if (status.kind === 'downloading') {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 font-semibold text-indigo-700 dark:text-indigo-300">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {status.fraction === null ? t('update.downloadingPlain') : t('update.downloading', { percent: Math.round(status.fraction * 100) })}
      </span>
    );
  }

  if (status.kind === 'permission') {
    return (
      <span role="status" className="flex max-w-xs flex-col items-center gap-1.5 text-center">
        <span className="text-zinc-700 dark:text-zinc-300">{t('update.permission')}</span>
        <button type="button" onClick={() => { void allow(); }} className={className}>
          <Settings className="h-3.5 w-3.5" />
          {t('update.openSettings')}
        </button>
      </span>
    );
  }

  if (status.kind === 'failed') {
    return (
      <span role="alert" className="flex max-w-xs flex-col items-center gap-1 text-center">
        <span className="text-rose-600 dark:text-rose-400">{t('update.installFailed', { message: status.message })}</span>
        {downloadLink(t('update.downloadApk'), plainLink)}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-center gap-1">
      <button type="button" onClick={() => { void install(); }} className={className}>
        <Download className="h-3.5 w-3.5" />
        {status.kind === 'installing' ? t('update.installAgain') : installLabel}
      </button>
      {status.kind === 'installing' && <span role="status" className="text-zinc-600 dark:text-zinc-400">{t('update.confirmInstall')}</span>}
    </span>
  );
};
