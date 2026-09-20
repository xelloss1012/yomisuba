import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ParsedEpub, ReaderSettingsState } from '../types/epub';
import { ReaderNavbar } from './ReaderNavbar';
import { ReaderFooter } from './ReaderFooter';
import { ReaderSettings } from './ReaderSettings';
import { ReaderToc } from './ReaderToc';
import { TextSelectionMenu, SelectionPosition } from './TextSelectionMenu';
import { TranslationModal } from './TranslationModal';
import { Loader2, Menu } from 'lucide-react';

interface Props {
  epub: ParsedEpub;
  onCloseBook: () => void;
  settings: ReaderSettingsState;
  onUpdateSettings: (newSettings: Partial<ReaderSettingsState>) => void;
}

export const EpubReader: React.FC<Props> = ({
  epub,
  onCloseBook,
  settings,
  onUpdateSettings,
}) => {
  const [currentSpineIndex, setCurrentSpineIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoadingChapter, setIsLoadingChapter] = useState(true);
  const [showUi, setShowUi] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [selectedText, setSelectedText] = useState('');
  const [selectionPos, setSelectionPos] = useState<SelectionPosition | null>(null);
  const [isTranslateOpen, setIsTranslateOpen] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSelectionTime = useRef<number>(0);
  const currentPageRef = useRef(0);
  const totalPagesRef = useRef(1);
  const currentSpineRef = useRef(0);

  const isVertical = settings.writingMode === 'vertical-rl';
  const isRtl = isVertical || settings.progressionDirection === 'rtl';

  const currentSpineItem = epub.spine[currentSpineIndex];
  const spineHrefs = epub.spine.map((s) => s.href);

  const themeColors = {
    light: { bg: '#ffffff', text: '#18181b' },
    paper: { bg: '#faf7f0', text: '#2c2825' },
    sepia: { bg: '#f4ede4', text: '#433428' },
    dark: { bg: '#18181b', text: '#e4e4e7' },
  }[settings.theme];

  const getFontFamilyCss = (font: string) => {
    switch (font) {
      case 'mincho':
        return '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", "MS PMincho", serif';
      case 'gothic':
        return '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif';
      case 'serif':
        return 'Georgia, "Times New Roman", "Noto Serif JP", serif';
      case 'sans':
      default:
        return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif';
    }
  };

  // ─── PAGINATION ───────────────────────────────────────────────────────────────
  // Both vertical and horizontal use CSS multi-column.
  // In vertical-rl the columns stack left-to-right from right edge (RTL progression).
  // The translate moves opposite columns into the viewport.
  //
  // Vertical RTL:  page 0 = right column (translateX = 0)
  //                page 1 = next column to the left → translateX = +viewportWidth
  // Horizontal:    page 0 = left column (translateX = 0)
  //                page 1 = next column to the right → translateX = -viewportWidth
  const updatePagination = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;

    const doc = iframe.contentDocument;
    const scroller = doc.getElementById('reader-scroller');
    if (!scroller) return;

    const vw = iframe.clientWidth || window.innerWidth;

    // Use the widest measured value because vertical writing can report a
    // smaller scrollWidth while the multi-column content is still laying out.
    const range = doc.createRange();
    range.selectNodeContents(scroller);
    const contentWidth = Math.abs(range.getBoundingClientRect().width);
    const totalWidth = Math.max(scroller.scrollWidth, contentWidth, vw);
    const pages = Math.max(1, Math.ceil(totalWidth / vw));
    setTotalPages(pages);
    totalPagesRef.current = pages;

    const page = currentPageRef.current;

    if (isVertical) {
      // RTL multi-column: column 0 is rightmost. Each page moves +X to reveal columns further left.
      scroller.style.transform = `translateX(${page * vw}px)`;
    } else {
      scroller.style.transform = `translateX(${-page * vw}px)`;
    }
  }, [isVertical]);

  // ─── SELECTION ────────────────────────────────────────────────────────────────
  const handleSelection = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;
    const sel = iframe.contentWindow?.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) return;

    const text = sel.toString().trim();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const iRect = iframe.getBoundingClientRect();

    lastSelectionTime.current = Date.now();
    setSelectedText(text);
    setSelectionPos({
      x: iRect.left + rect.left,
      y: iRect.top + rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  // ─── PAGE ACTIONS ─────────────────────────────────────────────────────────────
  // We use refs so that callbacks registered inside the iframe closure stay fresh.
  const doNextPage = useCallback(() => {
    const page = currentPageRef.current;
    const pages = totalPagesRef.current;
    const spine = currentSpineRef.current;

    if (page < pages - 1) {
      currentPageRef.current = page + 1;
      setCurrentPage(page + 1);
      updatePagination();
    } else if (spine < epub.spine.length - 1) {
      loadChapter(spine + 1, 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epub.spine.length, updatePagination]);

  const doPrevPage = useCallback(() => {
    const page = currentPageRef.current;
    const spine = currentSpineRef.current;

    if (page > 0) {
      currentPageRef.current = page - 1;
      setCurrentPage(page - 1);
      updatePagination();
    } else if (spine > 0) {
      loadChapter(spine - 1, 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatePagination]);

  const doNextRef = useRef(doNextPage);
  const doPrevRef = useRef(doPrevPage);
  useEffect(() => { doNextRef.current = doNextPage; }, [doNextPage]);
  useEffect(() => { doPrevRef.current = doPrevPage; }, [doPrevPage]);

  // ─── LOAD CHAPTER ─────────────────────────────────────────────────────────────
  const loadChapter = useCallback(
    async (spineIndex: number, targetPage = 0) => {
      if (spineIndex < 0 || spineIndex >= epub.spine.length) return;
      setIsLoadingChapter(true);
      setSelectedText('');
      setSelectionPos(null);

      try {
        const item = epub.spine[spineIndex];
        const rawHtml = await epub.getChapterContent(item.href);

        const iframe = iframeRef.current;
        if (!iframe) return;
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) return;

        const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
        const bodyContent = parsed.body.innerHTML;
        const fontCss = getFontFamilyCss(settings.fontFamily);
        const mobile = window.innerWidth < 640;
        const pad = mobile ? '14px 16px' : '32px 44px';
        const imgMaxH = mobile ? 'calc(100dvh - 32px)' : 'calc(100vh - 68px)';
        const imgMaxW = mobile ? 'calc(100vw - 28px)' : 'calc(100vw - 88px)';
        const colGap = '0px';
        const fontSize = mobile ? Math.min(settings.fontSize, 18) : settings.fontSize;

        // For vertical-rl multi-column we MUST set height on the scroller
        // and let the browser compute the columns for us.
        // For horizontal-tb we set column-width to viewport width so we get 1 column per page.
        const scrollerCss = isVertical ? `
          /* Vertical RTL multi-column – browser creates columns going left */
          position: absolute;
          top: 0;
          /* Anchor to the right so column 0 aligns with viewport right edge */
          right: 0;
          height: 100%;
          height: 100dvh;
          width: max-content;   /* expand leftwards as many columns as needed */
          writing-mode: vertical-rl;
          -webkit-writing-mode: vertical-rl;
          direction: ltr;
          text-orientation: mixed;
          -webkit-text-orientation: mixed;
          font-feature-settings: "vert" 1, "vrt2" 1, "palt" 1;
          -webkit-font-feature-settings: "vert" 1, "vrt2" 1, "palt" 1;
          /* Keep one complete viewport per column on narrow screens too. */
          column-width: 100vw;
          column-gap: ${colGap};
          column-fill: auto;
          padding: ${pad};
          /* transition applied by JS */
          will-change: transform;
          transition: transform 0.22s cubic-bezier(0.25, 1, 0.5, 1);
        ` : `
          /* Horizontal LTR multi-column */
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          height: 100dvh;
          width: max-content;
          writing-mode: horizontal-tb;
          -webkit-writing-mode: horizontal-tb;
          direction: ltr;
          column-width: 100vw;
          column-gap: ${colGap};
          column-fill: auto;
          padding: ${pad};
          will-change: transform;
          transition: transform 0.22s cubic-bezier(0.25, 1, 0.5, 1);
        `;

        const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover"/>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Noto+Serif+JP:wght@400;600;700&family=Shippori+Mincho:wght@400;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
    html, body {
      margin: 0; padding: 0;
      width: 100vw; height: 100%; height: 100dvh;
      overflow: hidden;
      background: ${themeColors.bg};
      color: ${themeColors.text};
      -webkit-text-size-adjust: 100%;
      user-select: text; -webkit-user-select: text;
    }
    #reader-viewport {
      position: relative;
      width: 100vw;
      height: 100%; height: 100dvh;
      overflow: hidden;
    }
    #reader-scroller {
      font-family: ${fontCss};
      font-size: ${fontSize}px;
      line-height: ${settings.lineHeight};
      letter-spacing: 0.05em;
      ${scrollerCss}
      /* Kinsoku shori */
      line-break: strict;
      -webkit-line-break: strict;
      word-break: normal;
      overflow-wrap: anywhere;
      text-align: justify;
      text-justify: inter-ideograph;
    }
    ::selection { background: #818cf8; color: #fff; }
    img, svg { max-height: ${imgMaxH}; max-width: ${imgMaxW}; object-fit: contain;
      break-inside: avoid; margin: 0.4rem auto; display: block; }
    p  { margin: 0 0 ${isVertical ? '0 0.5rem' : '0.5rem 0'}; }
    h1,h2,h3,h4 { font-weight:700; break-after:avoid; }
    ruby rt { font-size: 0.52em; line-height:1; opacity:0.85; font-weight:400; }
    .tate-chu-yoko, [class*="tcy"], [class*="tate-ch"] {
      text-combine-upright: all; -webkit-text-combine: horizontal; }
    a { color: inherit; text-decoration: none; }
  </style>
</head>
<body>
  <div id="reader-viewport">
    <div id="reader-scroller">${bodyContent}</div>
  </div>
</body>
</html>`;

        doc.open();
        doc.write(fullHtml);
        doc.close();

        // ── Gesture & tap handlers attached inside the iframe ──
        let sx = 0, sy = 0, st = 0, moved = false;

        const onStart = (cx: number, cy: number) => {
          sx = cx; sy = cy; st = Date.now(); moved = false;
        };
        const onMove = (cx: number, cy: number) => {
          if (Math.abs(cx - sx) > 20 || Math.abs(cy - sy) > 20) moved = true;
        };
        const onEnd = (cx: number) => {
          const dt = Date.now() - st;
          const dx = cx - sx;

          setTimeout(() => {
            const sel = iframe.contentWindow?.getSelection()?.toString().trim();
            if (sel) { handleSelection(); return; }

            if (Math.abs(dx) > 30) {
              // Swipe follows the same physical direction as the page controls:
              // moving right advances and moving left goes back.
              if (dx > 0) doNextRef.current(); else doPrevRef.current();
              return;
            }

            if (!moved && dt < 300) {
              if (Date.now() - lastSelectionTime.current < 400) return;
              const vw = iframe.clientWidth || window.innerWidth;
              const ratio = cx / vw;
              if (ratio < 0.28) {
                // Left tap
                if (isRtl) doNextRef.current(); else doPrevRef.current();
              } else if (ratio > 0.72) {
                // Right tap
                if (isRtl) doPrevRef.current(); else doNextRef.current();
              } else {
                setShowUi(p => !p);
              }
            }
          }, 40);
        };

        doc.addEventListener('selectionchange', handleSelection);
        doc.addEventListener('mousedown',  (e) => onStart(e.clientX, e.clientY));
        doc.addEventListener('mousemove',  (e) => onMove(e.clientX, e.clientY));
        doc.addEventListener('mouseup',    (e) => onEnd(e.clientX));
        doc.addEventListener('touchstart', (e) => { if (e.touches[0]) onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
        doc.addEventListener('touchmove',  (e) => { if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
        doc.addEventListener('touchend',   (e) => { if (e.changedTouches[0]) onEnd(e.changedTouches[0].clientX); }, { passive: true });

        // ── Trigger pagination once content is laid out ──
        const triggerUpdate = () => {
          currentPageRef.current = targetPage;
          currentSpineRef.current = spineIndex;
          setCurrentSpineIndex(spineIndex);
          setCurrentPage(targetPage);
          updatePagination();
          setIsLoadingChapter(false);
        };

        doc.fonts?.ready?.then(triggerUpdate);
        doc.querySelectorAll('img').forEach(img => img.addEventListener('load', triggerUpdate));

        const wrapper = doc.getElementById('reader-scroller');
        if (wrapper && 'ResizeObserver' in window) {
          new ResizeObserver(triggerUpdate).observe(wrapper);
        }

        setTimeout(triggerUpdate, 60);
        setTimeout(triggerUpdate, 200);
        setTimeout(triggerUpdate, 500);

      } catch (err) {
        console.error(err);
        setIsLoadingChapter(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epub, settings, isVertical, isRtl, themeColors, updatePagination, handleSelection]
  );

  // Sync state → refs so iframe closures always see latest values
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);
  useEffect(() => { currentSpineRef.current = currentSpineIndex; }, [currentSpineIndex]);

  // Expose page-turn handlers to React world (footer buttons, keyboard)
  const handleNextPage = useCallback(() => doNextRef.current(), []);
  const handlePrevPage = useCallback(() => doPrevRef.current(), []);

  // Reload chapter on style settings change
  useEffect(() => {
    loadChapter(currentSpineRef.current, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.writingMode, settings.fontFamily, settings.fontSize, settings.lineHeight, settings.theme]);

  // Initial load
  useEffect(() => { loadChapter(0, 0); }, []); // eslint-disable-line

  // Re-apply transform when page changes from React state
  useEffect(() => { updatePagination(); }, [currentPage, updatePagination]);

  // Resize
  useEffect(() => {
    const onResize = () => updatePagination();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updatePagination]);

  const handleNextChapter = () => {
    if (currentSpineRef.current < epub.spine.length - 1) {
      loadChapter(currentSpineRef.current + 1, 0);
    }
  };
  const handlePrevChapter = () => {
    if (currentSpineRef.current > 0) {
      loadChapter(currentSpineRef.current - 1, 0);
    }
  };
  const handleSelectTocChapter = (href: string) => {
    const clean = href.split('#')[0];
    const idx = epub.spine.findIndex(s => s.href.endsWith(clean) || clean.endsWith(s.href));
    if (idx !== -1) loadChapter(idx, 0);
  };

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSettingsOpen || isTocOpen || isTranslateOpen) return;
      const next = isRtl
        ? ['ArrowLeft', ' ', 'PageDown', 'j']
        : ['ArrowRight', ' ', 'PageDown', 'j'];
      const prev = isRtl
        ? ['ArrowRight', 'PageUp', 'k']
        : ['ArrowLeft', 'PageUp', 'k'];
      if (next.includes(e.key)) handleNextPage();
      else if (prev.includes(e.key)) handlePrevPage();
      else if (e.key === 'Escape') { setShowUi(p => !p); setSelectedText(''); setSelectionPos(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isRtl, isSettingsOpen, isTocOpen, isTranslateOpen, handleNextPage, handlePrevPage]);

  const currentChapterToc = epub.toc.find(
    t => t.href.includes(currentSpineItem?.href) || currentSpineItem?.href.includes(t.href)
  );

  return (
    <div
      ref={containerRef}
      style={{ backgroundColor: themeColors.bg, color: themeColors.text }}
      className="fixed inset-0 w-full h-full overflow-hidden"
    >
      <ReaderNavbar
        metadata={epub.metadata}
        chapterTitle={currentChapterToc?.label}
        isVisible={showUi}
        onToggleToc={() => setIsTocOpen(true)}
        onToggleSettings={() => setIsSettingsOpen(true)}
        onOpenFile={onCloseBook}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
      />

      {/* Floating menu button – visible on mobile when UI is hidden */}
      {!showUi && (
        <button
          onClick={() => setShowUi(true)}
          className="fixed top-3 right-3 z-30 sm:hidden p-2 rounded-full bg-zinc-900/40 backdrop-blur-md text-white/80 shadow-md"
          title="Mostrar menú"
        >
          <Menu className="w-4 h-4" />
        </button>
      )}

      {/* Reader Viewport */}
      <div className="w-full h-full relative overflow-hidden">
        <iframe
          ref={iframeRef}
          title="EPUB Page View"
          className="w-full h-full border-0 block"
          sandbox="allow-same-origin allow-scripts"
        />
        {isLoadingChapter && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-[2px] pointer-events-none">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/90 dark:bg-zinc-800/90 shadow-lg text-xs font-medium text-zinc-700 dark:text-zinc-200">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              <span>Cargando...</span>
            </div>
          </div>
        )}
      </div>

      <TextSelectionMenu
        selectedText={selectedText}
        position={selectionPos}
        onClose={() => { setSelectedText(''); setSelectionPos(null); }}
        onOpenTranslate={() => setIsTranslateOpen(true)}
      />

      <TranslationModal
        isOpen={isTranslateOpen}
        onClose={() => setIsTranslateOpen(false)}
        selectedText={selectedText}
      />

      <ReaderFooter
        isVisible={showUi}
        currentPage={currentPage}
        totalPages={totalPages}
        currentSpineIndex={currentSpineIndex}
        totalSpineCount={epub.spine.length}
        direction={settings.progressionDirection}
        isVertical={isVertical}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
        onPrevChapter={handlePrevChapter}
        onNextChapter={handleNextChapter}
      />

      <ReaderToc
        isOpen={isTocOpen}
        onClose={() => setIsTocOpen(false)}
        toc={epub.toc}
        currentSpineIndex={currentSpineIndex}
        spineHrefs={spineHrefs}
        onSelectChapter={handleSelectTocChapter}
        bookTitle={epub.metadata.title}
      />

      <ReaderSettings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
      />
    </div>
  );
};
