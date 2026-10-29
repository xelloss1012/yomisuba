import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, EyeOff, Play, Volume2 } from 'lucide-react';
import { useLanguage, useT } from '../i18n/LanguageContext';
import { favoriteFields } from '../utils/favoritesExport';
import { speakJapanese } from '../utils/japaneseSpeech';
import { BookRef, GlobalNote, passageKey, underlinedAt, VocabularyItem } from '../utils/studyData';
import { DAY_MS, Grade, GRADES, nextIntervals, reviewQueue, startOfDay, StudyProgress } from '../utils/studyProgress';
import { getHistoryEntryResponse } from '../utils/translationHistory';

interface Props {
  /** The vocabulary that can be studied. */
  items: VocabularyItem[];
  /** The underlined passages chosen to be studied. */
  passages: GlobalNote[];
  progress: StudyProgress;
  onAnswer: (key: string, grade: Grade) => void;
  onChangeNewPerDay: (count: number) => void;
  /** "I know it" or "ignore": the card leaves the session. */
  onMark: (key: string, how: 'known' | 'ignored') => void;
  onSeeInBook: (books: BookRef[], text: string) => void;
  canSeeInBook: (books: BookRef[]) => boolean;
  chapterLabel: (spineIndex: number) => string;
}

type ReviewScope = 'all' | 'words' | 'passages';

/** A card of the review: a word of the vocabulary or an underlined passage. */
type ReviewCard =
  | { kind: 'word'; key: string; item: VocabularyItem; since: number }
  | { kind: 'passage'; key: string; note: GlobalNote; since: number };

const NEW_PER_DAY_OPTIONS = [5, 10, 20, 30, 50, 0];

/** A span of time as the language says it, in its largest whole unit: "10 min", "3 días", "2 meses". */
export const formatSpan = (ms: number, language: string): string => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const [value, unit] = minutes < 60 ? [minutes, 'minute']
    : minutes < 60 * 24 ? [Math.round(minutes / 60), 'hour']
      : minutes < 60 * 24 * 30 ? [Math.round(minutes / 1440), 'day']
        : minutes < 60 * 24 * 365 ? [Math.round(minutes / 43_200), 'month']
          : [Math.round(minutes / 525_600 * 10) / 10, 'year'];
  try {
    return new Intl.NumberFormat(language, { style: 'unit', unit: unit as string, unitDisplay: 'short' }).format(value as number);
  } catch {
    return `${value} ${unit}`;
  }
};

/**
 * When a word is due, as the calendar says it: "in 10 minutes" today, then "tomorrow", "in 3 days"…
 * (a word due tomorrow is due at midnight, so hours would say "in 2 hours" late in the evening).
 */
export const formatDue = (due: number, now: number, language: string): string => {
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY_MS);
  try {
    const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    if (days < 1) {
      const minutes = Math.max(1, Math.round((due - now) / 60_000));
      return minutes < 60 ? relative.format(minutes, 'minute') : relative.format(Math.round(minutes / 60), 'hour');
    }
    if (days < 30) return relative.format(days, 'day');
    if (days < 365) return relative.format(Math.round(days / 30), 'month');
    return relative.format(Math.round(days / 365), 'year');
  } catch {
    return formatSpan(due - now, language);
  }
};

const GRADE_STYLES: Record<Grade, string> = {
  again: 'bg-rose-600 hover:bg-rose-700',
  hard: 'bg-amber-600 hover:bg-amber-700',
  good: 'bg-emerald-600 hover:bg-emerald-700',
  easy: 'bg-sky-600 hover:bg-sky-700',
};

/** Shows a sentence with the word in bold. */
const withWord = (text: string, words: string[]): React.ReactNode => {
  for (const word of words) {
    const at = word ? text.indexOf(word) : -1;
    if (at >= 0) return <>{text.slice(0, at)}<b className="font-bold text-indigo-700 dark:text-indigo-300">{word}</b>{text.slice(at + word.length)}</>;
  }
  return text;
};

/**
 * Reviews the vocabulary one word at a time: the word (with the sentence it was saved from), then its
 * reading and meaning, and how well it was remembered decides when it comes back.
 */
