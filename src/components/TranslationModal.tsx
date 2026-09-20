import React, { useState, useEffect } from 'react';
import { X, Volume2, ExternalLink, Languages, BookOpen, Loader2 } from 'lucide-react';
import { AiProvider } from '../types/epub';
import { AI_PROVIDER_LABELS, translateWithAi } from '../utils/aiTranslation';
import { getCachedTranslation, saveCachedTranslation } from '../utils/translationCache';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedText: string;
  aiProvider?: AiProvider;
  aiApiKey?: string;
}

export const TranslationModal: React.FC<Props> = ({ isOpen, onClose, selectedText, aiProvider, aiApiKey }) => {
  const [translatedText, setTranslatedText] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!isOpen || !selectedText) return;

    const translate = async () => {
      setIsLoading(true);
      const provider = aiProvider || 'google';
      const providerKey = aiApiKey || '';
      const cachedTranslation = getCachedTranslation(provider, selectedText, providerKey);
      if (cachedTranslation) {
        setTranslatedText(cachedTranslation);
        setIsLoading(false);
        return;
      }

      try {
        if (aiProvider && aiApiKey) {
          const result = await translateWithAi(aiProvider, aiApiKey, selectedText);
          setTranslatedText(result);
          saveCachedTranslation(provider, selectedText, result, providerKey);
        } else {
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=es&dt=t&q=${encodeURIComponent(selectedText)}`;
          const res = await fetch(url);
          const data = await res.json();
          if (data && data[0]) {
            const result = data[0].map((item: [string]) => item[0]).join('');
            setTranslatedText(result);
            saveCachedTranslation(provider, selectedText, result, providerKey);
          } else {
            setTranslatedText('No se pudo traducir el texto.');
          }
        }
      } catch (err) {
        setTranslatedText(err instanceof Error ? err.message : 'Traducción no disponible.');
      } finally {
        setIsLoading(false);
      }
    };

    translate();
  }, [aiApiKey, aiProvider, isOpen, selectedText]);

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

  const googleTranslateUrl = `https://translate.google.com/?sl=auto&tl=es&text=${encodeURIComponent(
    selectedText
  )}&op=translate`;

  const jishoUrl = `https://jisho.org/search/${encodeURIComponent(selectedText)}`;

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

          {/* External Links / Dictionary */}
          <div className="pt-2 flex flex-wrap gap-2">
            <a
              href={jishoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-[140px] px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
              <span>Ver en Jisho (辞書)</span>
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>

            <a
              href={googleTranslateUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-[140px] px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
            >
              <Languages className="w-3.5 h-3.5 text-blue-600" />
              <span>Google Traductor</span>
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
