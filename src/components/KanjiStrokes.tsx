import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Brush, Download, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useLanguage, useT } from '../i18n/LanguageContext';
import {
  deleteKanjiExtra,
  downloadKanjiExtra,
  getKanjiExtraStatus,
  KANJI_EXTRA,
  KanjiExtraData,
  KanjiExtraStatus,
  loadKanjiExtra,
  onKanjiExtraChange,
} from '../utils/kanjiExtra';

const STROKE_SECONDS = 0.55;

/** The optional kanji data, or null while it loads or when it is not installed; follows downloads and removals. */
export const useKanjiExtra = (): KanjiExtraData | null => {
  const [data, setData] = useState<KanjiExtraData | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadKanjiExtra()
        .then((result) => { if (!cancelled) setData(result); })
        .catch((error) => console.error('[kanji-extra]', error));
    };
    refresh();
    const unsubscribe = onKanjiExtraChange(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return data;
};

/** Where a stroke starts, to number it there. */
const startOf = (path: string): [number, number] | null => {
  const match = /^M\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/.exec(path);
  return match ? [Number(match[1]), Number(match[2])] : null;
};

/** The strokes of a kanji drawn in the order they are written, each numbered where it starts. */
export const KanjiStrokes: React.FC<{ strokes: string[]; kanji: string }> = ({ strokes, kanji }) => {
  const t = useT();
  const [run, setRun] = useState(0);
  return (
    <div className="flex items-end gap-2">
      <svg
        key={run}
        viewBox="0 0 109 109"
        role="img"
        aria-label={t('kanji.strokeOrderOf', { kanji, count: strokes.length })}
        className="h-36 w-36 rounded-lg border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      >
        <path d="M54.5 0V109M0 54.5H109" className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth="0.5" strokeDasharray="2 2" />
        {strokes.map((path, index) => (
          <path key={`ghost-${index}`} d={path} fill="none" className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {strokes.map((path, index) => (
          <path
            key={index}
            d={path}
            pathLength={1}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="kanji-stroke"
            style={{ animationDelay: `${index * STROKE_SECONDS}s` }}
          />
        ))}
        {strokes.map((path, index) => {
          const start = startOf(path);
          return start ? (
            <text key={`n-${index}`} x={start[0] - 4} y={start[1] - 2} fontSize="8" className="fill-rose-500" textAnchor="middle">{index + 1}</text>
          ) : null;
        })}
      </svg>
      <button
        type="button"
        onClick={() => setRun((value) => value + 1)}
        className="tap-area rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label={t('kanji.replayStrokes')}
        title={t('kanji.replayStrokes')}
      >
        <RotateCcw className="h-4 w-4" />
      </button>
    </div>
  );
};

const formatMegabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/**
 * Download, update or remove the optional kanji data. `compact` is the offer inside a kanji card (only
 * when it is not installed); otherwise, the panel of the settings.
 */
export const KanjiExtraPanel: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const t = useT();
  const language = useLanguage();
  const [status, setStatus] = useState<KanjiExtraStatus | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => { void getKanjiExtraStatus().then(setStatus); }, []);
  useEffect(() => {
    refresh();
    const unsubscribe = onKanjiExtraChange(refresh);
    return () => {
      unsubscribe();
      abortRef.current?.abort();
    };
  }, [refresh]);

  const download = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setError('');
    setPercent(0);
    try {
      await downloadKanjiExtra(({ loaded, total }) => setPercent(Math.min(100, Math.round((loaded / total) * 100))), controller.signal);
    } catch (downloadError) {
      if (!controller.signal.aborted) {
        setError(t('dict.error', { message: downloadError instanceof Error ? downloadError.message : String(downloadError) }));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPercent(null);
    }
  };

  if (!status || (compact && status.installed)) return null;
  const isDownloading = percent !== null;
  const description = t('kanji.extraDescription', {
    strokes: KANJI_EXTRA.strokes.toLocaleString(language),
    kanji: KANJI_EXTRA.rareKanji.toLocaleString(language),
    size: formatMegabytes(KANJI_EXTRA.approxBytes),
  });
  const buttonClass = 'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60';

  return (
    <div className={compact
      ? 'rounded-lg border border-dashed border-indigo-300 bg-indigo-50/50 p-2.5 dark:border-indigo-800 dark:bg-indigo-950/20'
      : 'rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20'}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
        <Brush className="h-4 w-4" /> {t('kanji.extraTitle')}
      </div>
      <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
        {description}{' '}
        <a href="https://kanjivg.tagaini.net" target="_blank" rel="noreferrer" className="underline">KanjiVG</a> (CC BY-SA 3.0) ·{' '}
        <a href="https://www.edrdg.org/wiki/index.php/KANJIDIC_Project" target="_blank" rel="noreferrer" className="underline">KANJIDIC2</a> (CC BY-SA 4.0)
      </p>
      {status.installed && (
        <p className="mt-1 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
          {t('dict.installed', { size: formatMegabytes(status.size) })}
          {status.outdated && ` · ${t('dict.updateAvailable')}`}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {(!status.installed || status.outdated) && (
          <button
            type="button"
            onClick={() => void download()}
            disabled={isDownloading}
            className={`${buttonClass} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}
          >
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isDownloading ? t('dict.downloading', { percent: percent ?? 0 }) : status.installed ? t('dict.update') : t('dict.download')}
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
        {status.installed && !isDownloading && (
          <button
            type="button"
            onClick={() => void deleteKanjiExtra()}
            className={`${buttonClass} border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
          >
            <Trash2 className="h-4 w-4" /> {t('dict.delete')}
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
};
