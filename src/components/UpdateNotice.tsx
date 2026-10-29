import React, { useEffect, useState } from 'react';
import { useT } from '../i18n/LanguageContext';
import {
  AvailableUpdate,
  checkForUpdate,
  dismissUpdate,
  isUpdateDismissed,
} from '../utils/updateCheck';
import { UpdateInstallButton } from './UpdateInstallButton';

interface Props {
  /** The reader's preference; nothing is asked of GitHub while it is off. */
  enabled: boolean;
}

/** Tells the reader a newer release exists and installs it (in the Android app) or links to its APK. */
export const UpdateNotice: React.FC<Props> = ({ enabled }) => {
  const t = useT();
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);

  useEffect(() => {
    if (!enabled) {
      setUpdate(null);
      return undefined;
    }
    let cancelled = false;
    void checkForUpdate().then((found) => {
      if (!cancelled) setUpdate(found && !isUpdateDismissed(found.version) ? found : null);
    });
    return () => { cancelled = true; };
  }, [enabled]);

  if (!update) return null;

  return (
    <div
      role="status"
      className="mb-6 flex flex-col items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs dark:border-indigo-800 dark:bg-indigo-950/60"
    >
      <p className="font-semibold text-indigo-900 dark:text-indigo-200">{t('update.available', { version: update.version })}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <UpdateInstallButton
          update={update}
          label={t('update.download')}
          installLabel={t('update.install')}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700"
        />
        <a
          href={update.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center px-2 font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
        >
          {t('update.notes')}
        </a>
        <button
          type="button"
          onClick={() => { dismissUpdate(update.version); setUpdate(null); }}
          className="inline-flex min-h-9 items-center px-2 text-zinc-600 hover:underline dark:text-zinc-400"
        >
          {t('update.later')}
        </button>
      </div>
    </div>
  );
};
