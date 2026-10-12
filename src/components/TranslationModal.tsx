import React, { useState, useEffect, useRef } from 'react';
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
import { speakJapanese } from '../utils/japaneseSpeech';
import { MarkdownContent } from './MarkdownContent';
import {
  formatDictionaryHistoryResponse,
  TranslationHistoryKind,
} from '../utils/translationHistory';
import {
  isTranslationFavorite,
  TranslationFavorite,
  TranslationFavoriteCandidate,
} from '../utils/translationFavorites';

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
  language?: 'es' | 'en';
  onSaveHistory: (kind: TranslationHistoryKind, query: string, response: string, provider?: AiProvider) => void;
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
  language = 'es',
  onSaveHistory,
  onRecordFrequentQuery,
  onToggleFavorite,
}) => {
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
        const cachedTranslation = getCachedTranslation(provider, selectedText, providerKey, model);
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
          result = await translateWithAi(aiProvider, aiApiKey, selectedText, model || openRouterModel, language);
        } else {
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${language}&dt=t&q=${encodeURIComponent(selectedText)}`;
          const res = await fetch(url);
          const data = await res.json();
          if (data && data[0]) {
            result = data[0].map((item: [string]) => item[0]).join('');
          } else {
            result = language === 'en' ? 'Could not translate text.' : 'No se pudo traducir el texto.';
          }
        }
        if (cancelled) return;
        setTranslatedText(result);
        setTranslationError(false);
        saveCachedTranslation(provider, selectedText, result, providerKey, model);
        onSaveHistory(resultKind, selectedText, result, aiProvider);
        if (hasUsableTranslation(result)) {
          recordSuccessfulSearch(selectedText, searchId);
        }
      } catch (err) {
        if (!cancelled) {
          setTranslationError(true);
          setTranslatedText(err instanceof Error ? err.message : 'Traducción no disponible.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void translate();
    return () => { cancelled = true; };
  }, [aiApiKey, aiProvider, availableAiProviders, frequentSearchToken, isOpen, onRecordFrequentQuery, onSaveHistory, openRouterModel, selectedText]);

  useEffect(() => {
    if (!isOpen || !selectedText) return;
    const searchId = frequentSearchToken;
    const requestId = dictionaryRequestRef.current + 1;
    dictionaryRequestRef.current = requestId;
    setDictionaryQuery(selectedText);
    void lookupDictionary(selectedText, requestId, searchId);
    return () => {
      if (dictionaryRequestRef.current === requestId) {
        dictionaryRequestRef.current += 1;
      }
    };
  }, [frequentSearchToken, isOpen, selectedText]);

  const lookupDictionary = async (
    query: string,
    requestId = dictionaryRequestRef.current + 1,
    searchId: string | number = frequentSearchToken,
  ) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setDictionaryTerms(null);
      setDictionaryError('Escribe una palabra para buscar.');
      setIsDictionaryLoading(false);
      return;
    }
    dictionaryRequestRef.current = requestId;
    setDictionaryTerms(null);
    setDictionaryError('');
    setIsDictionaryLoading(true);
    try {
      const lookup = await getDictionarySearchTerms(trimmedQuery, language);
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
        onSaveHistory(
          'dictionary',
          trimmedQuery,
          formatDictionaryHistoryResponse(terms.baseForm, terms.searchTerms, terms.entries)
        );
        recordSuccessfulSearch(trimmedQuery, searchId);
      }
    } catch (error) {
      if (dictionaryRequestRef.current === requestId) {
        setDictionaryError(error instanceof Error ? error.message : 'No se pudo consultar el diccionario.');
      }
    } finally {
      if (dictionaryRequestRef.current === requestId) setIsDictionaryLoading(false);
    }
  };

  const handleDictionarySubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dictionarySearchCountRef.current += 1;
    const searchToken = `${frequentSearchToken}:dictionary:${dictionarySearchCountRef.current}`;
    void lookupDictionary(dictionaryQuery, dictionaryRequestRef.current + 1, searchToken);
  };

  const toggleFavorite = (candidate: TranslationFavoriteCandidate) => {
    onToggleFavorite(candidate);
  };

  const handleSpeak = async () => {
    setIsSpeaking(true);
    setSpeechError('');
    try {
      await speakJapanese(selectedText);
    } catch (error) {
      setSpeechError(error instanceof Error ? error.message : 'No se pudo reproducir la pronunciación.');
    } finally {
      setIsSpeaking(false);
    }
  };

  if (!isOpen) return null;

  const handleExplain = async () => {
    if (!explanationProvider) {
      setExplanationError('Configura una IA en Ajustes para solicitar una explicación.');
      return;
    }
    const key = aiApiKeys[explanationProvider] || (aiProvider === explanationProvider ? aiApiKey : '') || '';
    if (!key) {
      setExplanationError(`No hay una clave configurada para ${AI_PROVIDER_LABELS[explanationProvider]}.`);
      return;
    }

    const requestId = explanationRequestRef.current + 1;
    explanationRequestRef.current = requestId;
    setExplanation('');
    setExplanationError('');
    setIsExplaining(true);
    try {
      const model = explanationProvider === 'openrouter'
        ? await resolveOpenRouterModel(openRouterModel.trim() || DEFAULT_OPENROUTER_MODEL)
        : openRouterModel;
      const result = await explainWithAi(explanationProvider, key, selectedText, model, language);
      if (explanationRequestRef.current === requestId) setExplanation(result);
    } catch (error) {
      if (explanationRequestRef.current === requestId) {
        setExplanationError(error instanceof Error ? error.message : 'No se pudo generar la explicación.');
      }
    } finally {
      if (explanationRequestRef.current === requestId) setIsExplaining(false);
    }
  };

  const translationFavorite: TranslationFavoriteCandidate = {
    query: selectedText,
    kind: aiProvider ? 'ai' : 'translation',
    ...(aiProvider ? { provider: aiProvider } : {}),
    response: translatedText,
  };
  const isTranslationSaved = Boolean(
    translatedText && !translationError && isTranslationFavorite(favorites, translationFavorite),
  );
  const explanationFavorite: TranslationFavoriteCandidate = {
    query: selectedText,
    kind: 'ai',
    ...(explanationProvider ? { provider: explanationProvider } : {}),
    response: explanation,
  };
  const isExplanationSaved = Boolean(
    explanation && isTranslationFavorite(favorites, explanationFavorite),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
          <div className="flex items-center gap-2">
            <Languages className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
              Traducción y Diccionario
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Original Text */}
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-3.5 border border-zinc-200 dark:border-zinc-750">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Texto Original (Japonés)
              </span>
              <button
                onClick={handleSpeak}
                disabled={isSpeaking}
                className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
              >
                <Volume2 className={`w-3.5 h-3.5 ${isSpeaking ? 'animate-pulse text-amber-500' : ''}`} />
                <span>{isSpeaking ? 'Reproduciendo...' : 'Escuchar'}</span>
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
              {aiProvider ? `Traducción con ${AI_PROVIDER_LABELS[aiProvider]}` : 'Traducción al Español'}
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-zinc-500">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                <span>Traduciendo...</span>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 select-text">
                  {translatedText || 'Sin traducción.'}
                </div>
                {translatedText && !translationError && (
                  <button
                    type="button"
                    onClick={() => toggleFavorite(translationFavorite)}
                    className={`tap-area shrink-0 rounded-lg p-2 ${
                      isTranslationSaved ? 'text-amber-500' : 'text-zinc-400 hover:text-amber-500'
                    }`}
                    aria-label={isTranslationSaved ? 'Quitar traducción de favoritos' : 'Marcar traducción como favorita'}
                    title={isTranslationSaved ? 'Quitar de favoritos' : 'Marcar traducción como favorita'}
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
                    aria-label="IA para explicar la traducción"
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
                  title={availableAiProviders.length ? 'Solicitar una explicación detallada a la IA' : 'Configura una IA en Ajustes'}
                >
                  {isExplaining
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Sparkles className="h-3.5 w-3.5" />}
                  {isExplaining ? 'Explicando…' : 'Explicar con IA'}
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
                    Explicación · {AI_PROVIDER_LABELS[explanationProvider as AiProvider]}
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
                    aria-label={isExplanationSaved ? 'Quitar explicación de favoritos' : 'Marcar explicación como favorita'}
                    title={isExplanationSaved ? 'Quitar de favoritos' : 'Marcar explicación como favorita'}
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
              Diccionario JMDict local · español e inglés
            </div>
            <form onSubmit={handleDictionarySubmit} className="flex gap-2">
              <input
                type="text"
                value={dictionaryQuery}
                onChange={(event) => setDictionaryQuery(event.target.value)}
                placeholder="Escribe una palabra o variante japonesa"
                aria-label="Palabra que se buscará en el diccionario"
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
                Buscar
              </button>
            </form>
            {dictionaryError && (
              <p role="alert" className="text-rose-700 dark:text-rose-300">{dictionaryError}</p>
            )}
            {isDictionaryLoading && (
              <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
              </div>
            )}
          {dictionaryTerms && (
              <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-200/80 dark:bg-emerald-900/70 px-2 py-1 font-semibold">
                  Base: {dictionaryTerms.baseForm}
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
                  No se encontró una entrada local para esta forma.
                </p>
              ) : (
                <div className="space-y-2">
                  {dictionaryTerms.entries.map((entry) => {
                    const definitionFavorite: TranslationFavoriteCandidate = {
                      query: dictionaryTerms.query,
                      kind: 'dictionary',
                      response: formatDictionaryHistoryResponse(
                        dictionaryTerms.baseForm,
                        dictionaryTerms.searchTerms,
                        [entry],
                      ),
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
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleFavorite(definitionFavorite)}
                          className={`tap-area shrink-0 rounded-lg p-2 ${
                            isDefinitionSaved ? 'text-amber-500' : 'text-zinc-400 hover:text-amber-500'
                          }`}
                          aria-label={isDefinitionSaved
                            ? `Quitar definición de ${entry.kanji.join(' · ') || entry.kana.join(' · ')} de favoritos`
                            : `Marcar definición de ${entry.kanji.join(' · ') || entry.kana.join(' · ')} como favorita`}
                          title={isDefinitionSaved ? 'Quitar de favoritos' : 'Marcar definición como favorita'}
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
                  fuente
                </a>
                {' · '}
                <a
                  href="https://www.edrdg.org/edrdg/licence.html"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  licencia CC BY-SA 4.0
                </a>
              </p>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};
