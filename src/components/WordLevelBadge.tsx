import React, { useEffect, useState } from 'react';
import { useT } from '../i18n/LanguageContext';
import { loadWordLevels, WordLevel, WordLevelsData } from '../utils/wordLevels';

let loaded: WordLevelsData | null = null;

/** The word level data, or null while it loads (the first caller triggers it). */
export const useWordLevels = (): WordLevelsData | null => {
  const [data, setData] = useState<WordLevelsData | null>(loaded);
  useEffect(() => {
    if (data) return;
    let cancelled = false;
    loadWordLevels()
      .then((result) => {
        loaded = result;
        if (!cancelled) setData(result);
      })
      .catch((error) => console.error('[wordLevels]', error));
    return () => { cancelled = true; };
  }, [data]);
  return data;
};

type Tier = 'easy' | 'medium' | 'hard' | 'rare';

const tierOf = (level: WordLevel): Tier => {
  if (level.jlpt) return level.jlpt >= 4 ? 'easy' : level.jlpt >= 2 ? 'medium' : 'hard';
  return { basic: 'easy', common: 'medium', uncommon: 'hard', rare: 'rare' }[level.band] as Tier;
};

const tierClasses: Record<Tier, string> = {
  easy: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200',
  medium: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-200',
  hard: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200',
  rare: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-200',
};

const BAND_HINTS = {
  basic: 'level.hintBasic',
  common: 'level.hintCommon',
  uncommon: 'level.hintUncommon',
  rare: 'level.hintRare',
} as const;

/**
 * How useful a word is: its JLPT level when it has one (N5 … N1), otherwise its
 * frequency band. Green words are worth learning first; red ones can wait.
 */
export const WordLevelBadge: React.FC<{ level: WordLevel | null; className?: string }> = ({ level, className = '' }) => {
  const t = useT();
  if (!level) return null;
  const label = level.jlpt ? `N${level.jlpt}` : t(`level.${level.band}`);
  const hint = level.jlpt
    ? `${t('level.hintJlpt', { level: label })} · ${t(BAND_HINTS[level.band])}`
    : t(BAND_HINTS[level.band]);
  return (
    <span
      title={hint}
      aria-label={hint}
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${tierClasses[tierOf(level)]} ${className}`}
    >
      {label}
    </span>
  );
};
