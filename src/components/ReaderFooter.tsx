import React from 'react';
import { Bookmark, ChevronLeft, ChevronRight, SkipBack, SkipForward } from 'lucide-react';
import { ProgressionDirection } from '../types/epub';

interface Props {
  isVisible: boolean;
  currentPage: number;
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
  onPrevChapter: () => void;
  onNextChapter: () => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
}

export const ReaderFooter: React.FC<Props> = ({
  isVisible,
  currentPage,
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
  onPrevChapter,
  onNextChapter,
  isBookmarked,
  onToggleBookmark,
}) => {
  const isRtl = direction === 'rtl' || isVertical;
  const safeTotalPages = Math.max(1, totalPages);
  const safeChapterPages = Math.max(1, currentChapterTotalPages);
  const progressPercent = Math.round(((currentPage + 1) / safeTotalPages) * 100);
  const bookProgressPercent =
    displayChapterCount > 0 ? Math.round((displayChapter / displayChapterCount) * 100) : 0;

  // In RTL (Japanese vertical), left advances to NEXT page, right goes back to PREVIOUS.
  // In LTR (Western horizontal), left goes to PREVIOUS, right advances to NEXT.
  const handleLeftClick = isRtl ? onNextPage : onPrevPage;
  const handleRightClick = isRtl ? onPrevPage : onNextPage;

  const leftLabel = isRtl ? 'Siguiente' : 'Anterior';
  const rightLabel = isRtl ? 'Anterior' : 'Siguiente';

  const isLeftDisabled = isRtl
    ? currentChapterPage >= safeChapterPages - 1 && currentSpineIndex >= totalSpineCount - 1
    : currentChapterPage === 0 && currentSpineIndex === 0;

  const isRightDisabled = isRtl
    ? currentChapterPage === 0 && currentSpineIndex === 0
    : currentChapterPage >= safeChapterPages - 1 && currentSpineIndex >= totalSpineCount - 1;

  return (
    <footer
      className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-300 transform ${
        isVisible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-full opacity-0 pointer-events-none'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-zinc-200/80 dark:border-zinc-800/80 px-3 pt-2.5 pb-[max(calc(env(safe-area-inset-bottom,0px)+12px),18px)] shadow-2xl max-w-2xl mx-auto rounded-t-2xl sm:mb-2 sm:rounded-2xl border">
        {/* Navigation buttons & Page Indicator */}
        <div className="flex items-center justify-between gap-1.5 sm:gap-3">
          {/* Chapter Jump Back */}
          <button
            onClick={isRtl ? onNextChapter : onPrevChapter}
            disabled={isRtl ? currentSpineIndex >= totalSpineCount - 1 : currentSpineIndex === 0}
            title={isRtl ? 'Capítulo siguiente' : 'Capítulo anterior'}
            className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-25 text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          {/* Left Page Turn Button */}
          <button
            onClick={handleLeftClick}
            disabled={isLeftDisabled}
            title={`Página ${leftLabel.toLowerCase()}`}
            className={`py-2 px-3 rounded-xl transition-all flex items-center gap-1 text-xs font-semibold ${
              isRtl
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-30'
                : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 disabled:opacity-30'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{leftLabel}</span>
          </button>

          <button
            onClick={onToggleBookmark}
            title={isBookmarked ? 'Quitar marcador' : 'Marcar esta página'}
            aria-label={isBookmarked ? 'Quitar marcador' : 'Marcar esta página'}
            className={`p-2 rounded-xl transition-colors ${
              isBookmarked
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            <Bookmark className="w-4 h-4" fill={isBookmarked ? 'currentColor' : 'none'} />
          </button>

          {/* Center Info */}
          <div className="flex-1 flex flex-col items-center justify-center px-1 text-center">
            <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
              Página {currentPage + 1} de {safeTotalPages}
              <span className="text-[10px] font-normal text-zinc-500 ml-1">
                ({progressPercent}%)
              </span>
            </div>
            <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 truncate max-w-[180px] sm:max-w-none">
              Capítulo {displayChapter}/{displayChapterCount} • Libro {bookProgressPercent}%
            </div>
          </div>

          {/* Right Page Turn Button */}
          <button
            onClick={handleRightClick}
            disabled={isRightDisabled}
            title={`Página ${rightLabel.toLowerCase()}`}
            className={`py-2 px-3 rounded-xl transition-all flex items-center gap-1 text-xs font-semibold ${
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
            title={isRtl ? 'Capítulo anterior' : 'Capítulo siguiente'}
            className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-25 text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      </div>
    </footer>
  );
};
