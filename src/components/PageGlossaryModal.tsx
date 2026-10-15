import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Loader2, Search, Star, X } from 'lucide-react';
import {
  DictionaryLookup,
  JapaneseMorphologicalToken,
  getDictionarySearchTerms,
} from '../utils/dictionary';
import { buildDictionaryHistoryResponse } from '../utils/translationHistory';
import {
  isTranslationFavorite,
  TranslationFavorite,
  TranslationFavoriteCandidate,
} from '../utils/translationFavorites';
import { useDictionaryOptions, useT, useTranslationLanguage } from '../i18n/LanguageContext';
import { classifyWord, difficultyOf, isWithinLevel, JlptLevel, WordLevel } from '../utils/wordLevels';
import { useWordLevels, WordLevelBadge } from './WordLevelBadge';

export interface PageWordToken extends JapaneseMorphologicalToken {
  range: Range;
  joinedSuffix?: boolean;
  joinedConjugation?: boolean;
}

export type PageWordCategory = 'noun' | 'verb' | 'adjective' | 'particle' | 'other';

interface Props {
  isOpen: boolean;
  tokens: PageWordToken[];
  /** The reader's JLPT level, to hide the words they should already know. */
  studyLevel?: JlptLevel;
  favorites: TranslationFavorite[];
  onClose: () => void;
  onSelectWord: (token: PageWordToken) => void;
  onToggleFavorite: (candidate: TranslationFavoriteCandidate) => void;
}

interface GlossaryItem {
  key: string;
  token: PageWordToken;
}

type SortMode = 'page' | 'useful';
const SORT_STORAGE_KEY = 'ereader_glossary_sort';
const HIDE_KNOWN_STORAGE_KEY = 'ereader_glossary_hide_known';

const readPreference = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writePreference = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only a convenience: the glossary works without it.
  }
};

// Parts of speech that are grammar rather than vocabulary: they get no level.
const GRAMMAR_POS = new Set(['助詞', '助動詞', '記号', '接続詞', '感動詞']);

const lookupForm = (token: PageWordToken) =>
  !token.joinedSuffix && !token.joinedConjugation && token.basic_form && token.basic_form !== '*'
    ? token.basic_form
    : token.surface_form;

const getTokenKey = (token: JapaneseMorphologicalToken) =>
  `${token.surface_form}\u0000${token.basic_form || ''}\u0000${token.pos}`;

export const getPageWordCategory = (token: JapaneseMorphologicalToken): PageWordCategory => {
  if (token.pos === '名詞' && token.pos_detail_1 === '形容動詞語幹') return 'adjective';
  if (token.pos === '名詞') return 'noun';
  if (token.pos === '動詞') return 'verb';
  if (token.pos === '形容詞' || token.pos === '形容動詞') return 'adjective';
  if (token.pos === '助詞') return 'particle';
  return 'other';
};

