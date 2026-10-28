import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const server = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const study = await server.ssrLoadModule('/src/utils/studyProgress.ts');
  const { DAY_MS, answer, countStatuses, emptyProgress, isDue, markIgnored, markKnown, mergeProgress, nextIntervals,
    parseProgress, readStudyProgress, resetCard, reviewQueue, schedule, setCard, startOfDay, statusOf, writeStudyProgress } = study;

  const now = new Date(2026, 9, 28, 21, 30).getTime();
  const days = (card) => Math.round((card.due - startOfDay(now)) / DAY_MS);

  // --- Answers -------------------------------------------------------------------------------
  const first = schedule(undefined, 'good', now);
  assert.equal(first.status, 'learning');
  assert.equal(days(first), 1, 'a new word answered well comes back tomorrow');
  assert.equal(first.due, startOfDay(now) + DAY_MS, 'at midnight: reviewed in the evening, due in the morning');
  const second = schedule(first, 'good', now + DAY_MS);
  assert.equal(second.interval, 3);
  const third = schedule(second, 'good', now + 4 * DAY_MS);
  assert.equal(third.interval, Math.round(3 * 2.5));
  assert.equal(schedule(undefined, 'easy', now).interval, 4);
  assert.equal(schedule(undefined, 'hard', now).interval, 1);
  assert.ok(schedule(second, 'hard', now).ease < second.ease, 'hard makes it come back sooner from then on');

  const again = schedule(third, 'again', now);
  assert.equal(again.status, 'learning');
  assert.equal(again.due, now + 10 * 60_000, 'forgotten: again in ten minutes');
  assert.equal(again.lapses, 1);
  assert.equal(again.reps, 0);
  assert.ok(again.ease >= 1.3);

  let card;
  for (let review = 0; review < 6; review += 1) card = schedule(card, 'easy', now);
  assert.equal(card.status, 'known', 'a long interval means known');
  assert.ok(card.interval >= 21);

  const intervals = nextIntervals(second, now);
  assert.ok(intervals.again < intervals.hard && intervals.hard <= intervals.good && intervals.good < intervals.easy);

  // --- By hand -------------------------------------------------------------------------------
  assert.equal(markKnown(undefined, now).status, 'known');
  assert.ok(markKnown(first, now).interval >= 60);
  assert.equal(markIgnored(first, now).status, 'ignored');
  assert.equal(isDue(markIgnored(first, now), now + 999 * DAY_MS), false, 'an ignored word is never due');
  assert.equal(statusOf(resetCard(now)), 'new');
  assert.equal(statusOf(undefined), 'new');

  // --- The queue ---------------------------------------------------------------------------
  let progress = { ...emptyProgress(), newPerDay: 2 };
  progress = setCard(progress, 'late', { ...first, due: now - 2 * DAY_MS });
  progress = setCard(progress, 'later', { ...first, due: now - DAY_MS });
  progress = setCard(progress, 'future', { ...first, due: now + DAY_MS });
  progress = setCard(progress, 'skip', markIgnored(undefined, now));
  const keys = ['n1', 'later', 'n2', 'future', 'late', 'n3', 'skip'];
  assert.deepEqual(reviewQueue(keys, progress, now), { due: ['late', 'later'], fresh: ['n1', 'n2'] }, 'the most overdue first; two new a day');

  progress = answer(progress, 'n1', 'good', now);
  assert.equal(progress.newStarted.count, 1);
  assert.deepEqual(reviewQueue(keys, progress, now).fresh, ['n2'], 'one new word left today');
  progress = answer(progress, 'late', 'good', now);
  assert.equal(progress.newStarted.count, 1, 'a review is not a new word');
  assert.deepEqual(reviewQueue(keys, progress, now + DAY_MS).fresh, ['n2', 'n3'], 'a new day, a new allowance');
  assert.equal(reviewQueue(keys, { ...progress, newPerDay: 0 }, now).fresh.length, 2, 'no limit');

  assert.deepEqual(countStatuses(keys, progress, now), { new: 2, learning: 4, known: 0, ignored: 1, due: 1 });

  // --- Two devices -------------------------------------------------------------------------
  const here = { ...emptyProgress(), cards: { a: { ...first, updatedAt: 10 }, b: { ...first, interval: 5, updatedAt: 30 } }, newPerDay: 10, settingsUpdatedAt: 5, newStarted: { day: '2026-10-28', count: 3 } };
  const there = { ...emptyProgress(), cards: { b: { ...first, interval: 9, updatedAt: 20 }, c: { ...first, updatedAt: 1 } }, newPerDay: 30, settingsUpdatedAt: 50, newStarted: { day: '2026-10-28', count: 5 } };
  const merged = mergeProgress(here, there);
  assert.deepEqual(Object.keys(merged.cards).sort(), ['a', 'b', 'c'], 'words studied on either device are kept');
  assert.equal(merged.cards.b.interval, 5, 'the same word: the latest review');
  assert.equal(merged.newPerDay, 30, 'the setting changed last');
  assert.deepEqual(merged.newStarted, { day: '2026-10-28', count: 5 });
  const reset = mergeProgress({ ...here, cards: { b: { ...resetCard(40) } } }, there);
  assert.equal(reset.cards.b.status, 'new', 'a reset reaches the other devices');

  // --- Storage --------------------------------------------------------------------------------
  assert.deepEqual(readStudyProgress(), emptyProgress());
  let notified = 0;
  globalThis.window = { dispatchEvent: () => { notified += 1; } };
  writeStudyProgress(merged);
  assert.equal(notified, 1);
  assert.deepEqual(readStudyProgress(), merged);
  assert.equal(parseProgress({ formatVersion: 2 }), null);
  assert.deepEqual(Object.keys(parseProgress({ formatVersion: 1, cards: { ok: first, bad: { status: 'x' } } }).cards), ['ok'], 'a damaged card is left out');

  console.log('PASS: words are scheduled like Anki, queued by due date with a daily allowance of new words, and merged word by word.');
} finally {
  await server.close();
}
