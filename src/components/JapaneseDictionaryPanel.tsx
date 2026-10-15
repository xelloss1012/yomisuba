import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookA, Download, Loader2, Trash2 } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';
import {
  deleteJapaneseDictionary,
  downloadJapaneseDictionary,
  getJapaneseDictionaryStatus,
  JAPANESE_DICTIONARY_APPROX_BYTES,
  JapaneseDictionaryStatus,
} from '../utils/japaneseDictionary';

const formatMegabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** Download, update or remove the optional Japanese–Japanese dictionary. */
export const JapaneseDictionaryPanel: React.FC = () => {
  const t = useT();
  const [status, setStatus] = useState<JapaneseDictionaryStatus | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const refreshStatus = useCallback(() => {
    void getJapaneseDictionaryStatus().then(setStatus);
  }, []);

  useEffect(() => {
    refreshStatus();
    // Closing the settings mid-download cancels it instead of leaving it orphaned.
    return () => abortRef.current?.abort();
  }, [refreshStatus]);

  const handleDownload = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setError('');
    setPercent(0);
    try {
      await downloadJapaneseDictionary(({ loaded, total }) => {
        setPercent(Math.min(100, Math.round((loaded / total) * 100)));
      }, controller.signal);
      refreshStatus();
    } catch (downloadError) {
      if (controller.signal.aborted) return;
      setError(t('jaDict.error', {
        message: downloadError instanceof Error ? downloadError.message : String(downloadError),
      }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPercent(null);
    }
  };

  const handleDelete = async () => {
    await deleteJapaneseDictionary();
    refreshStatus();
  };

  const isDownloading = percent !== null;
  const buttonClass = 'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60';

  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900 dark:text-emerald-200">
        <BookA className="h-4 w-4" /> {t('jaDict.title')}
      </div>
      <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
        {t('jaDict.description', { size: formatMegabytes(JAPANESE_DICTIONARY_APPROX_BYTES) })}
      </p>
      {status?.installed && (
        <p className="mt-1 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
          {t('jaDict.installed', { size: formatMegabytes(status.size) })}
          {status.outdated && ` · ${t('jaDict.updateAvailable')}`}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {(!status?.installed || status.outdated) && (
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={isDownloading || !status}
            className={`${buttonClass} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}
          >
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isDownloading
              ? t('jaDict.downloading', { percent: percent ?? 0 })
              : status?.installed ? t('jaDict.update') : t('jaDict.download')}
          </button>
        )}
        {isDownloading && (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className={`${buttonClass} border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
          >
            {t('common.cancel')}
          </button>
        )}
        {status?.installed && !isDownloading && (
          <button
            type="button"
            onClick={() => void handleDelete()}
            className={`${buttonClass} border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
          >
            <Trash2 className="h-4 w-4" /> {t('jaDict.delete')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
};
