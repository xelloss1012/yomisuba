import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, EyeOff, Loader2, ListPlus, Search, Star, X } from 'lucide-react';
import type { ParsedEpub } from '../types/epub';
import { DictionaryLookup, getDictionarySearchTerms, tokenizeJapanese } from '../utils/dictionary';
import { analyzeChapter, ChapterAnalysis, chapterText, collectGlossary, GlossaryWord, toHiragana } from '../utils/bookGlossary';
import { buildDictionaryHistoryResponse } from '../utils/translationHistory';
import { isTranslationFavorite, TranslationFavorite, TranslationFavoriteCandidate } from '../utils/translationFavorites';
import { collectStudyData, listStoredBooks, vocabularyKey } from '../utils/studyData';
import { markIgnored, markKnown, readStudyProgress, setCard, statusOf, writeStudyProgress } from '../utils/studyProgress';
import { useDictionaryOptions, useT, useTranslationLanguage } from '../i18n/LanguageContext';
import { classifyForms, classifyWord, difficultyOf, isWithinLevel, JlptLevel, WordLevel } from '../utils/wordLevels';
import { useWordLevels, WordLevelBadge } from './WordLevelBadge';

export type GlossaryScope = 'page' | 'chapter' | 'book';
type SortMode = 'frequency' | 'difficulty' | 'appearance';

interface Props {
  isOpen: boolean;
  scope: 'chapter' | 'book';
  onChangeScope: (scope: GlossaryScope) => void;
  onClose: () => void;
  epub: ParsedEpub;
  currentSpineIndex: number;
  /** The table-of-contents label of each chapter of the spine. */
  spineLabels: string[];
  studyLevel?: JlptLevel;
  favorites: TranslationFavorite[];
  onToggleFavorite: (candidate: TranslationFavoriteCandidate) => void;
  onSearchInBook: (text: string) => void;
  onChangeStudyLevel: (level: JlptLevel | undefined) => void;
}

const PAGE_SIZE = 50;
const BULK_ADD = 20;
const PREFS_KEY = 'yomisuba_book_glossary_v1';
const MIN_COUNTS = [1, 2, 3, 5, 10];

interface Prefs {
  aboveLevel: boolean;
  hideStudied: boolean;
  minCount: Record<'chapter' | 'book', number>;
  sort: Record<'chapter' | 'book', SortMode>;
}

const DEFAULT_PREFS: Prefs = {
  aboveLevel: true,
  hideStudied: true,
  minCount: { chapter: 1, book: 2 },
  sort: { chapter: 'appearance', book: 'frequency' },
};

const readPrefs = (): Prefs => {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') as Partial<Prefs> | null;
    return stored ? { ...DEFAULT_PREFS, ...stored, minCount: { ...DEFAULT_PREFS.minCount, ...stored.minCount }, sort: { ...DEFAULT_PREFS.sort, ...stored.sort } } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
};

// The analysis of each chapter, kept while the book is open: switching scope or reopening is instant.
const analyses = new WeakMap<ParsedEpub, Map<number, Promise<ChapterAnalysis>>>();

const analyzeSpine = (epub: ParsedEpub, spineIndex: number): Promise<ChapterAnalysis> => {
  let book = analyses.get(epub);
  if (!book) {
    book = new Map();
    analyses.set(epub, book);
  }
  let pending = book.get(spineIndex);
  if (!pending) {
    pending = (async () => {
      const html = await epub.getChapterContent(epub.spine[spineIndex].href);
      const text = chapterText(html, (source) => new DOMParser().parseFromString(source, 'text/html'));
      return analyzeChapter(spineIndex, text, text ? await tokenizeJapanese(text) : []);
    })();
    book.set(spineIndex, pending);
    pending.catch(() => book?.delete(spineIndex));
  }
  return pending;
};

