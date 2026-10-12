import React, { useState } from 'react';
import { Copy, Languages, Volume2, Search, BookOpen, Check, X, Underline, TextSearch } from 'lucide-react';
import { AiProvider } from '../types/epub';
import { AI_PROVIDER_LABELS } from '../utils/aiTranslation';
import { DictionaryLookup } from '../utils/dictionary';
import { speakJapanese } from '../utils/japaneseSpeech';
import { t } from '../utils/i18n';

export interface SelectionPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  selectedText: string;
  position: SelectionPosition | null;
  isAdjusting?: boolean;
  language?: 'es' | 'en';
  onClose: () => void;
  onOpenTranslate: () => void;
  onOpenDictionary: () => void;
  dictionaryPreview: DictionaryLookup | null;
  isUnderlined: boolean;
  onToggleUnderline: () => void;
  onSearchInBook: () => void;
  aiProviders: AiProvider[];
  onOpenAiTranslate: (provider: AiProvider) => void;
}

export const TextSelectionMenu: React.FC<Props> = ({
  selectedText,
  position,
  isAdjusting = false,
  language = 'es',
  onClose,
  onOpenTranslate,
  onOpenDictionary,
  dictionaryPreview,
  isUnderlined,
  onToggleUnderline,
  onSearchInBook,
  aiProviders,
  onOpenAiTranslate,
}) => {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState('');

  if (!selectedText.trim()) return null;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(selectedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      return;
    } catch {
      // The Clipboard API is unavailable or not permitted in this frame.
    }
    try {
      const scratch = document.createElement('textarea');
      scratch.value = selectedText;
      scratch.setAttribute('readonly', '');
      scratch.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
      document.body.appendChild(scratch);
      scratch.select();
      scratch.setSelectionRange(0, selectedText.length);
      const copied = document.execCommand('copy');
      scratch.remove();
      if (copied) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Nothing else can be done without clipboard access.
    }
  };

  const handleSpeak = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleSearchGoogle = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(`https://www.google.com/search?q=${encodeURIComponent(selectedText)}`, '_blank');
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  let style: React.CSSProperties = {};
  if (!isMobile && position) {
    const menuWidth = 340;
    const menuHeight = 46;
    let left = position.x + position.width / 2 - menuWidth / 2;
    let top = position.y - menuHeight - 12;
    if (top < 50) {
      top = position.y + position.height + 12;
    }
    left = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, left));
    top = Math.max(12, Math.min(window.innerHeight - menuHeight - 12, top));
    style = { left: `${left}px`, top: `${top}px`, position: 'fixed' };
  } else if (isMobile) {
    style = {
      bottom: 'max(calc(env(safe-area-inset-bottom, 0px) + 85px), 92px)',
      position: 'fixed',
      left: '12px',
      right: '12px',
    };
  }

  return (
    <div
      data-selection-menu
      style={style}
      className={`z-[60] select-none transition-opacity ${
        isAdjusting ? 'duration-0 opacity-0 pointer-events-none' : 'duration-200 opacity-100 pointer-events-auto'
      } ${isMobile ? 'max-w-md mx-auto shadow-2xl' : 'shadow-2xl'}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-zinc-900/95 dark:bg-zinc-800/95 text-white rounded-2xl p-2 shadow-2xl backdrop-blur-xl border border-zinc-700/80 flex flex-col gap-1.5">
        {dictionaryPreview?.entries[0] && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDictionary();
            }}
            className="w-full rounded-xl border border-emerald-400/20 bg-emerald-950/35 px-3 py-2 text-left transition-colors hover:bg-emerald-950/60"
            title="Abrir la consulta completa del diccionario"
          >
            <span className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-emerald-200">
                {dictionaryPreview.entries[0].kanji.join(' · ') || dictionaryPreview.entries[0].kana.join(' · ')}
              </span>
              {dictionaryPreview.entries[0].kana.length > 0 && dictionaryPreview.entries[0].kanji.length > 0 && (
                <span className="text-xs text-zinc-400">
                  {dictionaryPreview.entries[0].kana.join(' · ')}
                </span>
              )}
              {dictionaryPreview.entries.length > 1 && (
                <span className="ml-auto text-[10px] text-zinc-400">
                  +{dictionaryPreview.entries.length - 1}
                </span>
              )}
              <span className="rounded bg-emerald-900/80 px-1 py-0.5 text-[9px] font-bold uppercase text-emerald-200">
                {dictionaryPreview.entries[0].language}
              </span>
            </span>
            <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-zinc-200">
              {dictionaryPreview.entries[0].senses
                .slice(0, 2)
                .map((sense) => sense.glosses.join('; '))
                .join(' · ')}
            </span>
            <span className="mt-1 block text-[9px] text-zinc-400">JMdict/EDICT © EDRDG</span>
          </button>
        )}

        {/* Mobile Preview Header */}
        {isMobile && (
          <div className="flex items-center justify-between px-2 pt-0.5 pb-1 border-b border-zinc-700/60 text-xs">
            <span className="truncate max-w-[240px] text-zinc-300 font-serif">
              "{selectedText}"
            </span>
            <button
              onClick={onClose}
              className="tap-area p-1 rounded-full text-zinc-400 hover:text-white"
              title="Cerrar menú"
            >
              <X className="w-3.5 h-3.5" />
            </button>

            {aiProviders.map((provider) => (
              <button
                key={provider}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAiTranslate(provider);
                }}
                className="tap-area flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs font-medium transition-all text-amber-300 hover:text-white"
                title={`Traducir con ${AI_PROVIDER_LABELS[provider]}`}
              >
                <span>IA {AI_PROVIDER_LABELS[provider]}</span>
              </button>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className={`flex items-center justify-between gap-1 ${isMobile ? 'flex-wrap' : ''}`}>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleUnderline();
            }}
            className={`tap-area flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium transition-all hover:bg-zinc-800 active:scale-95 ${
              isUnderlined ? 'text-amber-300' : 'text-zinc-100'
            }`}
            title={isUnderlined ? t('menu.removeUnderline', language) : t('menu.underline', language)}
            aria-label={isUnderlined ? t('menu.removeUnderline', language) : t('menu.underline', language)}
            aria-pressed={isUnderlined}
          >
            <Underline className="h-3.5 w-3.5" />
            {!isMobile && <span>{isUnderlined ? t('menu.removeUnderline', language) : t('menu.underline', language)}</span>}
          </button>

          {/* Copiar */}
          <button
            onClick={handleCopy}
            className="tap-area flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs font-medium transition-all"
            title="Copiar texto"
            aria-label="Copiar texto"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {!isMobile && <span>{copied ? t('menu.copied', language) : t('menu.copy', language)}</span>}
          </button>

          {/* Traducir */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenDictionary();
            }}
            className="tap-area flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs font-medium transition-all text-indigo-300 hover:text-white"
            title={t('menu.translate', language)}
          >
            <Languages className="w-3.5 h-3.5" />
            <span>{t('menu.translate', language)}</span>
          </button>

          {/* Diccionario local */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenTranslate();
            }}
            className="tap-area flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs font-medium transition-all text-emerald-300 hover:text-white"
            title="Consultar diccionario JMDict local"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>{t('menu.dict', language)}</span>
          </button>

          {/* Pronunciación TTS */}
          <button
            onClick={handleSpeak}
            disabled={isSpeaking}
            className="tap-area p-2 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs transition-all text-amber-300 hover:text-white disabled:opacity-50"
            title="Pronunciación en japonés"
          >
            <Volume2 className={`w-4 h-4 ${isSpeaking ? 'animate-pulse text-amber-400' : ''}`} />
          </button>

          {/* Buscar en el libro */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSearchInBook();
            }}
            className="tap-area p-2 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs transition-all text-sky-300 hover:text-white"
            title="Buscar en el libro"
            aria-label="Buscar en el libro"
          >
            <TextSearch className="w-4 h-4" />
          </button>

          {/* Buscar en Google */}
          <button
            onClick={handleSearchGoogle}
            className="tap-area p-2 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs transition-all text-zinc-300 hover:text-white"
            title="Buscar en Google"
          >
            <Search className="w-4 h-4" />
          </button>

          {!isMobile && (
            <>
              <div className="w-px h-4 bg-zinc-700 mx-0.5" />
              <button
                onClick={onClose}
                className="tap-area p-1.5 rounded-xl hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                title="Cerrar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
        {speechError && (
          <p role="alert" className="px-2 text-[10px] text-rose-300">{speechError}</p>
        )}
      </div>
    </div>
  );
};
