import React, { useState } from 'react';
import { Copy, Languages, Volume2, Search, BookOpen, Check, X, Underline } from 'lucide-react';
import { AiProvider } from '../types/epub';
import { AI_PROVIDER_LABELS } from '../utils/aiTranslation';

export interface SelectionPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  selectedText: string;
  position: SelectionPosition | null;
  /**
   * True while the selection is still being dragged. On mobile the menu is
   * docked across the full width near the bottom, which is exactly where a
   * vertical-rl page ends (bottom-left): keeping it interactive there would
   * swallow the touches meant for the text and block the selection handles
   * from reaching the edge of the page.
   */
  isAdjusting?: boolean;
  onClose: () => void;
  onOpenTranslate: () => void;
  onOpenDictionary: () => void;
  isUnderlined: boolean;
  onToggleUnderline: () => void;
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
  isUnderlined,
  onToggleUnderline,
  aiProviders,
  onOpenAiTranslate,
}) => {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

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

  const handleSpeak = (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleSearchGoogle = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(`https://www.google.com/search?q=${encodeURIComponent(selectedText)}`, '_blank');
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  // On desktop: float near selection.
  // On mobile: dock safely above the mobile browser's bottom navigation/search bar
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
    // Dock above mobile browser bottom bar (safari/chrome bottom address bar is ~60-75px)
    style = {
      bottom: 'max(calc(env(safe-area-inset-bottom, 0px) + 85px), 92px)',
      position: 'fixed',
      left: '12px',
      right: '12px',
    };
  }

  return (
    <div
      style={style}
      // Opacity is driven by classes alone, with no CSS animation involved.
      // animate-fade-in ends in `forwards`, and an animation outranks normal
      // declarations in the cascade: with it applied, `opacity-0` never took
      // effect and the menu stopped responding to touch while staying visible
      // over the text — the very thing it is meant to get out of the way of.
      // Mixing the two states (animation on one branch, class on the other)
      // is just as unreliable, so the fade now comes from the transition.
      className={`z-[60] select-none transition-opacity duration-200 ${
        isAdjusting ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
      } ${isMobile ? 'max-w-md mx-auto shadow-2xl' : 'shadow-2xl'}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-zinc-900/95 dark:bg-zinc-800/95 text-white rounded-2xl p-2 shadow-2xl backdrop-blur-xl border border-zinc-700/80 flex flex-col gap-1.5">
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
        <div className="flex items-center justify-between gap-1">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleUnderline();
            }}
            className={`tap-area flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium transition-all hover:bg-zinc-800 active:scale-95 ${
              isUnderlined ? 'text-amber-300' : 'text-zinc-100'
            }`}
            title={isUnderlined ? 'Quitar subrayado' : 'Subrayar texto'}
            aria-label={isUnderlined ? 'Quitar subrayado' : 'Subrayar texto'}
            aria-pressed={isUnderlined}
          >
            <Underline className="h-3.5 w-3.5" />
            <span>{isUnderlined ? 'Quitar subrayado' : 'Subrayar'}</span>
          </button>

          {/* Copiar */}
          <button
            onClick={handleCopy}
            className="tap-area flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs font-medium transition-all"
            title="Copiar texto"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copiado' : 'Copiar'}</span>
          </button>

          {/* Traducir */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenDictionary();
            }}
            className="tap-area flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl hover:bg-zinc-800 active:scale-95 text-xs font-medium transition-all text-indigo-300 hover:text-white"
            title="Traducir texto al español"
          >
            <Languages className="w-3.5 h-3.5" />
            <span>Traducir</span>
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
            <span>Diccionario</span>
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
      </div>
    </div>
  );
};
