import React from 'react';
import { BookMetadata, ReaderSettingsState } from '../types/epub';
import { GoogleDriveSession } from '../utils/googleDriveBackup';
import { SyncStatusBadge } from './SyncStatusBadge';
import { t, UiLanguage, SyncErrorState } from '../utils/i18n';
import {
  Menu,
  SlidersHorizontal,
  FolderOpen,
  Columns,
  Rows,
  List,
  History,
  Search,
  Languages,
  BookOpen,
  Eye,
  EyeOff,
} from 'lucide-react';

interface Props {
  metadata: BookMetadata;
  chapterTitle?: string;
  isVisible: boolean;
  onToggleToc: () => void;
  onOpenBookmarks: () => void;
  onOpenSearch: () => void;
  bookmarkCount: number;
  annotationCount: number;
  onOpenHistory: () => void;
  historyCount: number;
  favoriteCount: number;
  frequentCount: number;
  onToggleSettings: () => void;
  onOpenFile: () => void;
  isAnalyzingPage: boolean;
  isWordSelectionMode: boolean;
  onToggleAutoAnalysis: () => void;
  onOpenPageGlossary: () => void;
  settings: ReaderSettingsState;
  onUpdateSettings: (newSettings: Partial<ReaderSettingsState>) => void;
  googleDriveSession?: GoogleDriveSession | null;
  isDriveBusy?: boolean;
  syncError?: SyncErrorState;
  onRetry?: () => void;
  lastSyncedDate?: string | null;
  isBookUploaded?: boolean;
  onUploadBook?: () => void;
  language?: UiLanguage;
}

