/**
 * What the reader knows of each word of the vocabulary, and when to review it: a spaced repetition in the
 * manner of Anki (SM-2), kept for all books together. Words are named by `vocabularyKey` (base form and
 * reading), so a word saved in several books is studied once. Only the state of study is kept here; the
 * word itself and its meaning stay in the favorites of each book.
 */

export const STUDY_PROGRESS_KEY = 'yomisuba_study_v1';
/** Fired on `window` whenever the progress is saved, so that it can be copied to Drive. */
export const STUDY_PROGRESS_EVENT = 'yomisuba-study-progress';

export const DAY_MS = 86_400_000;
const AGAIN_DELAY_MS = 10 * 60_000;
const START_EASE = 2.5;
const MIN_EASE = 1.3;
/** A word whose next review is this many days away or more is known. */
export const KNOWN_INTERVAL_DAYS = 21;
/** "I know it": the next review, to make sure, after this many days. */
const MARK_KNOWN_DAYS = 60;
export const DEFAULT_NEW_PER_DAY = 20;
export const DEFAULT_KANJI_NEW_PER_DAY = 10;

/**
 * Kanji are studied by their own cards (`kanji:激`), with a daily allowance of new ones of their own so that
 * they do not take the one of the words. A kanji is in the reviews while it has a card that is not ignored:
 * adding one makes a new card, taking it out ignores it, and both reach the other devices as any review.
 */
export const kanjiKey = (kanji: string): string => `kanji:${kanji}`;
export const isKanjiKey = (key: string): boolean => key.startsWith('kanji:');
export const kanjiOfKey = (key: string): string => key.slice('kanji:'.length);

/** The kanji in the reviews: those with a card that is not ignored. */
export const reviewedKanji = (progress: StudyProgress): string[] => Object.entries(progress.cards)
  .filter(([key, card]) => isKanjiKey(key) && card.status !== 'ignored')
  .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
  .map(([key]) => kanjiOfKey(key));

export type StudyStatus = 'new' | 'learning' | 'known' | 'ignored';
export type Grade = 'again' | 'hard' | 'good' | 'easy';
export const GRADES: Grade[] = ['again', 'hard', 'good', 'easy'];

export interface StudyCard {
  /** 'new' is kept, rather than removing the card, so that a reset also reaches the other devices. */
  status: StudyStatus;
  /** When it is due, in ms; 0 for a new or ignored word. */
  due: number;
  /** Days until the next review after the last one. */
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  updatedAt: number;
}

export interface StudyProgress {
  formatVersion: 1;
  cards: Record<string, StudyCard>;
  /** How many new words a day are added to the reviews. 0: no limit. */
  newPerDay: number;
  /** How many new words were started on `day` (local date, YYYY-MM-DD). */
  newStarted?: { day: string; count: number };
  /** The same for kanji, which have their own allowance (absent: the default). */
  kanjiNewPerDay?: number;
  kanjiNewStarted?: { day: string; count: number };
  /** When `newPerDay` was last changed, to merge it with another device's. */
  settingsUpdatedAt?: number;
}

export const emptyProgress = (): StudyProgress => ({ formatVersion: 1, cards: {}, newPerDay: DEFAULT_NEW_PER_DAY });

const isCard = (value: unknown): value is StudyCard => {
  if (!value || typeof value !== 'object') return false;
  const card = value as StudyCard;
  return ['new', 'learning', 'known', 'ignored'].includes(card.status)
    && [card.due, card.interval, card.ease, card.reps, card.lapses, card.updatedAt].every((number) => typeof number === 'number' && Number.isFinite(number));
};

/** A progress read from storage or Drive, with whatever is damaged left out; null when it is not one. */
export function parseProgress(value: unknown): StudyProgress | null {
  if (!value || typeof value !== 'object' || (value as StudyProgress).formatVersion !== 1) return null;
  const raw = value as Partial<StudyProgress>;
  const cards: Record<string, StudyCard> = {};
  if (raw.cards && typeof raw.cards === 'object') {
    for (const [key, card] of Object.entries(raw.cards)) if (isCard(card)) cards[key] = card;
  }
  const newPerDay = Number.isInteger(raw.newPerDay) && Number(raw.newPerDay) >= 0 ? Number(raw.newPerDay) : DEFAULT_NEW_PER_DAY;
  const started = raw.newStarted;
  const kanjiStarted = raw.kanjiNewStarted;
  return {
    formatVersion: 1,
    cards,
    newPerDay,
    ...(started && typeof started.day === 'string' && Number.isInteger(started.count) ? { newStarted: { day: started.day, count: started.count } } : {}),
    ...(Number.isInteger(raw.kanjiNewPerDay) && Number(raw.kanjiNewPerDay) >= 0 ? { kanjiNewPerDay: Number(raw.kanjiNewPerDay) } : {}),
    ...(kanjiStarted && typeof kanjiStarted.day === 'string' && Number.isInteger(kanjiStarted.count)
      ? { kanjiNewStarted: { day: kanjiStarted.day, count: kanjiStarted.count } }
      : {}),
    ...(typeof raw.settingsUpdatedAt === 'number' ? { settingsUpdatedAt: raw.settingsUpdatedAt } : {}),
  };
}