/** Words of the reader's vocabulary by their base form: all of them, and those known or ignored. */
const readVocabulary = (): { saved: Set<string>; studied: Set<string> } => {
  const saved = new Set<string>();
  const studied = new Set<string>();
  try {
    const progress = readStudyProgress();
    for (const item of collectStudyData(localStorage, listStoredBooks(localStorage)).vocabulary) {
      if (item.favorite.data) saved.add(item.word);
    }
    // Words are known or ignored by their card, saved as a favorite or not (ignored from a glossary).
    for (const [key, card] of Object.entries(progress.cards)) {
      const status = statusOf(card);
      if (key.startsWith('word:') && (status === 'known' || status === 'ignored')) studied.add(key.slice(5, key.indexOf('|')));
    }
  } catch {
    // Without the vocabulary nothing is marked or hidden.
  }
  return { saved, studied };
};

export const ScopeSwitch: React.FC<{ scope: GlossaryScope; onChange: (scope: GlossaryScope) => void }> = ({ scope, onChange }) => {
  const t = useT();
  const options: GlossaryScope[] = ['page', 'chapter', 'book'];
  return (
    <div role="tablist" className="mx-3 mt-3 grid grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          aria-selected={scope === option}
          onClick={() => { if (scope !== option) onChange(option); }}
          className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${scope === option
            ? 'bg-white text-indigo-700 shadow-sm dark:bg-zinc-900 dark:text-indigo-300'
            : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white'}`}
        >
          {t(`glossary.scope_${option}`)}
        </button>
      ))}
    </div>
  );
};

/**
 * The words of a chapter or of the whole book, to get to know before reading it: the ones that come up
 * most and are beyond the reader's level, so that they sound familiar when they appear.
 */