export const StudyReview: React.FC<Props> = ({ items, passages, progress, onAnswer, onChangeNewPerDay, onMark, onSeeInBook, canSeeInBook, chapterLabel }) => {
  const t = useT();
  const language = useLanguage();
  const [scope, setScope] = useState<ReviewScope>('all');
  // Words and passages together, new ones taken in the order they were met while reading.
  const cards = useMemo(() => [
    ...(scope !== 'passages' ? items.map((item): ReviewCard => ({ kind: 'word', key: item.key, item, since: item.firstSavedAt })) : []),
    ...(scope !== 'words'
      ? passages.map((note): ReviewCard => ({ kind: 'passage', key: passageKey(note.annotation.id), note, since: underlinedAt(note.annotation.id) }))
      : []),
  ].sort((a, b) => a.since - b.since), [items, passages, scope]);
  const byKey = useMemo(() => new Map(cards.map((card) => [card.key, card])), [cards]);
  const [queue, setQueue] = useState<string[] | null>(null);
  const [shown, setShown] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const now = Date.now();
  const available = useMemo(() => reviewQueue(cards.map((card) => card.key), progress, now),
    // `now` changes on every render; the queue only needs to follow the cards and their progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, progress]);

  const current = queue && queue.length ? byKey.get(queue[0]) : undefined;

  const grade = useCallback((value: Grade) => {
    if (!queue || !current) return;
    onAnswer(current.key, value);
    setReviewed((count) => count + 1);
    setShown(false);
    setExpanded(false);
    // Forgotten: it comes back at the end of this session.
    setQueue(value === 'again' ? [...queue.slice(1), current.key] : queue.slice(1));
  }, [current, onAnswer, queue]);

  useEffect(() => {
    if (!current) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
      if (!shown && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        setShown(true);
      } else if (shown && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        grade(GRADES[Number(event.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, grade, shown]);

  // Not started, or finished.
  if (!queue || !current) {
    const total = available.due.length + available.fresh.length;
    return (
      <div className="space-y-4">
        {queue && reviewed > 0 && (
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            {t('review.done', { count: reviewed })}
          </p>
        )}
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          {passages.length > 0 && (
            <div role="radiogroup" aria-label={t('review.scope')} className="mb-3 flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
              {(['all', 'words', 'passages'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={scope === value}
                  onClick={() => setScope(value)}
                  className={`min-h-8 flex-1 rounded-lg px-2 text-xs font-semibold ${scope === value ? 'bg-white text-indigo-700 shadow-sm dark:bg-zinc-900 dark:text-indigo-300' : 'text-zinc-600 dark:text-zinc-300'}`}
                >
                  {t(`review.scope_${value}`)}
                </button>
              ))}
            </div>
          )}
          <p className="text-sm text-zinc-800 dark:text-zinc-200">
            {total
              ? t('review.summary', { due: available.due.length, fresh: available.fresh.length })
              : t('review.nothing')}
          </p>
          <button
            type="button"
            onClick={() => {
              setQueue([...available.due, ...available.fresh]);
              setReviewed(0);
              setShown(false);
            }}
            disabled={!total}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 active:scale-95 disabled:opacity-40"
          >
            <Play className="h-4 w-4" /> {t('review.start')}
          </button>
        </div>
        <label className="flex items-center justify-between gap-3 text-xs text-zinc-700 dark:text-zinc-300">
          {t('review.newPerDay')}
          <select
            value={progress.newPerDay}
            onChange={(event) => onChangeNewPerDay(Number(event.target.value))}
            className="min-h-9 rounded-lg border border-zinc-300 bg-white px-2 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {NEW_PER_DAY_OPTIONS.map((count) => (
              <option key={count} value={count}>{count ? count : t('review.noLimit')}</option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('review.explain')}</p>
        {!passages.length && <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('review.passagesHint')}</p>}
      </div>
    );
  }

  const intervals = nextIntervals(progress.cards[current.key], Date.now());
  const books = current.kind === 'word' ? current.item.books : [current.note.book];
  const markButtons = (
    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
      {([['known', <Check key="i" className="h-3.5 w-3.5" />, t('study.markKnown')], ['ignored', <EyeOff key="i" className="h-3.5 w-3.5" />, t('study.ignore')]] as const).map(([how, icon, label]) => (
        <button
          key={how}
          type="button"
          onClick={() => {
            onMark(current.key, how);
            setShown(false);
            setExpanded(false);
            setQueue(queue.filter((key) => key !== current.key));
          }}
          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {icon} {label}
        </button>
      ))}
      {canSeeInBook(books) && (
        <button
          type="button"
          onClick={() => onSeeInBook(books, current.kind === 'word' ? current.item.favorite.query : current.note.annotation.quote)}
          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <BookOpen className="h-3.5 w-3.5" /> {t('study.seeInBook')}
        </button>
      )}
    </div>
  );

  function renderWord(item: VocabularyItem) {
    const { meaning } = favoriteFields(item.favorite);
    const words = [item.word, item.favorite.query];
    return (
      <>
        <div className="flex items-center gap-2">
          <p lang="ja" className="font-mincho text-4xl font-bold text-zinc-900 dark:text-zinc-100">{item.word}</p>
          <button
            type="button"
            onClick={() => { void speakJapanese(item.word).catch(() => undefined); }}
            className="tap-area rounded-full p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            aria-label={t('common.listen')}
            title={t('common.listen')}
          >
            <Volume2 className="h-5 w-5" />
          </button>
        </div>
        {item.contexts[0] && (
          <p lang="ja" className="mt-4 max-w-md text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {withWord(item.contexts[0].text, words)}
          </p>
        )}

        {shown && (
          <div className="mt-5 w-full max-w-md border-t border-zinc-200 pt-4 dark:border-zinc-700">
            {item.reading && item.reading !== item.word && (
              <p lang="ja" className="text-lg font-semibold text-indigo-700 dark:text-indigo-300">{item.reading}</p>
            )}
            <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-1 w-full text-left">
              <span className={`block whitespace-pre-line text-center text-sm text-zinc-800 dark:text-zinc-200 ${expanded ? 'text-left' : ''}`}>
                {expanded ? getHistoryEntryResponse(item.favorite, language) : meaning}
              </span>
            </button>
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{item.books.map((book) => book.title).join(' · ')}</p>
            {markButtons}
          </div>
        )}
      </>
    );
  }

  /**
   * A passage with a note asks for the note, shown the passage in its sentence; one without a note asks
   * for the passage itself, hidden in the sentence around it.
   */
  function renderPassage({ book, annotation }: GlobalNote) {
    // Hidden with nothing around it, the passage could not be told; it is then shown, to be recognized.
    const hideable = !annotation.note && Boolean(annotation.prefix || annotation.suffix);
    const hidden = hideable && !shown;
    return (
      <>
        {(annotation.note || hideable) && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t(annotation.note ? 'review.recallNote' : 'review.recallPassage')}
          </p>
        )}
        <p lang="ja" className="mt-3 max-w-md text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
          {annotation.prefix && <>…{annotation.prefix}</>}
          {hidden
            ? <span className="mx-0.5 inline-block min-w-[3em] rounded bg-indigo-100 px-1 text-indigo-400 dark:bg-indigo-950 dark:text-indigo-500" aria-label={t('review.hiddenPassage')}>{'＿'.repeat(Math.min(8, Math.max(2, annotation.quote.length)))}</span>
            : <b className="font-bold text-indigo-700 dark:text-indigo-300">{annotation.quote}</b>}
          {annotation.suffix && <>{annotation.suffix}…</>}
        </p>

        {shown && (
          <div className="mt-5 w-full max-w-md border-t border-zinc-200 pt-4 dark:border-zinc-700">
            {annotation.note && <p className="whitespace-pre-line text-left text-sm text-zinc-800 dark:text-zinc-200">{annotation.note}</p>}
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{book.title} · {chapterLabel(annotation.spineIndex)}</p>
            {markButtons}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
        <span>{t('review.left', { count: queue.length })}</span>
        <button type="button" onClick={() => setQueue(null)} className="tap-area rounded-lg px-2 py-1 font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40">
          {t('review.finish')}
        </button>
      </div>

      <div className="mt-3 flex flex-1 flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50/60 px-4 py-6 text-center dark:border-zinc-800 dark:bg-zinc-800/30">
        {current.kind === 'word'
          ? renderWord(current.item)
          : renderPassage(current.note)}
      </div>

      <div className="mt-3">
        {shown ? (
          <div className="grid grid-cols-4 gap-2">
            {GRADES.map((value, index) => (
              <button
                key={value}
                type="button"
                onClick={() => grade(value)}
                className={`flex min-h-14 flex-col items-center justify-center rounded-xl px-1 text-white shadow-md active:scale-95 ${GRADE_STYLES[value]}`}
                title={`${index + 1}`}
              >
                <span className="text-xs font-semibold">{t(`review.${value}`)}</span>
                <span className="text-[10px] opacity-85">{formatSpan(intervals[value], language)}</span>
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShown(true)}
            className="min-h-14 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 active:scale-95"
          >
            {t('review.show')}
          </button>
        )}
        <p className="mt-2 hidden text-center text-[10px] text-zinc-400 sm:block">{t('review.keys')}</p>
      </div>
    </div>
  );
};
