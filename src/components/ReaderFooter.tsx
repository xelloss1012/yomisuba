import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, SkipBack, SkipForward } from 'lucide-react';
import { ProgressionDirection } from '../types/epub';
import { formatPageDisplay } from '../utils/paginationDisplay';
import { useLanguage, useT } from '../i18n/LanguageContext';

interface Props {
  isVisible: boolean;
  currentPage: number;
  displayPage?: number;
  totalPages: number;
  currentChapterPage?: number;
  currentChapterTotalPages?: number;
  currentSpineIndex: number;
  totalSpineCount: number;
  displayChapter?: number;
  displayChapterCount?: number;
  direction: ProgressionDirection;
  isVertical: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
  onSeekPage: (page: number) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  bookmarkPages: number[];
  paginationMode: 'device' | 'printed' | 'percent';
  printedPages?: number;
  onTogglePaginationMode: () => void;
}

export const ReaderFooter: React.FC<Props> = ({
  isVisible,
  currentPage,
  displayPage = currentPage,
  totalPages,
  currentChapterPage = currentPage,
  currentChapterTotalPages = totalPages,
  currentSpineIndex,
  totalSpineCount,
  displayChapter = currentSpineIndex + 1,
  displayChapterCount = totalSpineCount,
  direction,
  isVertical,
  onPrevPage,
  onNextPage,
  onSeekPage,
  onPrevChapter,
  onNextChapter,
  bookmarkPages,
  paginationMode,
  printedPages,
  onTogglePaginationMode,
}) => {
  const t = useT();
  const language = useLanguage();
  const isRtl = direction === 'rtl' || isVertical;
  const safeTotalPages = Math.max(1, totalPages);
  const safeChapterPages = Math.max(1, currentChapterTotalPages);
  const safeDisplayPage = Math.min(Math.max(0, displayPage), safeTotalPages - 1);
  const sliderMax = safeTotalPages - 1;
  const [pendingSliderPage, setPendingSliderPage] = useState(
    isRtl ? sliderMax - safeDisplayPage : safeDisplayPage
  );
  const committedSliderPageRef = useRef<number | null>(null);
  useEffect(() => {
    setPendingSliderPage(isRtl ? sliderMax - safeDisplayPage : safeDisplayPage);
  }, [isRtl, safeDisplayPage, sliderMax]);

  const commitSliderPage = () => {
    const requestedPage = isRtl ? sliderMax - pendingSliderPage : pendingSliderPage;
    if (committedSliderPageRef.current === requestedPage) return;
    committedSliderPageRef.current = requestedPage;
    onSeekPage(requestedPage);
  };

  const handleLeftClick = isRtl ? onNextPage : onPrevPage;
  const handleRightClick = isRtl ? onPrevPage : onNextPage;

  const leftLabel = isRtl ? t('footer.nextChapter') : t('footer.prevChapter');
  const rightLabel = isRtl ? t('footer.prevChapter') : t('footer.nextChapter');

  const isLeftDisabled = isRtl
    ? currentChapterPage >= safeChapterPages - 1 && currentSpineIndex >= totalSpineCount - 1
    : currentChapterPage === 0 && currentSpineIndex === 0;

  const isRightDisabled = isRtl
    ? currentChapterPage === 0 && currentSpineIndex === 0
    : currentChapterPage >= safeChapterPages - 1 && currentSpineIndex >= totalSpineCount - 1;

  return (
    <footer
      data-reader-chrome="footer"
      className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-300 transform ${
        isVisible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-full opacity-0 pointer-events-none'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-zinc-200/80 dark:border-zinc-800/80 px-3 pt-2.5 pb-[max(calc(env(safe-area-inset-bottom,0px)+12px),18px)] shadow-2xl max-w-2xl mx-auto rounded-t-2xl sm:mb-2 sm:rounded-2xl border">
        <div className="relative mb-2 px-1">
          <input
            type="range"
            min={0}
            max={sliderMax}
            step={1}
            value={pendingSliderPage}
            onChange={(event) => setPendingSliderPage(Number(event.target.value))}
            onPointerUp={commitSliderPage}
            onKeyUp={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
                commitSliderPage();
              }
            }}
            onBlur={commitSliderPage}
            disabled={safeTotalPages <= 1}
            aria-label={t('footer.sliderTitle')}
            title={`${t('footer.sliderTitle')} ${isRtl ? sliderMax - pendingSliderPage + 1 : pendingSliderPage + 1} / ${safeTotalPages}`}
            className="reader-progress w-full cursor-pointer disabled:cursor-default disabled:opacity-40"
          />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-0">
            {bookmarkPages.map((page) => {
              const clampedPage = Math.min(Math.max(0, page), sliderMax);
              const ratio = sliderMax === 0
                ? 0
                : (isRtl ? sliderMax - clampedPage : clampedPage) / sliderMax;
              return (
                <button
                  key={page}
                  type="button"
                  onClick={() => onSeekPage(clampedPage)}
                  className="pointer-events-auto absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-amber-600 drop-shadow dark:text-amber-400"
                  style={{
                    left: `calc(9px + ${ratio * 100}% - ${ratio * 18}px)`,
                  }}
                  title={`${t('bookmarks.tabBookmarks')}, ${t('common.page').toLowerCase()} ${clampedPage + 1}`}
                  aria-label={`${t('bookmarks.tabBookmarks')}, ${t('common.page').toLowerCase()} ${clampedPage + 1}`}
                >
                  <span className="block h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-500 shadow dark:border-zinc-900" />
                </button>
              );
            })}
          </div>
        </div>
        {/* Navigation buttons & Page Indicator */}
        <div className="flex items-center justify-between gap-1.5 sm:gap-3">
          {/* Chapter Jump Back */}
          <button
            onClick={isRtl ? onNextChapter : onPrevChapter}
            disabled={isRtl ? currentSpineIndex >= totalSpineCount - 1 : currentSpineIndex === 0}
            title={isRtl ? t('footer.nextChapter') : t('footer.prevChapter')}
            className="tap-area p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-25 text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          {/* Left Page Turn Button */}
          <button
            onClick={handleLeftClick}
            disabled={isLeftDisabled}
            title={`${t('common.page')} ${leftLabel.toLowerCase()}`}
            className={`tap-area py-2 px-3 rounded-xl transition-all flex items-center gap-1 text-xs font-semibold ${
              isRtl
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-30'
                : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 disabled:opacity-30'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{leftLabel}</span>
          </button>

          {/* Center Info */}
          <button
            type="button"
            onClick={onTogglePaginationMode}
            title={t('footer.changePaginationMode')}
            className="flex-1 flex flex-col items-center justify-center px-1 text-center cursor-pointer hover:opacity-80 transition-opacity bg-transparent border-0"
          >
            <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
              {formatPageDisplay(safeDisplayPage, safeTotalPages, paginationMode, printedPages, language)}
            </div>
            <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 truncate max-w-[180px] sm:max-w-none">
              {t('footer.chapter')} {displayChapter}/{displayChapterCount}
              {paginationMode !== 'device' && ` • [${paginationMode === 'printed' ? t('footer.modePrinted') : t('footer.modePercent')}]`}
            </div>
          </button>

          {/* Right Page Turn Button */}
          <button
            onClick={handleRightClick}
            disabled={isRightDisabled}
            title={`${t('common.page')} ${rightLabel.toLowerCase()}`}
            className={`tap-area py-2 px-3 rounded-xl transition-all flex items-center gap-1 text-xs font-semibold ${
              !isRtl
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-30'
                : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 disabled:opacity-30'
            }`}
          >
            <span>{rightLabel}</span>
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Chapter Jump Forward */}
          <button
            onClick={isRtl ? onPrevChapter : onNextChapter}
            disabled={isRtl ? currentSpineIndex === 0 : currentSpineIndex >= totalSpineCount - 1}
            title={isRtl ? t('footer.prevChapter') : t('footer.nextChapter')}
            className="tap-area p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-25 text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      </div>
    </footer>
  );
};
