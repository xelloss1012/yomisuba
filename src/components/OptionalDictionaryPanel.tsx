import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookA, Download, Loader2, Trash2 } from 'lucide-react';
import { useLanguage, useT, useTranslationLanguage } from '../i18n/LanguageContext';
import { languageName } from '../utils/i18n';
import { KanjiExtraPanel } from './KanjiStrokes';
import {
  deleteOptionalDictionary,
  downloadOptionalDictionary,
  getOptionalDictionaryStatus,
  isOptionalDictionaryId,
  onOptionalDictionaryChange,
  OPTIONAL_DICTIONARIES,
  OptionalDictionaryId,
  OptionalDictionaryStatus,
} from '../utils/optionalDictionaries';

const formatMegabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/**
 * The dictionaries that apply to the current languages (the translation
 * language's own one and, with a Japanese interface, the Japanese–Japanese one),
 * plus any other that is already installed so it can still be removed.
 */
export const DownloadableDictionariesSection: React.FC = () => {
  const t = useT();
  const language = useLanguage();
  const translationLanguage = useTranslationLanguage();
  const [installed, setInstalled] = useState<OptionalDictionaryId[]>([]);

  useEffect(() => {
    let cancelled = false;
    const ids = Object.keys(OPTIONAL_DICTIONARIES) as OptionalDictionaryId[];
    const refresh = () => {
      void Promise.all(ids.map(async (id) => ((await getOptionalDictionaryStatus(id)).installed ? id : null)))
        .then((found) => { if (!cancelled) setInstalled(found.filter((id): id is OptionalDictionaryId => id !== null)); });
    };
    refresh();
    const unsubscribe = onOptionalDictionaryChange(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const relevant = [
    ...(language === 'ja' ? ['ja'] : []),
    ...(isOptionalDictionaryId(translationLanguage) ? [translationLanguage] : []),
  ] as OptionalDictionaryId[];
  const shown = [...new Set([...relevant, ...installed])];

  return (
    <div className="mt-3 space-y-2">
      <div>
        <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('dict.sectionTitle')}</span>
        <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">{t('dict.sectionHint')}</span>
      </div>
      {shown.map((id) => <OptionalDictionaryPanel key={id} id={id} />)}
      {/* Stroke order and rare kanji: for every language. */}
      <KanjiExtraPanel />
    </div>
  );
};

/** Download, update or remove one optional dictionary. */
export const OptionalDictionaryPanel: React.FC<{ id: OptionalDictionaryId }> = ({ id }) => {
  const t = useT();
  const language = useLanguage();
  const info = OPTIONAL_DICTIONARIES[id];
  const [status, setStatus] = useState<OptionalDictionaryStatus | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const refreshStatus = useCallback(() => {
    void getOptionalDictionaryStatus(id).then(setStatus);
  }, [id]);

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
      await downloadOptionalDictionary(id, ({ loaded, total }) => {
        setPercent(Math.min(100, Math.round((loaded / total) * 100)));
      }, controller.signal);
      refreshStatus();
    } catch (downloadError) {
      if (controller.signal.aborted) return;
      setError(t('dict.error', {
        message: downloadError instanceof Error ? downloadError.message : String(downloadError),
      }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPercent(null);
    }
  };

  const handleDelete = async () => {
    await deleteOptionalDictionary(id);
    refreshStatus();
  };

  const isMonolingual = id === 'ja';
  const glossLanguage = languageName(id, language);
  const descriptionParams = {
    language: glossLanguage,
    entries: info.entries.toLocaleString(language),
    size: formatMegabytes(info.approxBytes),
  };
  const isDownloading = percent !== null;
  const buttonClass = 'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60';

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900 dark:text-emerald-200">
        <BookA className="h-4 w-4" />
        {isMonolingual ? t('dict.titleMonolingual') : t('dict.title', { language: glossLanguage })}
      </div>
      <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
        {t(isMonolingual ? 'dict.descriptionMonolingual' : 'dict.description', descriptionParams)}
        {' '}
        <a href={info.source.url} target="_blank" rel="noreferrer" className="underline">{info.source.label}</a>
        {' · '}
        <a href={info.license.url} target="_blank" rel="noreferrer" className="underline">{info.license.label}</a>
      </p>
      {status?.installed && (
        <p className="mt-1 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
          {t('dict.installed', { size: formatMegabytes(status.size) })}
          {status.outdated && ` · ${t('dict.updateAvailable')}`}
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
              ? t('dict.downloading', { percent: percent ?? 0 })
              : status?.installed ? t('dict.update') : t('dict.download')}
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
            <Trash2 className="h-4 w-4" /> {t('dict.delete')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
};
