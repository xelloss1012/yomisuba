import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, SkipBack, SkipForward } from 'lucide-react';
import { ProgressionDirection } from '../types/epub';

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
  onNudgePage: (delta: number) => void;
  onResetNudge: () => void;
  pageNudge: number;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
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
  onNudgePage,
  onResetNudge,
  pageNudge,
  onPrevChapter,
  onNextChapter,
  isBookmarked,
  onToggleBookmark,
}) => {
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

  const progressPercent = Math.round(((safeDisplayPage + 1) / safeTotalPages) * 100);
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
      data-reader-chrome="footer"
      className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-300 transform ${
        isVisible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-full opacity-0 pointer-events-none'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-zinc-200/80 dark:border-zinc-800/80 px-3 pt-2.5 pb-[max(calc(env(safe-area-inset-bottom,0px)+12px),18px)] shadow-2xl max-w-2xl mx-auto rounded-t-2xl sm:mb-2 sm:rounded-2xl border">
        <div className="mb-2 px-1">
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
            aria-label="Ir a una página del libro"
            title={`Ir a la página ${isRtl ? sliderMax - pendingSliderPage + 1 : pendingSliderPage + 1} de ${safeTotalPages}`}
            className="reader-progress w-full cursor-pointer disabled:cursor-default disabled:opacity-40"
          />
        </div>
        <div className="mb-2 flex items-center justify-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
          <button
            onClick={() => onNudgePage(48)}
            className="tap-area rounded-lg px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
            disabled={pageNudge <= -192}
            title="Desplazar la vista hacia la izquierda"
          >
            ◀ Ajustar
          </button>
          <button
            onClick={onResetNudge}
            className="tap-area rounded-lg px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
            disabled={pageNudge === 0}
            title="Restablecer el alineado de la página"
          >
            {pageNudge === 0 ? 'Alineado' : 'Restablecer'}
          </button>
          <button
            onClick={() => onNudgePage(-48)}
            className="tap-area rounded-lg px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
            disabled={pageNudge >= 192}
            title="Desplazar la vista hacia la derecha"
          >
            Ajustar ▶
          </button>
        </div>

        {/* Navigation buttons & Page Indicator */}
        <div className="flex items-center justify-between gap-1.5 sm:gap-3">
          {/* Chapter Jump Back */}
          <button
            onClick={isRtl ? onNextChapter : onPrevChapter}
            disabled={isRtl ? currentSpineIndex >= totalSpineCount - 1 : currentSpineIndex === 0}
            title={isRtl ? 'Capítulo siguiente' : 'Capítulo anterior'}
            className="tap-area p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-25 text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          {/* Left Page Turn Button */}
          <button
            onClick={handleLeftClick}
            disabled={isLeftDisabled}
            title={`Página ${leftLabel.toLowerCase()}`}
            className={`tap-area py-2 px-3 rounded-xl transition-all flex items-center gap-1 text-xs font-semibold ${
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
            className={`tap-area p-2 rounded-xl transition-colors ${
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
              Página {safeDisplayPage + 1} de {safeTotalPages}
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
            title={isRtl ? 'Capítulo anterior' : 'Capítulo siguiente'}
            className="tap-area p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-25 text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      </div>
    </footer>
  );
};
