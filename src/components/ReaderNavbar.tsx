import React from 'react';
import { BookMetadata, ReaderSettingsState } from '../types/epub';
import {
  Menu,
  SlidersHorizontal,
  FolderOpen,
  Maximize2,
  Minimize2,
  Columns,
  Rows,
  List,
} from 'lucide-react';

interface Props {
  metadata: BookMetadata;
  chapterTitle?: string;
  isVisible: boolean;
  onToggleToc: () => void;
  onOpenBookmarks: () => void;
  bookmarkCount: number;
  onToggleSettings: () => void;
  onOpenFile: () => void;
  settings: ReaderSettingsState;
  onUpdateSettings: (newSettings: Partial<ReaderSettingsState>) => void;
}

export const ReaderNavbar: React.FC<Props> = ({
  metadata,
  chapterTitle,
  isVisible,
  onToggleToc,
  onOpenBookmarks,
  bookmarkCount,
  onToggleSettings,
  onOpenFile,
  settings,
  onUpdateSettings,
}) => {
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const isVertical = settings.writingMode === 'vertical-rl';

  return (
    <header
      data-reader-chrome="header"
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 transform ${
        isVisible ? 'translate-y-0 opacity-100 pointer-events-auto' : '-translate-y-full opacity-0 pointer-events-none'
      }`}
    >
      <div className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800/80 px-4 py-3 shadow-sm flex items-center justify-between">
        {/* Left: Open file & TOC */}
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={onOpenFile}
            title="Abrir otro libro EPUB"
            className="tap-area p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors flex items-center gap-1.5 text-xs font-medium"
          >
            <FolderOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span className="hidden sm:inline">Abrir</span>
          </button>
          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700 mx-1" />
          <button
            onClick={onToggleToc}
            title="Tabla de contenidos / Capítulos"
            className="tap-area p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors flex items-center gap-1.5 text-xs font-medium"
          >
            <Menu className="w-4 h-4" />
            <span className="hidden md:inline">Índice</span>
          </button>
          <button
            onClick={onOpenBookmarks}
            title={`Marcadores (${bookmarkCount})`}
            aria-label={`Abrir marcadores (${bookmarkCount})`}
            className="tap-area relative rounded-lg p-2 text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <List className="h-4 w-4" />
            {bookmarkCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-amber-950">
                {bookmarkCount}
              </span>
            )}
          </button>
        </div>

        {/* Center: Book & Chapter Info */}
        <div className="flex-1 px-4 text-center truncate max-w-md">
          <div className="text-xs sm:text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">
            {metadata.title}
          </div>
          <div className="text-[10px] sm:text-xs text-zinc-500 dark:text-zinc-400 truncate">
            {metadata.creator} {chapterTitle ? `• ${chapterTitle}` : ''}
          </div>
        </div>

        {/* Right: Quick actions & Settings */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Quick Vertical/Horizontal Mode Toggle */}
          <button
            onClick={() =>
              onUpdateSettings({
                writingMode: isVertical ? 'horizontal-tb' : 'vertical-rl',
                progressionDirection: isVertical ? 'ltr' : 'rtl',
              })
            }
            title={isVertical ? 'Cambiar a lectura horizontal' : 'Cambiar a lectura vertical japonesa'}
            className="tap-area p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors flex items-center gap-1 text-xs font-medium"
          >
            {isVertical ? (
              <>
                <Rows className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="hidden sm:inline text-xs">縦書き</span>
              </>
            ) : (
              <>
                <Columns className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                <span className="hidden sm:inline text-xs">横書き</span>
              </>
            )}
          </button>

          {/* Typography Settings (Aa) */}
          <button
            onClick={onToggleSettings}
            title="Ajustes de fuente y tema"
            className="tap-area p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors flex items-center gap-1 text-xs font-medium"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="font-serif font-bold text-sm leading-none">Aa</span>
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            className="tap-area p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors hidden sm:flex"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </header>
  );
};
