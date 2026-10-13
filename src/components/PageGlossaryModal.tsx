import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Loader2, Search, Star, X } from 'lucide-react';
import {
  DictionaryLookup,
  JapaneseMorphologicalToken,
  getDictionarySearchTerms,
} from '../utils/dictionary';
import { formatDictionaryHistoryResponse } from '../utils/translationHistory';
import {
  isTranslationFavorite,
  TranslationFavorite,
  TranslationFavoriteCandidate,
} from '../utils/translationFavorites';
import { t, UiLanguage } from '../utils/i18n';

export interface PageWordToken extends JapaneseMorphologicalToken {
  range: Range;
  joinedSuffix?: boolean;
  joinedConjugation?: boolean;
}

export type PageWordCategory = 'noun' | 'verb' | 'adjective' | 'particle' | 'other';

interface Props {
  isOpen: boolean;
  tokens: PageWordToken[];
  favorites: TranslationFavorite[];
  language?: UiLanguage;
  onClose: () => void;
  onSelectWord: (token: PageWordToken) => void;
  onToggleFavorite: (candidate: TranslationFavoriteCandidate) => void;
}

interface GlossaryItem {
  key: string;
  token: PageWordToken;
}

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
  favorites,
  language = 'es',
  onClose,
  onSelectWord,
  onToggleFavorite,
}) => {
  const [search, setSearch] = useState('');
  const [lookups, setLookups] = useState<Record<string, DictionaryLookup | string>>({});
  const [completed, setCompleted] = useState(0);

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
              !item.token.joinedSuffix &&
              !item.token.joinedConjugation &&
              item.token.basic_form &&
              item.token.basic_form !== '*'
                ? item.token.basic_form
                : item.token.surface_form,
              language
            );
          } catch (error) {
            results[item.key] = error instanceof Error
              ? error.message
              : t('glossary.errorQuery', language);
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
  }, [words, isOpen, language]);

  const visibleWords = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return words;
    return words.filter(({ token }) =>
      token.surface_form.toLowerCase().includes(term) ||
      (token.reading && token.reading.toLowerCase().includes(term)) ||
      (token.basic_form && token.basic_form.toLowerCase().includes(term))
    );
  }, [search, words]);

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
              {t('glossary.title', language)}
            </h2>
            <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {words.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-area rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={t('nav.close', language)}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <label className="relative mx-3 mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('glossary.filter', language)}
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </label>

        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>{t('glossary.instruction', language)}</span>
          {completed < words.length && (
            <span className="flex shrink-0 items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('translate.dictionary', language)} {completed}/{words.length}
            </span>
          )}
        </div>

        <ul className="min-h-0 space-y-2 overflow-y-auto overscroll-contain px-3 pb-4">
          {visibleWords.map(({ key, token }) => {
            const lookup = lookups[key];
            const entry = lookup && typeof lookup !== 'string' ? lookup.entries[0] : undefined;
            const firstSense = entry?.senses[0];
            const query = !token.joinedSuffix &&
              !token.joinedConjugation &&
              token.basic_form &&
              token.basic_form !== '*'
                ? token.basic_form
                : token.surface_form;
            const candidate: TranslationFavoriteCandidate | null =
              lookup && typeof lookup !== 'string' && lookup.entries.length
                ? {
                    query,
                    kind: 'glossary',
                    response: formatDictionaryHistoryResponse(
                      lookup.baseForm,
                      lookup.searchTerms,
                      lookup.entries,
                      language,
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
                    <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${categoryBadgeClasses[getPageWordCategory(token)]}`}>
                      {token.pos}
                    </span>
                  </span>
                  {token.basic_form && token.basic_form !== '*' && token.basic_form !== token.surface_form && (
                    <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">
                      {t('glossary.baseForm', language)}: {token.basic_form}
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
                    <span className="mt-1 block text-xs text-zinc-400">{t('glossary.noDefinition', language)}</span>
                  )}
                  {typeof lookup === 'string' && (
                    <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                      {t('glossary.errorQuery', language)}: {lookup}
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
                    aria-label={favorite ? t('glossary.removeFav', language) : t('glossary.addFav', language)}
                    title={favorite ? t('glossary.removeFav', language) : t('glossary.markFav', language)}
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
              {t('glossary.empty', language)}
            </li>
          )}
        </ul>
      </section>
    </div>
  );
};