export const BookGlossaryModal: React.FC<Props> = ({
  isOpen,
  scope,
  onChangeScope,
  onClose,
  epub,
  currentSpineIndex,
  spineLabels,
  studyLevel,
  favorites,
  onToggleFavorite,
  onSearchInBook,
  onChangeStudyLevel,
}) => {
  const t = useT();
  const translationLanguage = useTranslationLanguage();
  const dictionaryOptions = useDictionaryOptions();
  const wordLevels = useWordLevels();
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [chapters, setChapters] = useState<ChapterAnalysis[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lookups, setLookups] = useState<Record<string, DictionaryLookup | string>>({});
  const [adding, setAdding] = useState(false);
  const [vocabulary, setVocabulary] = useState(readVocabulary);

  const spineIndexes = useMemo(
    () => (scope === 'chapter' ? [currentSpineIndex] : epub.spine.map((_, index) => index)),
    [scope, currentSpineIndex, epub],
  );

  // Analyze the chapters of the scope, one at a time (the tokenizer is one worker), showing the progress.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setChapters([]);
    setError(null);
    setShown(PAGE_SIZE);
    setExpanded(null);
    setVocabulary(readVocabulary());
    setProgress({ done: 0, total: spineIndexes.length });
    void (async () => {
      const done: ChapterAnalysis[] = [];
      try {
        for (const spineIndex of spineIndexes) {
          if (cancelled) return;
          done.push(await analyzeSpine(epub, spineIndex));
          if (!cancelled) setProgress({ done: done.length, total: spineIndexes.length });
        }
        if (!cancelled) setChapters(done);
      } catch (analysisError) {
        if (!cancelled) setError(analysisError instanceof Error ? analysisError.message : String(analysisError));
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, epub, spineIndexes]);

  const updatePrefs = (change: (current: Prefs) => Prefs) => {
    setPrefs((current) => {
      const next = change(current);
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // Only a convenience.
      }
      return next;
    });
    setShown(PAGE_SIZE);
  };

  const words = useMemo(() => collectGlossary(chapters), [chapters]);

  // Written in kana in the book (ない, いい), a word is as easy as its kana form says.
  const levels = useMemo(() => {
    const result = new Map<string, WordLevel | null>();
    if (!wordLevels) return result;
    for (const word of words) {
      result.set(word.key, word.writtenInKana
        ? classifyForms(wordLevels, [word.key, toHiragana(word.surface)])
        : classifyWord(wordLevels, word.key));
    }
    return result;
  }, [wordLevels, words]);

  const countIn = (word: GlossaryWord) => (scope === 'chapter' ? word.perChapter.get(currentSpineIndex) ?? 0 : word.count);
  const minCount = prefs.minCount[scope];
  const sort = prefs.sort[scope];

  const visible = useMemo(() => {
    const term = search.trim();
    const list = words.filter((word) =>
      countIn(word) >= minCount
      && !(prefs.aboveLevel && studyLevel && isWithinLevel(levels.get(word.key) ?? null, studyLevel))
      && !(prefs.hideStudied && vocabulary.studied.has(word.key))
      && (!term || word.key.includes(term) || word.surface.includes(term)));
    const difficulty = (word: GlossaryWord) => {
      const level = levels.get(word.key);
      return level ? difficultyOf(level) : 7;
    };
    if (sort === 'frequency') list.sort((a, b) => countIn(b) - countIn(a) || difficulty(a) - difficulty(b));
    else if (sort === 'difficulty') list.sort((a, b) => difficulty(b) - difficulty(a) || countIn(b) - countIn(a));
    else if (scope === 'chapter') list.sort((a, b) => (a.firstInChapter.get(currentSpineIndex) ?? 0) - (b.firstInChapter.get(currentSpineIndex) ?? 0));
    else list.sort((a, b) => a.firstChapter - b.firstChapter || (a.firstInChapter.get(a.firstChapter) ?? 0) - (b.firstInChapter.get(b.firstChapter) ?? 0));
    return list;
    // `countIn` follows `scope` and `currentSpineIndex`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, search, minCount, sort, prefs.aboveLevel, prefs.hideStudied, studyLevel, levels, vocabulary, scope, currentSpineIndex]);

  const page = visible.slice(0, shown);

  // The meaning of the words shown, and only of those: a book has thousands of words.
  useEffect(() => {
    if (!isOpen) return undefined;
    const missing = page.map((word) => word.key).filter((key) => !(key in lookups));
    if (!missing.length) return undefined;
    let cancelled = false;
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < missing.length) {
        const key = missing[next];
        next += 1;
        let result: DictionaryLookup | string;
        try {
          result = await getDictionarySearchTerms(key, translationLanguage, dictionaryOptions);
        } catch (lookupError) {
          result = lookupError instanceof Error ? lookupError.message : t('glossary.errorQuery');
        }
        if (!cancelled) setLookups((current) => ({ ...current, [key]: result }));
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker));
    return () => { cancelled = true; };
    // Looking up again only when the words shown change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, page.map((word) => word.key).join('|'), translationLanguage, dictionaryOptions]);

  // A different dictionary language means different meanings.
  useEffect(() => { setLookups({}); }, [translationLanguage, dictionaryOptions]);

  // The entry read as in the text first: the word saved is the one of the book (街 まち, not がい).
  const entriesOf = (word: GlossaryWord, lookup: DictionaryLookup) => (word.reading
    ? [...lookup.entries].sort((a, b) => Number(b.kana.includes(word.reading!)) - Number(a.kana.includes(word.reading!)))
    : lookup.entries);

  const candidateOf = (word: GlossaryWord, lookup: DictionaryLookup | string | undefined): TranslationFavoriteCandidate | null =>
    lookup && typeof lookup !== 'string' && lookup.entries.length
      ? {
        query: word.key,
        kind: 'glossary',
        ...buildDictionaryHistoryResponse(lookup.baseForm, lookup.searchTerms, entriesOf(word, lookup)),
        context: word.context,
      }
      : null;

  /** "I know it" or "ignore": recorded in the state of study, so the word stays hidden everywhere. */
  const markWord = (candidate: TranslationFavoriteCandidate, how: 'known' | 'ignored') => {
    const progress = readStudyProgress();
    const key = vocabularyKey({ ...candidate, id: '', savedAt: 0 });
    const now = Date.now();
    writeStudyProgress(setCard(progress, key, how === 'known' ? markKnown(progress.cards[key], now) : markIgnored(progress.cards[key], now)));
    setVocabulary(readVocabulary());
    setExpanded(null);
  };

  const addFirst = async () => {
    setAdding(true);
    try {
      let added = 0;
      for (const word of visible) {
        if (added >= BULK_ADD) break;
        let lookup = lookups[word.key];
        if (!lookup) {
          try {
            lookup = await getDictionarySearchTerms(word.key, translationLanguage, dictionaryOptions);
            setLookups((current) => ({ ...current, [word.key]: lookup as DictionaryLookup }));
          } catch {
            continue;
          }
        }
        const candidate = candidateOf(word, lookup);
        if (!candidate || isTranslationFavorite(favorites, candidate) || vocabulary.saved.has(word.key)) continue;
        onToggleFavorite(candidate);
        added += 1;
      }
      setVocabulary(readVocabulary());
    } finally {
      setAdding(false);
    }
  };

  if (!isOpen) return null;

  const analyzing = !error && chapters.length < spineIndexes.length;
  const selectClass = 'rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-700 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200';

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-glossary-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex min-w-0 items-center gap-2">
            <BookOpen className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
            <h2 id="book-glossary-title" className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {scope === 'chapter'
                ? spineLabels[currentSpineIndex] || `${t('common.chapter')} ${currentSpineIndex + 1}`
                : epub.metadata.title}
            </h2>
            {!analyzing && (
              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {visible.length}
              </span>
            )}
          </div>
          <button type="button" onClick={onClose} className="tap-area rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={t('nav.close')}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <ScopeSwitch scope={scope} onChange={onChangeScope} />

        <label className="relative mx-3 mt-2 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setShown(PAGE_SIZE); }}
            placeholder={t('glossary.filter')}
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </label>

        <div className="mx-3 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
          <select value={sort} onChange={(event) => updatePrefs((current) => ({ ...current, sort: { ...current.sort, [scope]: event.target.value as SortMode } }))} aria-label={t('study.sortLabel')} className={selectClass}>
            <option value="frequency">{t('glossary.sortFrequency')}</option>
            <option value="difficulty">{t('glossary.sortDifficulty')}</option>
            <option value="appearance">{t('glossary.sortAppearance')}</option>
          </select>
          <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            {t('glossary.minCount')}
            <select value={minCount} onChange={(event) => updatePrefs((current) => ({ ...current, minCount: { ...current.minCount, [scope]: Number(event.target.value) } }))} className={selectClass}>
              {MIN_COUNTS.map((count) => <option key={count} value={count}>{count}+</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            {t('settings.studyLevel')}
            <select
              value={studyLevel ?? ''}
              onChange={(event) => onChangeStudyLevel(event.target.value ? Number(event.target.value) as JlptLevel : undefined)}
              className={selectClass}
            >
              <option value="">{t('settings.studyLevelNone')}</option>
              {[5, 4, 3, 2, 1].map((level) => <option key={level} value={level}>N{level}</option>)}
            </select>
          </label>
          {studyLevel && (
            <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
              <input type="checkbox" checked={prefs.aboveLevel} onChange={() => updatePrefs((current) => ({ ...current, aboveLevel: !current.aboveLevel }))} />
              {t('glossary.aboveLevel', { level: studyLevel })}
            </label>
          )}
          <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={prefs.hideStudied} onChange={() => updatePrefs((current) => ({ ...current, hideStudied: !current.hideStudied }))} />
            {t('glossary.hideStudied')}
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          {analyzing ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('glossary.analyzing', { done: progress.done, total: progress.total })}
            </span>
          ) : (
            <span>{t(scope === 'chapter' ? 'glossary.chapterHint' : 'glossary.bookHint')}</span>
          )}
          {!analyzing && visible.length > 0 && (
            <button
              type="button"
              onClick={() => { void addFirst(); }}
              disabled={adding}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            >
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
              {t('glossary.addFirst', { count: Math.min(BULK_ADD, visible.length) })}
            </button>
          )}
        </div>

        {error && <p role="alert" className="px-4 pb-2 text-xs text-rose-600 dark:text-rose-400">{t('reader.analysisError').replace('{message}', error)}</p>}

        <ul className="min-h-0 space-y-2 overflow-y-auto overscroll-contain px-3 pb-4">
          {!analyzing && page.map((word) => {
            const lookup = lookups[word.key];
            const entry = lookup && typeof lookup !== 'string' ? entriesOf(word, lookup)[0] : undefined;
            const candidate = candidateOf(word, lookup);
            const favorite = candidate ? isTranslationFavorite(favorites, candidate) : false;
            const isExpanded = expanded === word.key;
            const reading = word.reading ?? entry?.kana[0];
            return (
              <li key={word.key} className="flex items-start gap-1 rounded-xl border border-zinc-200 px-2 dark:border-zinc-800">
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => setExpanded(isExpanded ? null : word.key)} className="w-full py-2 pl-1 text-left">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span lang="ja" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{word.key}</span>
                      {reading && reading !== toHiragana(word.key) && <span lang="ja" className="text-xs text-zinc-500 dark:text-zinc-400">{reading}</span>}
                      <span className="ml-auto flex flex-wrap items-center gap-1">
                        {scope === 'chapter' && word.firstChapter === currentSpineIndex && (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-950/70 dark:text-sky-200">{t('glossary.newInBook')}</span>
                        )}
                        {vocabulary.saved.has(word.key) && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t('glossary.inVocabulary')}</span>
                        )}
                        <WordLevelBadge level={levels.get(word.key) ?? null} />
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={t('glossary.timesTitle')}>
                          ×{countIn(word)}
                        </span>
                      </span>
                    </span>
                    {entry ? (
                      <span className={`mt-1 block text-xs leading-relaxed text-zinc-700 dark:text-zinc-300 ${isExpanded ? '' : 'line-clamp-2'}`}>
                        {(isExpanded ? entry.senses.slice(0, 4) : entry.senses.slice(0, 1))
                          .map((sense) => sense.glosses.slice(0, 4).join('; '))
                          .join(' · ')}
                      </span>
                    ) : lookup === undefined ? (
                      <span className="mt-1 block h-3 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                    ) : (
                      <span className="mt-1 block text-xs text-zinc-400">{typeof lookup === 'string' ? `${t('glossary.errorQuery')}: ${lookup}` : t('glossary.noDefinition')}</span>
                    )}
                  </button>
                  {isExpanded && (
                    <div className="pb-2 pl-1">
                      <p lang="ja" className="border-l-2 border-amber-300 pl-2 text-xs text-zinc-700 dark:border-amber-600 dark:text-zinc-300">{word.context}</p>
                      {scope === 'book' && (
                        <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                          {t('glossary.firstIn', { chapter: spineLabels[word.firstChapter] || `${t('common.chapter')} ${word.firstChapter + 1}` })}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => onSearchInBook(word.surface)}
                        className="mt-1.5 inline-flex min-h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        <Search className="h-3.5 w-3.5" /> {t('menu.searchInBook')}
                      </button>
                      {candidate && (
                        <>
                          <button type="button" onClick={() => markWord(candidate, 'known')} className="ml-1.5 mt-1.5 inline-flex min-h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                            <Check className="h-3.5 w-3.5" /> {t('study.markKnown')}
                          </button>
                          <button type="button" onClick={() => markWord(candidate, 'ignored')} className="ml-1.5 mt-1.5 inline-flex min-h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                            <EyeOff className="h-3.5 w-3.5" /> {t('study.ignore')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {candidate && (
                  <button
                    type="button"
                    onClick={() => { onToggleFavorite(candidate); setVocabulary(readVocabulary()); }}
                    className={`tap-area mt-1 shrink-0 rounded-lg p-2 ${favorite ? 'text-amber-500' : 'text-zinc-400 hover:text-amber-500'}`}
                    aria-label={favorite ? t('glossary.removeFav') : t('glossary.addFav')}
                    title={favorite ? t('glossary.removeFav') : t('glossary.markFav')}
                    aria-pressed={favorite}
                  >
                    <Star className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
                  </button>
                )}
              </li>
            );
          })}
          {!analyzing && visible.length > shown && (
            <li>
              <button type="button" onClick={() => setShown((count) => count + PAGE_SIZE)} className="w-full rounded-xl py-2.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40">
                {t('study.moreResults', { count: visible.length - shown })}
              </button>
            </li>
          )}
          {!analyzing && !error && visible.length === 0 && (
            <li className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">{t('glossary.emptyFiltered')}</li>
          )}
        </ul>
        <p className="border-t border-zinc-200 px-4 py-2 text-[10px] text-zinc-400 dark:border-zinc-800">{t('level.sources')}</p>
      </section>
    </div>
  );
};
