import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Volume2, Languages, Loader2, Sparkles, Search, Star } from 'lucide-react';
import { AiProvider } from '../types/epub';
import {
  AI_PROVIDER_LABELS,
  DEFAULT_OPENROUTER_MODEL,
  explainWithAi,
  resolveOpenRouterModel,
  translateWithAi,
} from '../utils/aiTranslation';
import { getCachedTranslation, saveCachedTranslation } from '../utils/translationCache';
import { DictionaryEntry, getDictionarySearchTerms } from '../utils/dictionary';
import { isOptionalDictionaryId, JMDICT_SOURCE, OPTIONAL_DICTIONARIES } from '../utils/optionalDictionaries';
import { classifyEntry } from '../utils/wordLevels';
import { useWordLevels, WordLevelBadge } from './WordLevelBadge';
import { KanjiChips, KanjiModal } from './KanjiModal';
import { speakJapanese } from '../utils/japaneseSpeech';
import { MarkdownContent } from './MarkdownContent';
import {
  buildDictionaryHistoryResponse,
  DictionaryHistoryData,
  TranslationHistoryKind,
} from '../utils/translationHistory';
import {
  isTranslationFavorite,
  TranslationFavorite,
  TranslationFavoriteCandidate,
} from '../utils/translationFavorites';
import { TRANSLATION_LANGUAGES } from '../utils/i18n';
import { useDictionaryOptions, useLanguage, useT, useTranslationLanguage } from '../i18n/LanguageContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedText: string;
  aiProvider?: AiProvider;
  aiApiKey?: string;
  openRouterModel: string;
  availableAiProviders: AiProvider[];
  aiApiKeys: Partial<Record<AiProvider, string>>;
  favorites: TranslationFavorite[];
  frequentSearchToken: number;
  onSaveHistory: (kind: TranslationHistoryKind, query: string, response: string, provider?: AiProvider, data?: DictionaryHistoryData, hasFullMatch?: boolean) => void;
  onRecordFrequentQuery: (query: string, searchToken: string | number) => void;
  onToggleFavorite: (candidate: TranslationFavoriteCandidate) => void;
}

const hasUsableTranslation = (result: string) => {
  const normalized = result.trim();
  return Boolean(normalized) && normalized !== 'No se pudo traducir el texto.';
};

