import React, { useLayoutEffect, useRef, useState } from 'react';
import { Copy, Languages, Volume2, Search, BookOpen, Check, X, Underline, TextSearch } from 'lucide-react';
import { AiProvider } from '../types/epub';
import { AI_PROVIDER_LABELS } from '../utils/aiTranslation';
import { DictionaryLookup } from '../utils/dictionary';
import { speakJapanese } from '../utils/japaneseSpeech';
import { t, UiLanguage } from '../utils/i18n';

export interface SelectionPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A tap that selects a word reveals this menu exactly where the finger was (on
 * phones it is docked against the bottom edge), and the browser then finishes
 * the gesture by firing the compatibility `mousedown`/`click` of that same tap
 * at those coordinates. Hit-testing starts again from the top document, so they
 * land on the menu that was not there when the touch began: the button under
 * the finger lights up (`:active`) and opens the dictionary or the translation
 * by accident.
 *
 * Two lines of defence, because blocking only the `click` still leaves the
 * button receiving (and visually reacting to) the press:
 *
 *  1. `MENU_GHOST_TAP_GUARD_MS`: right after every selection the menu is not
 *     hit-testable at all, so those leftover events fall through to the page —
 *     the route every ordinary tap already takes — and never reach the menu.
 *  2. `MENU_INTERACTION_WINDOW_MS`: a click is only honoured when a
 *     `pointerdown` (or a `keydown`, for keyboard users) on the menu itself
 *     preceded it, so anything that slips past the guard is still swallowed
 *     during capture before it can reach a button.
 */
const MENU_GHOST_TAP_GUARD_MS = 400;
const MENU_INTERACTION_WINDOW_MS = 1000;

interface Props {
  selectedText: string;
  position: SelectionPosition | null;
  isAdjusting?: boolean;
  language?: UiLanguage;
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
  // While `settling`, the menu is on screen but not hit-testable: the leftover
  // events of the gesture that opened it pass straight through it.
  const [settling, setSettling] = useState(true);
  const lastInteractionAtRef = useRef(0);

  const isVisible = Boolean(selectedText.trim()) && !isAdjusting;

  // The tap that opened the menu has not finished when the menu appears — the
  // browser still owes the `mousedown`/`click` of that same gesture, at
  // coordinates that now fall on the menu. Keeping `pointer-events: none`
  // until they have been delivered means the button is never the target: no
  // `:active` flash, no handler, nothing. `position` is a fresh object on
  // every selection, so each tapped word gets its own guard; `useLayoutEffect`
  // so the attribute is applied before the browser gets to dispatch them.
  useLayoutEffect(() => {
    if (!isVisible) {
      setSettling(true);
      return;
    }
    setSettling(true);
    const timer = window.setTimeout(() => setSettling(false), MENU_GHOST_TAP_GUARD_MS);
    return () => window.clearTimeout(timer);
  }, [isVisible, position]);

  // Second line of defence for anything that outlives the guard above.
  // Records the moment the user actually interacted *with the menu*; a click
  // without such a preceding event is the leftover of the gesture that opened
  // the menu, not a new decision by the user.
  const markMenuInteraction = () => {
    lastInteractionAtRef.current = Date.now();
  };

  const handleClickCapture = (event: React.MouseEvent) => {
    if (Date.now() - lastInteractionAtRef.current <= MENU_INTERACTION_WINDOW_MS) return;
    // Swallowed during capture so it never reaches the buttons below.
    event.preventDefault();
    event.stopPropagation();
  };

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
      setSpeechError(error instanceof Error ? error.message : t('menu.ttsError', language));
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
      onPointerDownCapture={markMenuInteraction}
      onKeyDownCapture={markMenuInteraction}
      onClickCapture={handleClickCapture}
      className={`z-[60] select-none transition-opacity ${
        isAdjusting
          ? 'duration-0 opacity-0 pointer-events-none'
          : settling
            ? 'duration-200 opacity-100 pointer-events-none'
            : 'duration-200 opacity-100 pointer-events-auto'
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
            title={t('menu.openDictDetails', language)}
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
              title={t('menu.close', language)}
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
                title={`${t('common.translate', language)} (${AI_PROVIDER_LABELS[provider]})`}
              >
                <span>{t('common.ai', language)} {AI_PROVIDER_LABELS[provider]}</span>
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
            title={t('menu.copy', language)}
            aria-label={t('menu.copy', language)}
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
            title={t('menu.dictLocal', language)}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>{t('menu.dict', language)}</span>
          </button>

          {/* Pronunciación TTS */}
          <button
            onClick={handleSpeak}
            disabled={isSpeaking}
            className="tap-area p-2 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs transition-all text-amber-300 hover:text-white disabled:opacity-50"
            title={t('menu.tts', language)}
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
            title={t('menu.searchInBook', language)}
            aria-label={t('menu.searchInBook', language)}
          >
            <TextSearch className="w-4 h-4" />
          </button>

          {/* Buscar en Google */}
          <button
            onClick={handleSearchGoogle}
            className="tap-area p-2 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs transition-all text-zinc-300 hover:text-white"
            title={t('menu.googleSearch', language)}
          >
            <Search className="w-4 h-4" />
          </button>

          {!isMobile && (
            <>
              <div className="w-px h-4 bg-zinc-700 mx-0.5" />
              <button
                onClick={onClose}
                className="tap-area p-1.5 rounded-xl hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                title={t('menu.close', language)}
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