const categoryBadgeClasses: Record<PageWordCategory, string> = {
  noun: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-200',
  verb: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200',
  adjective: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200',
  particle: 'bg-violet-100 text-violet-800 dark:bg-violet-950/70 dark:text-violet-200',
  other: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

export const PageGlossaryModal: React.FC<Props> = ({
  isOpen,
  tokens,
  studyLevel,
  favorites,
  onClose,
  onSelectWord,
  onToggleFavorite,
}) => {
  const t = useT();
  const translationLanguage = useTranslationLanguage();
  const dictionaryOptions = useDictionaryOptions();
  const [search, setSearch] = useState('');
  const [lookups, setLookups] = useState<Record<string, DictionaryLookup | string>>({});
  const [completed, setCompleted] = useState(0);
  const wordLevels = useWordLevels();
  const [sortMode, setSortMode] = useState<SortMode>(() =>
    readPreference(SORT_STORAGE_KEY) === 'useful' ? 'useful' : 'page'
  );
  const [hideKnown, setHideKnown] = useState(() => readPreference(HIDE_KNOWN_STORAGE_KEY) === '1');

  const words = useMemo(() => {
    const unique = new Map<string, GlossaryItem>();
    tokens.forEach((token) => {
      const key = getTokenKey(token);
      if (!unique.has(key)) unique.set(key, { key, token });
    });
    return [...unique.values()];
  }, [tokens]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let nextIndex = 0;
    setSearch('');
    setLookups({});
    setCompleted(0);

    const loadLookups = async () => {
      const results: Record<string, DictionaryLookup | string> = {};
      const worker = async () => {
        while (!cancelled) {
          const index = nextIndex;
          nextIndex += 1;
          const item = words[index];
          if (!item) return;
          try {
            results[item.key] = await getDictionarySearchTerms(
              lookupForm(item.token),
              translationLanguage,
              dictionaryOptions,
            );
          } catch (error) {
            results[item.key] = error instanceof Error
              ? error.message
              : t('glossary.errorQuery');
          }
          if (!cancelled) setCompleted((count) => count + 1);
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(4, words.length) }, () => worker())
      );
      if (!cancelled) setLookups(results);
    };

    void loadLookups();
    return () => {
      cancelled = true;
    };
  }, [words, isOpen, translationLanguage, dictionaryOptions]);

  const levels = useMemo(() => {
    const result = new Map<string, WordLevel | null>();
    if (!wordLevels) return result;
    for (const { key, token } of words) {
      result.set(key, GRAMMAR_POS.has(token.pos)
        ? null
        : classifyWord(wordLevels, lookupForm(token), { fallback: true }));
    }
    return result;
  }, [wordLevels, words]);

  // Words the reader should already know: grammar, and vocabulary within their level.
  const known = useMemo(() => {
    const result = new Set<string>();
    if (!studyLevel || !wordLevels) return result;
    for (const { key, token } of words) {
      if (GRAMMAR_POS.has(token.pos) || isWithinLevel(wordLevels, lookupForm(token), levels.get(key) ?? null, studyLevel)) {
        result.add(key);
      }
    }
    return result;
  }, [levels, studyLevel, wordLevels, words]);

  const visibleWords = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = words.filter(({ key, token }) =>
      (!hideKnown || !known.has(key)) &&
      (!term ||
        token.surface_form.toLowerCase().includes(term) ||
        (token.reading && token.reading.toLowerCase().includes(term)) ||
        (token.basic_form && token.basic_form.toLowerCase().includes(term)))
    );
    if (sortMode === 'page') return filtered;
    // Most useful first; words without a level (grammar) go last, page order breaks ties.
    const rank = ({ key }: GlossaryItem) => {
      const level = levels.get(key);
      return level ? difficultyOf(level) : Number.POSITIVE_INFINITY;
    };
    return [...filtered].sort((left, right) => rank(left) - rank(right));
  }, [search, words, hideKnown, known, sortMode, levels]);

  const changeSortMode = (mode: SortMode) => {
    setSortMode(mode);
    writePreference(SORT_STORAGE_KEY, mode);
  };
  const toggleHideKnown = () => {
    writePreference(HIDE_KNOWN_STORAGE_KEY, hideKnown ? '0' : '1');
    setHideKnown(!hideKnown);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="page-glossary-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex min-w-0 items-center gap-2">
            <BookOpen className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
            <h2 id="page-glossary-title" className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t('glossary.title')}
            </h2>
            <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {words.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-area rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={t('nav.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <label className="relative mx-3 mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('glossary.filter')}
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </label>

        <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <select
            value={sortMode}
            onChange={(event) => changeSortMode(event.target.value as SortMode)}
            aria-label={t('glossary.sortUseful')}
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-700 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            <option value="page">{t('glossary.sortPage')}</option>
            <option value="useful">{t('glossary.sortUseful')}</option>
          </select>
          {studyLevel && (
            <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
              <input type="checkbox" checked={hideKnown} onChange={toggleHideKnown} />
              {t('glossary.hideKnown')} (N{studyLevel} · {known.size})
            </label>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>{t('glossary.instruction')}</span>
          {completed < words.length && (
            <span className="flex shrink-0 items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('translate.dictionary')} {completed}/{words.length}
            </span>
          )}
        </div>

        <ul className="min-h-0 space-y-2 overflow-y-auto overscroll-contain px-3 pb-4">
          {visibleWords.map(({ key, token }) => {
            const lookup = lookups[key];
            const entry = lookup && typeof lookup !== 'string' ? lookup.entries[0] : undefined;
            const firstSense = entry?.senses[0];
            const query = lookupForm(token);
            const candidate: TranslationFavoriteCandidate | null =
              lookup && typeof lookup !== 'string' && lookup.entries.length
                ? {
                    query,
                    kind: 'glossary',
                    ...buildDictionaryHistoryResponse(
                      lookup.baseForm,
                      lookup.searchTerms,
                      lookup.entries,
                    ),
                  }
                : null;
            const favorite = candidate ? isTranslationFavorite(favorites, candidate) : false;
            return (
              <li key={key} className="flex items-start gap-1 rounded-xl border border-zinc-200 px-2 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => onSelectWord(token)}
                  className="min-w-0 flex-1 py-2 pl-1 text-left transition-colors"
                >
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      {token.surface_form}
                    </span>
                    {token.reading && token.reading !== token.surface_form && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{token.reading}</span>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                      <WordLevelBadge level={levels.get(key) ?? null} />
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${categoryBadgeClasses[getPageWordCategory(token)]}`}>
                        {token.pos}
                      </span>
                    </span>
                  </span>
                  {token.basic_form && token.basic_form !== '*' && token.basic_form !== token.surface_form && (
                    <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">
                      {t('glossary.baseForm')}: {token.basic_form}
                    </span>
                  )}
                  {entry && firstSense && (
                    <span className="mt-1 block text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                      <span className="font-medium">
                        {entry.kanji.join(' · ') || entry.kana.join(' · ')}
                      </span>
                      {entry.kanji.length > 0 && entry.kana.length > 0 && (
                        <span className="text-zinc-500"> ({entry.kana.join(' · ')})</span>
                      )}
                      {' — '}
                      {firstSense.glosses.slice(0, 4).join('; ')}
                    </span>
                  )}
                  {lookup && typeof lookup !== 'string' && !entry && (
                    <span className="mt-1 block text-xs text-zinc-400">{t('glossary.noDefinition')}</span>
                  )}
                  {typeof lookup === 'string' && (
                    <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                      {t('glossary.errorQuery')}: {lookup}
                    </span>
                  )}
                  {entry && lookup && typeof lookup !== 'string' && lookup.englishFallbackError && (
                    <span className="mt-1 block text-[10px] text-amber-600 dark:text-amber-300">
                      {lookup.englishFallbackError}
                    </span>
                  )}
                </button>
                {candidate && (
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(candidate)}
                    className={`tap-area mt-1 shrink-0 rounded-lg p-2 ${
                      favorite ? 'text-amber-500' : 'text-zinc-400 hover:text-amber-500'
                    }`}
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
          {visibleWords.length === 0 && (
            <li className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t('glossary.empty')}
            </li>
          )}
        </ul>
        <p className="border-t border-zinc-200 px-4 py-2 text-[10px] text-zinc-400 dark:border-zinc-800">
          {t('level.sources')}
        </p>
      </section>
    </div>
  );
};