export const TranslationModal: React.FC<Props> = ({
  isOpen,
  onClose,
  selectedText,
  aiProvider,
  aiApiKey,
  openRouterModel,
  availableAiProviders,
  aiApiKeys,
  favorites,
  frequentSearchToken,
  onSaveHistory,
  onRecordFrequentQuery,
  onToggleFavorite,
}) => {
  const t = useT();
  const language = useLanguage();
  const translationLanguage = useTranslationLanguage();
  // The kanji card opened from the kanji of the word looked up, with the word's other kanji beside it.
  const [openKanji, setOpenKanji] = useState<{ kanji: string; all: string[] } | null>(null);
  const dictionaryOptions = useDictionaryOptions();
  const wordLevels = useWordLevels();
  const [translatedText, setTranslatedText] = useState<string>('');
  const [translationError, setTranslationError] = useState(false);
  const [dictionaryTerms, setDictionaryTerms] = useState<{
    query: string;
    baseForm: string;
    searchTerms: string[];
    entries: DictionaryEntry[];
    englishFallbackError?: string;
  } | null>(null);
  const [dictionaryQuery, setDictionaryQuery] = useState('');
  const [isDictionaryLoading, setIsDictionaryLoading] = useState(false);
  const [dictionaryError, setDictionaryError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const [explanation, setExplanation] = useState('');
  const [explanationError, setExplanationError] = useState('');
  const [isExplaining, setIsExplaining] = useState(false);
  const [explanationProvider, setExplanationProvider] = useState<AiProvider | ''>('');
  const explanationRequestRef = useRef(0);
  const dictionaryRequestRef = useRef(0);
  const dictionarySearchCountRef = useRef(0);

  const recordSuccessfulSearch = (query: string, searchToken: string | number) => {
    onRecordFrequentQuery(query, searchToken);
  };

  useEffect(() => {
    if (!isOpen || !selectedText) return;

    const searchId = frequentSearchToken;
    let cancelled = false;
    explanationRequestRef.current += 1;
    setTranslatedText('');
    setTranslationError(false);
    setDictionaryQuery(selectedText);
    setExplanation('');
    setExplanationError('');
    setIsExplaining(false);
    setExplanationProvider(
      aiProvider && availableAiProviders.includes(aiProvider)
        ? aiProvider
        : availableAiProviders[0] || ''
    );

    const translate = async () => {
      setIsLoading(true);
      const provider = aiProvider || 'google';
      const providerKey = aiApiKey || '';
      const resultKind: TranslationHistoryKind = aiProvider ? 'ai' : 'translation';
      try {
        let model = '';
        if (aiProvider === 'openrouter') {
          const selection = openRouterModel.trim() || DEFAULT_OPENROUTER_MODEL;
          model = await resolveOpenRouterModel(selection);
        }
        const cachedTranslation = getCachedTranslation(provider, translationLanguage, selectedText, providerKey, model);
        if (cachedTranslation) {
          if (!cancelled) {
            setTranslatedText(cachedTranslation);
            setTranslationError(false);
            onSaveHistory(resultKind, selectedText, cachedTranslation, aiProvider);
            if (hasUsableTranslation(cachedTranslation)) {
              recordSuccessfulSearch(selectedText, searchId);
            }
          }
          return;
        }

        let result: string;
        if (aiProvider && aiApiKey) {
          result = await translateWithAi(aiProvider, aiApiKey, selectedText, model || openRouterModel, translationLanguage);
        } else {
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${translationLanguage}&dt=t&q=${encodeURIComponent(selectedText)}`;
          const res = await fetch(url);
          const data = await res.json();
          if (data && data[0]) {
            result = data[0].map((item: [string]) => item[0]).join('');
          } else {
            result = t('translate.errorTranslate');
          }
        }
        if (cancelled) return;
        setTranslatedText(result);
        setTranslationError(false);
        saveCachedTranslation(provider, translationLanguage, selectedText, result, providerKey, model);
        onSaveHistory(resultKind, selectedText, result, aiProvider);
        if (hasUsableTranslation(result)) {
          recordSuccessfulSearch(selectedText, searchId);
        }
      } catch {
        if (!cancelled) {
          setTranslationError(true);
          setTranslatedText(t('translate.errorTranslate'));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void translate();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedText, aiProvider, aiApiKey, openRouterModel, availableAiProviders, frequentSearchToken, translationLanguage, onSaveHistory, onRecordFrequentQuery]);

  const lookupDictionary = useCallback(async (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    const requestId = dictionaryRequestRef.current + 1;
    dictionaryRequestRef.current = requestId;
    setDictionaryTerms(null);
    setDictionaryError('');
    setIsDictionaryLoading(true);
    try {
      const lookup = await getDictionarySearchTerms(trimmedQuery, translationLanguage, dictionaryOptions);
      if (dictionaryRequestRef.current !== requestId) return;
      const terms = {
        query: trimmedQuery,
        baseForm: lookup.baseForm,
        searchTerms: lookup.searchTerms,
        entries: lookup.entries,
        englishFallbackError: lookup.englishFallbackError,
      };
      setDictionaryTerms(terms);
      if (lookup.hasCompleteMatch) {
        const { response, data } = buildDictionaryHistoryResponse(
          terms.baseForm,
          terms.searchTerms,
          terms.entries,
        );
        onSaveHistory('dictionary', trimmedQuery, response, undefined, data, lookup.hasCompleteTextMatch);
        recordSuccessfulSearch(trimmedQuery, dictionarySearchCountRef.current + 1);
      }
    } catch (error) {
      if (dictionaryRequestRef.current === requestId) {
        setDictionaryError(error instanceof Error ? error.message : t('translate.errorDict'));
      }
    } finally {
      if (dictionaryRequestRef.current === requestId) setIsDictionaryLoading(false);
    }
  }, [dictionaryOptions, translationLanguage, onSaveHistory]);

  useEffect(() => {
    if (!isOpen || !selectedText) return;
    dictionarySearchCountRef.current += 1;
    void lookupDictionary(selectedText);
  }, [isOpen, selectedText, lookupDictionary]);

  const handleDictionarySubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void lookupDictionary(dictionaryQuery);
  };

  const handleSpeak = async () => {
    setIsSpeaking(true);
    setSpeechError('');
    try {
      await speakJapanese(selectedText);
    } catch (error) {
      setSpeechError(error instanceof Error ? error.message : t('translate.errorExplain'));
    } finally {
      setIsSpeaking(false);
    }
  };

  const handleExplain = async () => {
    if (!explanationProvider) return;
    const key = aiApiKeys[explanationProvider]?.trim();
    if (!key) {
      setExplanationError(t('translate.explainPrompt'));
      return;
    }
    const requestId = explanationRequestRef.current + 1;
    explanationRequestRef.current = requestId;
    setIsExplaining(true);
    setExplanationError('');
    try {
      const model = explanationProvider === 'openrouter'
        ? await resolveOpenRouterModel(openRouterModel.trim() || DEFAULT_OPENROUTER_MODEL)
        : openRouterModel;
      const result = await explainWithAi(explanationProvider, key, selectedText, model, language);
      if (explanationRequestRef.current === requestId) setExplanation(result);
    } catch (error) {
      if (explanationRequestRef.current === requestId) {
        setExplanationError(error instanceof Error ? error.message : t('translate.errorExplain'));
      }
    } finally {
      if (explanationRequestRef.current === requestId) setIsExplaining(false);
    }
  };

  if (!isOpen) return null;

  const translationLabel = t('translate.targetTranslation', {
    language: TRANSLATION_LANGUAGES.find((item) => item.code === translationLanguage)?.label || translationLanguage,
  });

  const translationFavorite: TranslationFavoriteCandidate = {
    query: selectedText,
    kind: aiProvider ? 'ai' : 'translation',
    ...(aiProvider ? { provider: aiProvider } : {}),
    response: translatedText,
  };
  const isTranslationSaved = isTranslationFavorite(favorites, translationFavorite);

  const explanationFavorite: TranslationFavoriteCandidate = {
    query: selectedText,
    kind: 'ai',
    provider: explanationProvider || 'ai',
    response: explanation,
  };
  const isExplanationSaved = isTranslationFavorite(favorites, explanationFavorite);

  const toggleFavorite = (candidate: TranslationFavoriteCandidate) => {
    onToggleFavorite(candidate);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center animate-fade-in"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Languages className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t('translate.title')}
            </h2>
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

        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          {/* Original Text */}
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-3.5 border border-zinc-200 dark:border-zinc-700/80">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                {t('translate.originalJapanese')}
              </span>
              <button
                onClick={handleSpeak}
                disabled={isSpeaking}
                className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
              >
                <Volume2 className={`w-3.5 h-3.5 ${isSpeaking ? 'animate-pulse text-amber-500' : ''}`} />
                <span>{isSpeaking ? t('translate.playing') : t('common.listen')}</span>
              </button>
            </div>
            <div className="text-base font-serif text-zinc-800 dark:text-zinc-200 break-words leading-relaxed select-text">
              {selectedText}
            </div>
            {speechError && <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-300">{speechError}</p>}
          </div>

          {/* Translation */}
          <div className="bg-indigo-50/40 dark:bg-indigo-950/20 rounded-xl p-3.5 border border-indigo-100 dark:border-indigo-900/40">
            <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1.5">
              {aiProvider
                ? `${translationLabel} · ${AI_PROVIDER_LABELS[aiProvider]}`
                : translationLabel}
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-zinc-500">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                <span>{t('translate.translating')}</span>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 select-text">
                  {translatedText || t('translate.noTranslation')}
                </div>
                {translatedText && !translationError && (
                  <button
                    type="button"
                    onClick={() => toggleFavorite(translationFavorite)}
                    className={`tap-area shrink-0 rounded-lg p-2 ${
                      isTranslationSaved ? 'text-amber-500' : 'text-zinc-400 hover:text-amber-500'
                    }`}
                    aria-label={isTranslationSaved ? t('glossary.removeFav') : t('glossary.addFav')}
                    title={isTranslationSaved ? t('glossary.removeFav') : t('glossary.addFav')}
                    aria-pressed={isTranslationSaved}
                  >
                    <Star className={`h-4 w-4 ${isTranslationSaved ? 'fill-current' : ''}`} />
                  </button>
                )}
              </div>
            )}
            <div className="mt-3 border-t border-indigo-100 pt-3 dark:border-indigo-900/50">
              <div className="flex flex-wrap items-center gap-2">
                {availableAiProviders.length > 1 && (
                  <select
                    value={explanationProvider}
                    onChange={(event) => setExplanationProvider(event.target.value as AiProvider)}
                    className="min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-2 py-2 text-xs text-zinc-700 dark:border-indigo-900 dark:bg-zinc-900 dark:text-zinc-200"
                    aria-label={t('settings.aiProvider')}
                  >
                    {availableAiProviders.map((provider) => (
                      <option key={provider} value={provider}>{AI_PROVIDER_LABELS[provider]}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => void handleExplain()}
                  disabled={isExplaining || availableAiProviders.length === 0}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  title={availableAiProviders.length ? t('translate.explainBtn') : t('translate.explainPrompt')}
                >
                  {isExplaining
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Sparkles className="h-3.5 w-3.5" />}
                  {isExplaining ? t('translate.explaining') : t('translate.explainBtn')}
                  {availableAiProviders.length === 1 && (
                    <span className="font-normal opacity-80">
                      · {AI_PROVIDER_LABELS[availableAiProviders[0]]}
                    </span>
                  )}
                </button>
              </div>
              {explanationError && (
                <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300">
                  {explanationError}
                </p>
              )}
              {explanation && (
                <div className="mt-3 max-h-[32vh] overflow-y-auto rounded-lg bg-white/75 p-3 text-sm leading-relaxed text-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200">
                  <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                    {t('translate.aiExplanation')} · {AI_PROVIDER_LABELS[explanationProvider as AiProvider]}
                  </div>
                  <div className="break-words select-text">
                    <MarkdownContent content={explanation} />
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(explanationFavorite)}
                    className={`tap-area mt-2 rounded-lg p-2 ${
                      isExplanationSaved ? 'text-amber-500' : 'text-zinc-400 hover:text-amber-500'
                    }`}
                    aria-label={isExplanationSaved ? t('glossary.removeFav') : t('glossary.addFav')}
                    title={isExplanationSaved ? t('glossary.removeFav') : t('glossary.addFav')}
                    aria-pressed={isExplanationSaved}
                  >
                    <Star className={`h-4 w-4 ${isExplanationSaved ? 'fill-current' : ''}`} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Local dictionary */}
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 p-3 text-xs text-emerald-900 dark:text-emerald-200 space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-1.5 text-emerald-700 dark:text-emerald-300">
              {t('translate.localJmdict')}
            </div>
            <form onSubmit={handleDictionarySubmit} className="flex gap-2">
              <input
                type="text"
                value={dictionaryQuery}
                onChange={(event) => setDictionaryQuery(event.target.value)}
                placeholder={t('translate.inputPlaceholder')}
                aria-label={t('translate.inputPlaceholder')}
                className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-emerald-900 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <button
                type="submit"
                disabled={isDictionaryLoading || !dictionaryQuery.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 dark:bg-emerald-700"
              >
                {isDictionaryLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Search className="h-3.5 w-3.5" />}
                {t('translate.searchBtn')}
              </button>
            </form>
            {dictionaryError && (
              <p role="alert" className="text-rose-700 dark:text-rose-300">{dictionaryError}</p>
            )}
            {isDictionaryLoading && (
              <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
              </div>
            )}
          {dictionaryTerms && (
              <div className="space-y-3">
              <KanjiChips
                text={dictionaryTerms.baseForm || dictionaryTerms.query}
                onOpen={(kanji, all) => setOpenKanji({ kanji, all })}
                className="text-emerald-900 dark:text-emerald-200"
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-200/80 dark:bg-emerald-900/70 px-2 py-1 font-semibold">
                  {t('glossary.baseForm')}: {dictionaryTerms.baseForm}
                </span>
                {dictionaryTerms.searchTerms.filter((term) => term !== dictionaryTerms.baseForm).slice(0, 3).map((term) => (
                  <span key={term} className="rounded-full bg-white/70 dark:bg-zinc-900/70 px-2 py-1 text-[11px]">
                    {term}
                  </span>
                ))}
              </div>
              {dictionaryTerms.englishFallbackError && (
                <p role="alert" className="text-amber-700 dark:text-amber-300">
                  {dictionaryTerms.englishFallbackError}
                </p>
              )}
              {dictionaryTerms.entries.length === 0 ? (
                <p className="text-zinc-600 dark:text-zinc-400">
                  {t('translate.noEntries')}
                </p>
              ) : (
                <div className="space-y-2">
                  {dictionaryTerms.entries.map((entry) => {
                    const { response, data } = buildDictionaryHistoryResponse(
                      dictionaryTerms.baseForm,
                      dictionaryTerms.searchTerms,
                      [entry],
                    );
                    const definitionFavorite: TranslationFavoriteCandidate = {
                      query: dictionaryTerms.query,
                      kind: 'dictionary',
                      response,
                      data,
                    };
                    const isDefinitionSaved = isTranslationFavorite(favorites, definitionFavorite);
                    return (
                    <div key={`${entry.language}-${entry.id}`} className="rounded-lg bg-white/75 dark:bg-zinc-900/60 p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
                          {entry.kanji.length ? entry.kanji.join(' · ') : entry.kana.join(' · ')}
                        </span>
                        <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-bold uppercase text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-200">
                          {entry.language}
                        </span>
                        {wordLevels && <WordLevelBadge level={classifyEntry(wordLevels, entry)} />}
                        {entry.kana.length > 0 && (
                          <span className="text-zinc-500 dark:text-zinc-400">{entry.kana.join(' · ')}</span>
                        )}
                      </div>
                      <ol className="mt-1.5 space-y-1 list-decimal list-inside text-zinc-700 dark:text-zinc-300">
                        {entry.senses.map((sense, index) => (
                          <li key={`${entry.id}-${index}`}>
                            {sense.partOfSpeech.length > 0 && (
                              <span className="mr-1 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
                                [{sense.partOfSpeech.join(', ')}]
                              </span>
                            )}
                            {sense.glosses.join('; ')}
                          </li>
                        ))}
                      </ol>
                      {entry.synonyms?.length ? (
                        <p className="mt-1.5 text-zinc-600 dark:text-zinc-400">
                          <span className="mr-1 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
                            {t('glossary.synonyms')}
                          </span>
                          {entry.synonyms.join(' · ')}
                        </p>
                      ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleFavorite(definitionFavorite)}
                          className={`tap-area shrink-0 rounded-lg p-2 ${
                            isDefinitionSaved ? 'text-amber-500' : 'text-zinc-400 hover:text-amber-500'
                          }`}
                          aria-label={isDefinitionSaved ? t('glossary.removeFav') : t('glossary.markFav')}
                          title={isDefinitionSaved ? t('glossary.removeFav') : t('glossary.markFav')}
                          aria-pressed={isDefinitionSaved}
                        >
                          <Star className={`h-4 w-4 ${isDefinitionSaved ? 'fill-current' : ''}`} />
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
              <p className="border-t border-emerald-200 pt-2 text-[10px] text-emerald-800 dark:border-emerald-900/60 dark:text-emerald-300">
                JMdict/EDICT © EDRDG ·{' '}
                <a
                  href="https://www.edrdg.org/wiki/JMdict-EDICT_Dictionary_Project.html"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {t('translate.source')}
                </a>
                {' · '}
                <a
                  href="https://www.edrdg.org/edrdg/licence.html"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {t('translate.license')}
                </a>
                {/* Downloaded dictionaries credit their own source and license. JMdict
                    based ones are already covered by the line above. */}
                {[...new Set(dictionaryTerms.entries.map((entry) => entry.language))]
                  .filter(isOptionalDictionaryId)
                  .map((id) => OPTIONAL_DICTIONARIES[id])
                  .filter((info) => info.source !== JMDICT_SOURCE)
                  .map((info) => (
                    <React.Fragment key={info.id}>
                      <br />
                      {info.source.label} ·{' '}
                      <a href={info.source.url} target="_blank" rel="noreferrer" className="underline">
                        {t('translate.source')}
                      </a>
                      {' · '}
                      <a href={info.license.url} target="_blank" rel="noreferrer" className="underline">
                        {t('translate.license')}
                      </a>
                    </React.Fragment>
                  ))}
              </p>
            </div>
          )}
          </div>
        </div>
        <KanjiModal kanji={openKanji?.kanji ?? null} siblings={openKanji?.all} onClose={() => setOpenKanji(null)} />
      </div>
    </div>
  );
};