export const ReaderNavbar: React.FC<Props> = ({
  metadata,
  chapterTitle,
  isVisible,
  onToggleToc,
  onOpenBookmarks,
  onOpenSearch,
  bookmarkCount,
  annotationCount,
  onOpenHistory,
  historyCount,
  favoriteCount,
  frequentCount,
  onToggleSettings,
  onOpenFile,
  isAnalyzingPage,
  isWordSelectionMode,
  onToggleAutoAnalysis,
  onOpenPageGlossary,
  settings,
  onUpdateSettings,
  googleDriveSession,
  isDriveBusy,
  syncError,
  onRetry,
  lastSyncedDate,
  isBookUploaded,
  onUploadBook,
  language = 'es',
}) => {
  const isVertical = settings.writingMode === 'vertical-rl';
  const isAnalyzerActive = settings.autoAnalyzePage || isWordSelectionMode;
  const analyzerTitle = settings.autoAnalyzePage
    ? t('nav.analyzerOn', language)
    : isWordSelectionMode
      ? t('nav.analyzerPageOff', language)
      : t('nav.analyzerOff', language);

  return (
    <header
      data-reader-chrome="header"
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 transform ${
        isVisible ? 'translate-y-0 opacity-100 pointer-events-auto' : '-translate-y-full opacity-0 pointer-events-none'
      }`}
    >
      <div className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800/80 px-3 py-3 shadow-sm">
        <div
          className="flex min-w-0 items-center gap-1 overflow-x-auto pt-2 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: 'none' }}
        >
          {/* Navigation and book actions */}
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              onClick={onOpenFile}
              title={t('nav.openTitle', language)}
              className="tap-area p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors flex items-center gap-1.5 text-xs font-medium"
            >
              <FolderOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span className="hidden sm:inline">{t('nav.open', language)}</span>
            </button>
            <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700 mx-1" />
            <button
              onClick={onToggleToc}
              title={t('nav.tocTitle', language)}
              className="tap-area p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors flex items-center gap-1.5 text-xs font-medium"
            >
              <Menu className="w-4 h-4" />
              <span className="hidden md:inline">{t('nav.toc', language)}</span>
            </button>
            <button
              onClick={onOpenBookmarks}
              title={`${t('bookmarks.title', language)} (${bookmarkCount + annotationCount})`}
              aria-label={`${t('bookmarks.title', language)} (${bookmarkCount + annotationCount})`}
              className="tap-area relative rounded-lg p-2 text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <List className="h-4 w-4" />
              {bookmarkCount + annotationCount > 0 && (
                <span className="absolute -right-0.5 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-amber-950">
                  {bookmarkCount + annotationCount}
                </span>
              )}
            </button>
            <button
              onClick={onOpenSearch}
              title={t('nav.searchTitle', language)}
              aria-label={t('nav.search', language)}
              className="tap-area rounded-lg p-2 text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Search className="h-4 w-4" />
            </button>
            <button
              onClick={onOpenHistory}
              title={`${t('history.title', language)} (${historyCount} ${t('history.queries', language)}, ${favoriteCount} ${t('history.tabFavorites', language).toLowerCase()}, ${frequentCount} ${t('history.tabFrequent', language).toLowerCase()})`}
              aria-label={`${t('history.title', language)} (${historyCount} ${t('history.queries', language)}, ${favoriteCount} ${t('history.tabFavorites', language).toLowerCase()}, ${frequentCount} ${t('history.tabFrequent', language).toLowerCase()})`}
              className="tap-area relative rounded-lg p-2 text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <History className="h-4 w-4" />
              {historyCount + favoriteCount + frequentCount > 0 && (
                <span className="absolute -right-0.5 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500 px-1 text-[9px] font-bold text-white">
                  {historyCount + favoriteCount + frequentCount}
                </span>
              )}
            </button>
          </div>

          {/* Reader controls */}
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={onToggleAutoAnalysis}
              title={analyzerTitle}
              aria-label={analyzerTitle}
              aria-pressed={isAnalyzerActive}
              className={`tap-area rounded-lg p-2 transition-colors ${
                isAnalyzerActive
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
              }`}
            >
              {isAnalyzingPage
                ? <span className="block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                : <Languages className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onOpenPageGlossary}
              disabled={isAnalyzingPage}
              title={t('nav.glossary', language)}
              aria-label={t('nav.glossary', language)}
              className="tap-area rounded-lg p-2 text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <BookOpen className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onUpdateSettings({ showFurigana: !settings.showFurigana })}
              title={settings.showFurigana ? t('nav.hideFurigana', language) : t('nav.showFurigana', language)}
              aria-label={settings.showFurigana ? t('nav.hideFurigana', language) : t('nav.showFurigana', language)}
              aria-pressed={settings.showFurigana}
              className={`tap-area rounded-lg p-2 transition-colors ${
                settings.showFurigana
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
              }`}
            >
              {settings.showFurigana
                ? <Eye className="h-4 w-4" />
                : <EyeOff className="h-4 w-4" />}
            </button>

            {/* Quick Vertical/Horizontal Mode Toggle */}
            <button
              onClick={() =>
                onUpdateSettings({
                  writingMode: isVertical ? 'horizontal-tb' : 'vertical-rl',
                  progressionDirection: isVertical ? 'ltr' : 'rtl',
                })
              }
              title={isVertical ? t('nav.switchToHorizontal', language) : t('nav.switchToVertical', language)}
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
              title={t('nav.settings', language)}
              className="tap-area p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors flex items-center gap-1 text-xs font-medium"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="font-serif font-bold text-sm leading-none">Aa</span>
            </button>
          </div>
        </div>

        {/* Book title on its own row keeps it readable beside the toolbar actions. */}
        <div className="pt-1.5 flex items-center justify-between px-2">
          <div className="min-w-0 flex-1 pr-2">
            <div className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100 sm:text-sm">
              {metadata.title}
            </div>
            <div className="truncate text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
              {metadata.creator} {chapterTitle ? `• ${chapterTitle}` : ''}
            </div>
          </div>
          {googleDriveSession && onRetry && (
            <div className="shrink-0">
              <SyncStatusBadge
                googleDriveSession={googleDriveSession}
                isDriveBusy={isDriveBusy}
                syncError={syncError}
                onRetry={onRetry}
                lastSyncedDate={lastSyncedDate}
                isBookUploaded={isBookUploaded}
                onUploadBook={onUploadBook}
                align="right"
                language={language}
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
