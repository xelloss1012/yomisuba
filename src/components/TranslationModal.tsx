import React, { useState, useEffect } from 'react';
import { X, Volume2, Languages, Loader2 } from 'lucide-react';
import { AiProvider } from '../types/epub';
import { AI_PROVIDER_LABELS, translateWithAi } from '../utils/aiTranslation';
import { getCachedTranslation, saveCachedTranslation } from '../utils/translationCache';
import { DictionaryEntry, getDictionarySearchTerms } from '../utils/dictionary';
import {
  formatDictionaryHistoryResponse,
  TranslationHistoryKind,
} from '../utils/translationHistory';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedText: string;
  aiProvider?: AiProvider;
  aiApiKey?: string;
  onSaveHistory: (kind: TranslationHistoryKind, query: string, response: string, provider?: AiProvider) => void;
}

export const TranslationModal: React.FC<Props> = ({
  isOpen,
  onClose,
  selectedText,
  aiProvider,
  aiApiKey,
  onSaveHistory,
}) => {
  const [translatedText, setTranslatedText] = useState<string>('');
  const [dictionaryTerms, setDictionaryTerms] = useState<{
    baseForm: string;
    searchTerms: string[];
    entries: DictionaryEntry[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!isOpen || !selectedText) return;

    let cancelled = false;
    setTranslatedText('');
    setDictionaryTerms(null);
    setIsLoading(true);

    getDictionarySearchTerms(selectedText)
      .then((lookup) => {
        const terms = {
          baseForm: lookup.baseForm,
          searchTerms: lookup.searchTerms,
          entries: lookup.entries,
        };
        if (cancelled) return;
        setDictionaryTerms(terms);
        onSaveHistory(
          'dictionary',
          selectedText,
          formatDictionaryHistoryResponse(terms.baseForm, terms.searchTerms, terms.entries)
        );
      })
      .catch(() => {
        if (!cancelled) setDictionaryTerms(null);
      });

    const translate = async () => {
      const provider = aiProvider || 'google';
      const providerKey = aiApiKey || '';
      const cachedTranslation = getCachedTranslation(provider, selectedText, providerKey);
      const resultKind: TranslationHistoryKind = aiProvider ? 'ai' : 'translation';
      if (cachedTranslation) {
        if (!cancelled) {
          setTranslatedText(cachedTranslation);
          onSaveHistory(resultKind, selectedText, cachedTranslation, aiProvider);
          setIsLoading(false);
        }
        return;
      }

      try {
        let result: string;
        if (aiProvider && aiApiKey) {
          result = await translateWithAi(aiProvider, aiApiKey, selectedText);
        } else {
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=es&dt=t&q=${encodeURIComponent(selectedText)}`;
          const res = await fetch(url);
          const data = await res.json();
          if (data && data[0]) {
            result = data[0].map((item: [string]) => item[0]).join('');
          } else {
            result = 'No se pudo traducir el texto.';
          }
        }
        if (cancelled) return;
        setTranslatedText(result);
        saveCachedTranslation(provider, selectedText, result, providerKey);
        onSaveHistory(resultKind, selectedText, result, aiProvider);
      } catch (err) {
        if (!cancelled) setTranslatedText(err instanceof Error ? err.message : 'Traducción no disponible.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void translate();
    return () => { cancelled = true; };
  }, [aiApiKey, aiProvider, isOpen, onSaveHistory, selectedText]);

  if (!isOpen) return null;

  const handleSpeak = () => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(selectedText);
    utterance.lang = 'ja-JP';
    utterance.rate = 0.9;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

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
              <div className="text-sm text-zinc-800 dark:text-zinc-200 break-words leading-relaxed select-text">
                {translatedText || 'Sin traducción.'}
              </div>
            )}
          </div>

          {/* Local dictionary */}
          {dictionaryTerms && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 p-3 text-xs text-emerald-900 dark:text-emerald-200 space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-1.5 text-emerald-700 dark:text-emerald-300">
                Diccionario JMDict local
              </div>
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
              {dictionaryTerms.entries.length === 0 ? (
                <p className="text-zinc-600 dark:text-zinc-400">
                  No se encontró una entrada local para esta forma.
                </p>
              ) : (
                <div className="space-y-2">
                  {dictionaryTerms.entries.map((entry) => (
                    <div key={entry.id} className="rounded-lg bg-white/75 dark:bg-zinc-900/60 p-2.5">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
                          {entry.kanji.length ? entry.kanji.join(' · ') : entry.kana.join(' · ')}
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
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
