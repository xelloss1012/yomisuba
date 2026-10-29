import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Repeat, X } from 'lucide-react';
import { useLanguage, useT, useTranslationLanguage } from '../i18n/LanguageContext';
import { DictionaryEntry, wordsWithKanji } from '../utils/dictionary';
import { KanjiInfo, kanjiInfo, kanjiOfText, kunReading, loadKanjiData } from '../utils/kanjiInfo';
import { classifyEntry, difficultyOf, kanjiJlpt, WordLevel } from '../utils/wordLevels';
import { kanjiKey, markIgnored, readStudyProgress, resetCard, setCard, writeStudyProgress } from '../utils/studyProgress';
import { useWordLevels, WordLevelBadge } from './WordLevelBadge';
import { KanjiExtraPanel, KanjiStrokes, useKanjiExtra } from './KanjiStrokes';

export interface OwnWord {
  word: string;
  reading: string;
  meaning: string;
}

interface Props {
  /** The kanji to show; null closes the card. */
  kanji: string | null;
  /** The other kanji of the word it was opened from, to go from one to another. */
  siblings?: string[];
  /** The reader's own saved words that write each kanji, shown before the dictionary's. */
  ownWords?: (kanji: string) => OwnWord[];
  /** Whether each kanji is in the reviews, and how to put it in or take it out; by default, the saved progress. */
  review?: KanjiReview;
  onClose: () => void;
}

export interface KanjiReview {
  isIn: (kanji: string) => boolean;
  toggle: (kanji: string) => void;
}

/**
 * Puts a kanji in the reviews or takes it out straight in the saved progress (which the app copies to
 * Drive), for a card opened outside the study panel, which keeps the progress of its own.
 */
const savedProgressReview: KanjiReview = {
  isIn: (kanji) => {
    const card = readStudyProgress().cards[kanjiKey(kanji)];
    return Boolean(card && card.status !== 'ignored');
  },
  toggle: (kanji) => {
    const progress = readStudyProgress();
    const key = kanjiKey(kanji);
    const card = progress.cards[key];
    const now = Date.now();
    writeStudyProgress(setCard(progress, key, card && card.status !== 'ignored' ? markIgnored(card, now) : resetCard(now)));
  },
};

type KanjiData = Awaited<ReturnType<typeof loadKanjiData>>;
let loadedKanji: KanjiData | null = null;

/** The kanji data, or null while it loads (the first caller triggers it). */
export const useKanjiData = (): KanjiData | null => {
  const [data, setData] = useState<KanjiData | null>(loadedKanji);
  useEffect(() => {
    if (data) return undefined;
    let cancelled = false;
    loadKanjiData()
      .then((result) => {
        loadedKanji = result;
        if (!cancelled) setData(result);
      })
      .catch((error) => console.error('[kanji]', error));
    return () => { cancelled = true; };
  }, [data]);
  return data;
};

const EXAMPLES = 8;

/** The level badge of a kanji: its JLPT level, or how basic its school grade is. */
const kanjiLevel = (jlpt: WordLevel['jlpt'], grade: number): WordLevel => ({
  ...(jlpt ? { jlpt } : {}),
  band: grade <= 6 ? 'basic' : grade === 8 ? 'common' : 'uncommon',
});

/** A word with its kanji in bold. */
const withKanji = (word: string, kanji: string) => word.split(kanji).flatMap((part, index) =>
  index ? [<b key={index} className="text-indigo-700 dark:text-indigo-300">{kanji}</b>, part] : [part]);

/**
 * The card of a kanji: meanings, on and kun readings, strokes, level, the parts it is made of (each one a
 * kanji to open in turn), its reading in Chinese, Korean and Vietnamese, and the words that use it.
 */
