import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';
import { APP_VERSION, AvailableUpdate, checkForUpdate } from '../utils/updateCheck';

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  | { kind: 'failed' }
  | { kind: 'found'; update: AvailableUpdate };

/** The installed version and a button to look for a newer one right now, whatever the last check said. */
export const UpdateCheckNow: React.FC = () => {
  const t = useT();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const check = async () => {
    setStatus({ kind: 'checking' });
    try {
      const update = await checkForUpdate({ force: true });
      setStatus(update ? { kind: 'found', update } : { kind: 'upToDate' });
    } catch {
      setStatus({ kind: 'failed' });
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
      <span>{t('update.version', { version: APP_VERSION })}</span>
      <button
        type="button"
        onClick={() => { void check(); }}
        disabled={status.kind === 'checking'}
        className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline disabled:opacity-60 dark:text-indigo-400"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${status.kind === 'checking' ? 'animate-spin' : ''}`} />
        {t('update.checkNow')}
      </button>
      {status.kind === 'upToDate' && <span role="status">{t('update.upToDate')}</span>}
      {status.kind === 'failed' && <span role="status" className="text-rose-600 dark:text-rose-400">{t('update.checkFailed')}</span>}
      {status.kind === 'found' && (
        <a
          role="status"
          href={status.update.apkUrl ?? status.update.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
        >
          {t('update.foundDownload', { version: status.update.version })}
        </a>
      )}
    </span>
  );
};
