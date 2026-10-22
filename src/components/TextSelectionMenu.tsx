import React, { useState } from 'react';
import { Copy, Languages, Volume2, Search, BookOpen, Check, X, Underline, TextSearch, StickyNote } from 'lucide-react';
import { AiProvider } from '../types/epub';
import { AI_PROVIDER_LABELS } from '../utils/aiTranslation';
import { DictionaryLookup } from '../utils/dictionary';
import { speakJapanese } from '../utils/japaneseSpeech';
import { useT } from '../i18n/LanguageContext';
import { isOptionalDictionaryId, JMDICT_SOURCE, OPTIONAL_DICTIONARIES } from '../utils/optionalDictionaries';
import { classifyEntry } from '../utils/wordLevels';
import { useWordLevels, WordLevelBadge } from './WordLevelBadge';

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
  onClose: () => void;
  onOpenTranslate: () => void;
  onOpenDictionary: () => void;
  dictionaryPreview: DictionaryLookup | null;
  isUnderlined: boolean;
  onToggleUnderline: () => void;
  /** Whether the underlined passage already has a note. */
  hasNote?: boolean;
  /** Underlines the selection, if it is not, and opens its note. */
  onAddNote: () => void;
  onSearchInBook: () => void;
  aiProviders: AiProvider[];
  onOpenAiTranslate: (provider: AiProvider) => void;
}

export const TextSelectionMenu: React.FC<Props> = ({
  selectedText,
  position,
  isAdjusting = false,
  onClose,
  onOpenTranslate,
  onOpenDictionary,
  dictionaryPreview,
  isUnderlined,
  onToggleUnderline,
  hasNote = false,
  onAddNote,
  onSearchInBook,
  aiProviders,
  onOpenAiTranslate,
}) => {
  const t = useT();
  const wordLevels = useWordLevels();
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
      setSpeechError(error instanceof Error ? error.message : t('menu.ttsError'));
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
        {/* Mobile Preview Header */}
        {isMobile && (
          <div className="flex items-center gap-1 pl-2 pb-1 border-b border-zinc-700/60 text-xs">
            <span className="min-w-0 flex-1 truncate text-zinc-300 font-serif">
              "{selectedText}"
            </span>

            {aiProviders.map((provider) => (
              <button
                key={provider}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAiTranslate(provider);
                }}
                className="tap-area flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs font-medium transition-all text-amber-300 hover:text-white"
                title={`${t('common.translate')} (${AI_PROVIDER_LABELS[provider]})`}
              >
                <span>{t('common.ai')} {AI_PROVIDER_LABELS[provider]}</span>
              </button>
            ))}

            {/* Close, in the corner where the thumb expects it and large enough to hit. */}
            <button
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
              className="tap-area-free flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-300 hover:text-white active:scale-95"
              title={t('menu.close')}
              aria-label={t('menu.close')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {dictionaryPreview?.entries[0] && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDictionary();
            }}
            className="w-full rounded-xl border border-emerald-400/20 bg-emerald-950/35 px-3 py-2 text-left transition-colors hover:bg-emerald-950/60"
            title={t('menu.openDictDetails')}
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
              {wordLevels && <WordLevelBadge level={classifyEntry(wordLevels, dictionaryPreview.entries[0])} />}
            </span>
            <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-zinc-200">
              {dictionaryPreview.entries[0].senses
                .slice(0, 2)
                .map((sense) => sense.glosses.join('; '))
                .join(' · ')}
            </span>
            <span className="mt-1 block text-[9px] text-zinc-400">
              {isOptionalDictionaryId(dictionaryPreview.entries[0].language)
                ? OPTIONAL_DICTIONARIES[dictionaryPreview.entries[0].language].source.label
                : JMDICT_SOURCE.label}
            </span>
          </button>
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
            title={isUnderlined ? t('menu.removeUnderline') : t('menu.underline')}
            aria-label={isUnderlined ? t('menu.removeUnderline') : t('menu.underline')}
            aria-pressed={isUnderlined}
          >
            <Underline className="h-3.5 w-3.5" />
            {!isMobile && <span>{isUnderlined ? t('menu.removeUnderline') : t('menu.underline')}</span>}
          </button>

          {/* Nota */}
          <button
            onClick={(event) => {
              event.stopPropagation();
              onAddNote();
            }}
            className={`tap-area flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium transition-all hover:bg-zinc-800 active:scale-95 ${
              hasNote ? 'text-amber-300' : 'text-zinc-100'
            }`}
            title={hasNote ? t('notes.edit') : t('notes.add')}
            aria-label={hasNote ? t('notes.edit') : t('notes.add')}
          >
            <StickyNote className="h-3.5 w-3.5" />
            {!isMobile && <span>{hasNote ? t('notes.edit') : t('notes.add')}</span>}
          </button>

          {/* Copiar */}
          <button
            onClick={handleCopy}
            className="tap-area flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs font-medium transition-all"
            title={t('menu.copy')}
            aria-label={t('menu.copy')}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {!isMobile && <span>{copied ? t('menu.copied') : t('menu.copy')}</span>}
          </button>

          {/* Traducir */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenDictionary();
            }}
            className="tap-area flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs font-medium transition-all text-indigo-300 hover:text-white"
            title={t('menu.translate')}
          >
            <Languages className="w-3.5 h-3.5" />
            <span>{t('menu.translate')}</span>
          </button>

          {/* Diccionario local */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenTranslate();
            }}
            className="tap-area flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs font-medium transition-all text-emerald-300 hover:text-white"
            title={t('menu.dictLocal')}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>{t('menu.dict')}</span>
          </button>

          {/* Pronunciación TTS */}
          <button
            onClick={handleSpeak}
            disabled={isSpeaking}
            className="tap-area p-2 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs transition-all text-amber-300 hover:text-white disabled:opacity-50"
            title={t('menu.tts')}
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
            title={t('menu.searchInBook')}
            aria-label={t('menu.searchInBook')}
          >
            <TextSearch className="w-4 h-4" />
          </button>

          {/* Buscar en Google */}
          <button
            onClick={handleSearchGoogle}
            className="tap-area p-2 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs transition-all text-zinc-300 hover:text-white"
            title={t('menu.googleSearch')}
          >
            <Search className="w-4 h-4" />
          </button>

          {!isMobile && (
            <>
              <div className="w-px h-4 bg-zinc-700 mx-0.5" />
              <button
                onClick={onClose}
                className="tap-area p-1.5 rounded-xl hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                title={t('menu.close')}
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