export const KanjiModal: React.FC<Props> = ({ kanji, siblings = [], ownWords, review = savedProgressReview, onClose }) => {
  const t = useT();
  const language = useLanguage();
  const translationLanguage = useTranslationLanguage();
  const wordLevels = useWordLevels();
  const [current, setCurrent] = useState<string | null>(kanji);
  const [data, setData] = useState<KanjiData | null>(loadedKanji);
  const [failed, setFailed] = useState(false);
  const [examples, setExamples] = useState<DictionaryEntry[] | null>(null);
  // The optional download adds the stroke order and the rare kanji.
  const extra = useKanjiExtra();
  const allKanji = useMemo(() => (data && extra ? { ...extra.kanji, ...data } : data), [data, extra]);
  // Read again after toggling, for the saved progress that is not React state.
  const [, setReviewRevision] = useState(0);

  useEffect(() => { setCurrent(kanji); }, [kanji]);

  useEffect(() => {
    if (!kanji || data) return;
    loadKanjiData().then((result) => { loadedKanji = result; setData(result); }).catch(() => setFailed(true));
  }, [kanji, data]);

  useEffect(() => {
    if (!current) return undefined;
    let cancelled = false;
    setExamples(null);
    wordsWithKanji(current, translationLanguage)
      .then((entries) => { if (!cancelled) setExamples(entries); })
      .catch(() => { if (!cancelled) setExamples([]); });
    return () => { cancelled = true; };
  }, [current, translationLanguage]);

  useEffect(() => {
    if (!kanji) return undefined;
    // Escape closes the card only, not the panel or dialog it was opened from.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [kanji, onClose]);

  // The most useful words first (by level, then the shortest), only the ones that write it.
  const shownExamples = useMemo(() => {
    if (!examples || !current) return [];
    const scored = examples.map((entry) => {
      const written = entry.kanji.find((spelling) => spelling.includes(current)) ?? entry.kanji[0];
      const level = wordLevels ? classifyEntry(wordLevels, entry) : null;
      return { entry, written, level, score: (level ? difficultyOf(level) : 7) * 10 + written.length };
    });
    return scored.sort((a, b) => a.score - b.score).slice(0, EXAMPLES);
  }, [examples, current, wordLevels]);

  if (!kanji || !current) return null;
  const info: KanjiInfo | null = allKanji ? kanjiInfo(allKanji, current, language) : null;
  const strokes = extra?.strokes[current];
  const jlpt = wordLevels ? kanjiJlpt(wordLevels, current) : undefined;
  const gradeLabel = info && (!info.grade ? t('kanji.gradeNone') : info.grade <= 6
    ? t('kanji.gradePrimary', { grade: info.grade })
    : info.grade === 8 ? t('kanji.gradeSecondary') : t('kanji.gradeNames'));

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 py-1.5 text-sm">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="min-w-0 text-zinc-800 dark:text-zinc-200">{value}</span>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('kanji.title')}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white text-left shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {(siblings.length > 1 ? siblings : [current]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCurrent(item)}
                aria-pressed={item === current}
                lang="ja"
                className={`min-h-9 min-w-9 rounded-lg px-2 font-mincho text-lg ${item === current
                  ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'}`}
              >
                {item}
              </button>
            ))}
          </div>
          {(() => {
            const inReview = review.isIn(current);
            return (
              <button
                type="button"
                onClick={() => { review.toggle(current); setReviewRevision((value) => value + 1); }}
                aria-pressed={inReview}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border px-2 text-xs font-semibold ${inReview
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
                  : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'}`}
              >
                <Repeat className="h-3.5 w-3.5" /> {t(inReview ? 'study.inReview' : 'study.addToReview')}
              </button>
            );
          })()}
          <button type="button" onClick={onClose} className="tap-area shrink-0 rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={t('nav.close')}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="flex items-start gap-4">
            <p lang="ja" className="font-mincho text-7xl leading-none text-zinc-900 dark:text-zinc-100">{current}</p>
            <div className="min-w-0 flex-1 pt-1">
              {info ? (
                <>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {info.meanings.join(', ')}
                    {info.meaningLanguage !== language && <span className="ml-1 text-[10px] font-normal text-zinc-500">({info.meaningLanguage})</span>}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                    <WordLevelBadge level={kanjiLevel(jlpt, info.grade)} />
                    <span>{t('kanji.strokes', { count: info.strokes })}</span>
                    <span>· {gradeLabel}</span>
                    {info.frequency && <span>· {t('kanji.frequency', { rank: info.frequency })}</span>}
                  </div>
                </>
              ) : failed ? (
                <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{t('err.kanjiLoad')}</p>
              ) : data ? (
                <div className="space-y-2">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{t(extra ? 'kanji.unknownAnywhere' : 'kanji.unknown')}</p>
                  {!extra && <KanjiExtraPanel compact />}
                </div>
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
              )}
            </div>
          </div>

          {info && (
            <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
              {info.on.length > 0 && row(t('kanji.on'), <span lang="ja">{info.on.join('、')}</span>)}
              {info.kun.length > 0 && row(t('kanji.kun'), <span lang="ja">{info.kun.map(kunReading).join('、')}</span>)}
              {info.names.length > 0 && row(t('kanji.names'), <span lang="ja" className="text-xs text-zinc-600 dark:text-zinc-400">{info.names.join('、')}</span>)}
              {info.parts.length > 0 && row(t('kanji.parts'), (
                <span className="flex flex-wrap gap-1">
                  {info.parts.map((part) => allKanji && allKanji[part] && part !== current ? (
                    <button key={part} type="button" onClick={() => setCurrent(part)} lang="ja" className="min-h-8 min-w-8 rounded-md border border-zinc-200 px-1.5 font-mincho text-base text-indigo-700 hover:bg-indigo-50 dark:border-zinc-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
                      {part}
                    </button>
                  ) : (
                    <span key={part} lang="ja" className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md bg-zinc-100 px-1.5 font-mincho text-base text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{part}</span>
                  ))}
                </span>
              ))}
              {(info.pinyin.length > 0 || info.korean.length > 0 || info.vietnamese.length > 0) && row(t('kanji.otherLanguages'), (
                <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  {info.pinyin.length > 0 && <span>{t('kanji.chinese')}: {info.pinyin.join(', ')}</span>}
                  {info.korean.length > 0 && <span>{t('kanji.korean')}: <span lang="ko">{info.korean.join(', ')}</span></span>}
                  {info.vietnamese.length > 0 && <span>{t('kanji.vietnamese')}: {info.vietnamese.join(', ')}</span>}
                </span>
              ))}
            </div>
          )}

          {strokes ? (
            <>
              <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('kanji.strokeOrder')}</h3>
              <div className="mt-1"><KanjiStrokes key={current} strokes={strokes} kanji={current} /></div>
            </>
          ) : info && !extra ? (
            <div className="mt-4"><KanjiExtraPanel compact /></div>
          ) : null}

          {(() => {
            const own = ownWords?.(current) ?? [];
            if (!own.length) return null;
            return (
              <>
                <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('kanji.ownWords')}</h3>
                <ul className="mt-1 space-y-1.5">
                  {own.map((item) => (
                    <li key={item.word} className="rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 dark:border-amber-900/60 dark:bg-amber-950/20">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span lang="ja" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{withKanji(item.word, current)}</span>
                        {item.reading && item.reading !== item.word && <span lang="ja" className="text-xs text-zinc-500 dark:text-zinc-400">{item.reading}</span>}
                      </span>
                      <span className="block truncate text-xs text-zinc-700 dark:text-zinc-300">{item.meaning}</span>
                    </li>
                  ))}
                </ul>
              </>
            );
          })()}

          <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('kanji.examples')}</h3>
          {examples === null ? (
            <Loader2 className="mt-2 h-4 w-4 animate-spin text-zinc-400" />
          ) : shownExamples.length === 0 ? (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('kanji.noExamples')}</p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {shownExamples.map(({ entry, written, level }) => (
                <li key={`${entry.language}-${entry.id}`} className="rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-800/50">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span lang="ja" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{withKanji(written, current)}</span>
                    <span lang="ja" className="text-xs text-zinc-500 dark:text-zinc-400">{entry.kana[0]}</span>
                    {level && <WordLevelBadge level={level} />}
                  </span>
                  <span className="block truncate text-xs text-zinc-700 dark:text-zinc-300">{entry.senses[0]?.glosses.slice(0, 3).join('; ')}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-[10px] text-zinc-500 dark:text-zinc-400">
            KANJIDIC2 · KRADFILE · JMdict © EDRDG (CC BY-SA 4.0){strokes && ' · KanjiVG © Ulrich Apel (CC BY-SA 3.0)'}
          </p>
        </div>
      </section>
    </div>,
    document.body,
  );
};

/** The kanji of a word as buttons that open their card. */
export const KanjiChips: React.FC<{ text: string; onOpen: (kanji: string, all: string[]) => void; className?: string }> = ({ text, onOpen, className = '' }) => {
  const t = useT();
  const all = useMemo(() => kanjiOfText(text), [text]);
  if (!all.length) return null;
  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-75">{t('kanji.row')}</span>
      {all.map((kanji) => (
        <button
          key={kanji}
          type="button"
          onClick={(event) => { event.stopPropagation(); onOpen(kanji, all); }}
          lang="ja"
          aria-label={t('kanji.open', { kanji })}
          title={t('kanji.open', { kanji })}
          className="min-h-8 min-w-8 rounded-md border border-current/20 bg-white/70 px-1.5 font-mincho text-base hover:bg-white dark:bg-zinc-900/60 dark:hover:bg-zinc-900"
        >
          {kanji}
        </button>
      ))}
    </span>
  );
};