export function readStudyProgress(storage: Pick<Storage, 'getItem'> = localStorage): StudyProgress {
  try {
    return parseProgress(JSON.parse(storage.getItem(STUDY_PROGRESS_KEY) || 'null')) ?? emptyProgress();
  } catch {
    return emptyProgress();
  }
}

/** Saves the progress and tells the app, which copies it to Drive. */
export function writeStudyProgress(progress: StudyProgress, notify = true): void {
  try {
    localStorage.setItem(STUDY_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Kept in memory for this session.
  }
  if (notify && typeof window !== 'undefined') window.dispatchEvent(new Event(STUDY_PROGRESS_EVENT));
}

/** Midnight of the local day of `time`. */
export const startOfDay = (time: number): number => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export const dayKey = (time: number): string => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** Midnight `days` days after the day of `now`: a word reviewed in the evening is due the morning after. */
const dueIn = (now: number, days: number): number => {
  const date = new Date(startOfDay(now));
  date.setDate(date.getDate() + days);
  return date.getTime();
};

export const statusOf = (card: StudyCard | undefined): StudyStatus => card?.status ?? 'new';

export const isDue = (card: StudyCard | undefined, now: number): boolean =>
  Boolean(card && (card.status === 'learning' || card.status === 'known') && card.due <= now);

const freshCard = (now: number): StudyCard => ({ status: 'new', due: 0, interval: 0, ease: START_EASE, reps: 0, lapses: 0, updatedAt: now });

/** The card after answering how well the word was remembered. */
export function schedule(card: StudyCard | undefined, grade: Grade, now: number): StudyCard {
  const current = card && card.status !== 'new' && card.status !== 'ignored' ? card : freshCard(now);
  const { reps, interval } = current;
  let { ease } = current;
  if (grade === 'again') {
    ease = Math.max(MIN_EASE, ease - 0.2);
    return {
      status: 'learning',
      due: now + AGAIN_DELAY_MS,
      interval: 0,
      ease,
      reps: 0,
      lapses: current.lapses + (reps > 0 ? 1 : 0),
      updatedAt: now,
    };
  }
  let days: number;
  if (grade === 'hard') {
    ease = Math.max(MIN_EASE, ease - 0.15);
    days = reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
  } else if (grade === 'good') {
    days = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(interval + 1, Math.round(interval * ease));
  } else {
    days = reps === 0 ? 4 : Math.max(interval + 1, Math.round(interval * ease * 1.3));
    ease += 0.15;
  }
  return {
    status: days >= KNOWN_INTERVAL_DAYS ? 'known' : 'learning',
    due: dueIn(now, days),
    interval: days,
    ease,
    reps: reps + 1,
    lapses: current.lapses,
    updatedAt: now,
  };
}

/**
 * How far each answer would send the word, in ms: the minutes of "again", and the days of the others
 * (counted in whole days, as they come back at midnight: "1 day" even when it is late in the evening).
 */
export function nextIntervals(card: StudyCard | undefined, now: number): Record<Grade, number> {
  return Object.fromEntries(GRADES.map((grade) => {
    const next = schedule(card, grade, now);
    return [grade, grade === 'again' ? Math.max(0, next.due - now) : next.interval * DAY_MS];
  })) as Record<Grade, number>;
}

/** "I know it": out of the reviews for a long while. */
export const markKnown = (card: StudyCard | undefined, now: number): StudyCard => ({
  ...(card && card.status !== 'new' ? card : freshCard(now)),
  status: 'known',
  interval: Math.max(card?.interval ?? 0, MARK_KNOWN_DAYS),
  due: dueIn(now, Math.max(card?.interval ?? 0, MARK_KNOWN_DAYS)),
  reps: Math.max(1, card?.reps ?? 0),
  updatedAt: now,
});

export const markIgnored = (card: StudyCard | undefined, now: number): StudyCard => ({
  ...(card ?? freshCard(now)),
  status: 'ignored',
  due: 0,
  updatedAt: now,
});

export const resetCard = (now: number): StudyCard => freshCard(now);

export const kanjiNewPerDay = (progress: StudyProgress): number => progress.kanjiNewPerDay ?? DEFAULT_KANJI_NEW_PER_DAY;

/** New words (or new kanji) still allowed today. */
export function newLeftToday(progress: StudyProgress, now: number, kanji = false): number {
  const perDay = kanji ? kanjiNewPerDay(progress) : progress.newPerDay;
  if (!perDay) return Number.POSITIVE_INFINITY;
  const counter = kanji ? progress.kanjiNewStarted : progress.newStarted;
  const started = counter?.day === dayKey(now) ? counter.count : 0;
  return Math.max(0, perDay - started);
}

/**
 * The words to review now, in order: those due (the most overdue first), then new words up to what is
 * left of today's allowance, in the order given (the vocabulary's).
 */
export function reviewQueue(keys: string[], progress: StudyProgress, now: number): { due: string[]; fresh: string[] } {
  const due = keys
    .filter((key) => isDue(progress.cards[key], now))
    .sort((a, b) => progress.cards[a].due - progress.cards[b].due);
  // Kanji and the rest each take from their own allowance, keeping the order given.
  const left = { kanji: newLeftToday(progress, now, true), other: newLeftToday(progress, now) };
  const fresh = keys.filter((key) => {
    if (statusOf(progress.cards[key]) !== 'new') return false;
    const kind = isKanjiKey(key) ? 'kanji' : 'other';
    if (left[kind] <= 0) return false;
    left[kind] -= 1;
    return true;
  });
  return { due, fresh };
}

/** The progress after answering a review: the card, and today's count of new words if it was new. */
export function answer(progress: StudyProgress, key: string, grade: Grade, now: number): StudyProgress {
  const card = progress.cards[key];
  const wasNew = statusOf(card) === 'new';
  const today = dayKey(now);
  const counter = isKanjiKey(key) ? 'kanjiNewStarted' : 'newStarted';
  return {
    ...progress,
    cards: { ...progress.cards, [key]: schedule(card, grade, now) },
    ...(wasNew
      ? { [counter]: { day: today, count: (progress[counter]?.day === today ? progress[counter].count : 0) + 1 } }
      : {}),
  };
}

export const setCard = (progress: StudyProgress, key: string, card: StudyCard): StudyProgress =>
  ({ ...progress, cards: { ...progress.cards, [key]: card } });

/**
 * Two progresses put together: for each word, the one changed last. Nothing is lost when two devices
 * studied different words, and the same word keeps its latest review.
 */
export function mergeProgress(local: StudyProgress, remote: StudyProgress): StudyProgress {
  const cards: Record<string, StudyCard> = { ...remote.cards };
  for (const [key, card] of Object.entries(local.cards)) {
    if (!cards[key] || card.updatedAt >= cards[key].updatedAt) cards[key] = card;
  }
  const settingsFromLocal = (local.settingsUpdatedAt ?? 0) >= (remote.settingsUpdatedAt ?? 0);
  const latestCount = (pair: Array<{ day: string; count: number } | undefined>) => {
    const days = pair.filter((item): item is { day: string; count: number } => Boolean(item));
    const latestDay = days.map((item) => item.day).sort().pop();
    return latestDay
      ? { day: latestDay, count: Math.max(...days.filter((item) => item.day === latestDay).map((item) => item.count)) }
      : undefined;
  };
  const newStarted = latestCount([local.newStarted, remote.newStarted]);
  const kanjiNewStarted = latestCount([local.kanjiNewStarted, remote.kanjiNewStarted]);
  const settings = settingsFromLocal ? local : remote;
  return {
    formatVersion: 1,
    cards,
    newPerDay: settings.newPerDay,
    ...(settings.kanjiNewPerDay !== undefined ? { kanjiNewPerDay: settings.kanjiNewPerDay } : {}),
    ...(settings.settingsUpdatedAt ? { settingsUpdatedAt: settings.settingsUpdatedAt } : {}),
    ...(newStarted ? { newStarted } : {}),
    ...(kanjiNewStarted ? { kanjiNewStarted } : {}),
  };
}

/** How many words are in each state, of those given. */
export function countStatuses(keys: string[], progress: StudyProgress, now: number): Record<StudyStatus | 'due', number> {
  const counts = { new: 0, learning: 0, known: 0, ignored: 0, due: 0 };
  for (const key of keys) {
    const card = progress.cards[key];
    counts[statusOf(card)] += 1;
    if (isDue(card, now)) counts.due += 1;
  }
  return counts;
}
