import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { AiProvider, ParsedEpub, ReaderSettingsState } from '../types/epub';
import { ReaderNavbar } from './ReaderNavbar';
import { ReaderFooter } from './ReaderFooter';
import { ReaderSettings } from './ReaderSettings';
import { ReaderToc } from './ReaderToc';
import { TextSelectionMenu, SelectionPosition } from './TextSelectionMenu';
import { TranslationModal } from './TranslationModal';
import { TranslationHistoryModal } from './TranslationHistoryModal';
import { BookmarksModal, ReaderBookmark } from './BookmarksModal';
import { Loader2, Menu, X, Minus, Plus, RotateCcw, Bookmark, BookmarkCheck } from 'lucide-react';
import {
  applyTextAnnotationToRange,
  applyTextAnnotations,
  captureTextAnnotation,
  readTextAnnotations,
  removeTextAnnotationMarkup,
  TextAnnotation,
} from '../utils/textAnnotations';
import {
  readTranslationHistory,
  saveTranslationHistoryEntry,
  formatDictionaryHistoryResponse,
  TranslationHistoryEntry,
  TranslationHistoryKind,
} from '../utils/translationHistory';
import { DictionaryLookup, getDictionarySearchTerms } from '../utils/dictionary';

type ReadingPosition = ReaderBookmark;

const readBookmarks = (storageKey: string, spineLength: number): ReadingPosition[] => {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    const valid = candidates.filter((value): value is ReadingPosition => {
      if (!value || typeof value !== 'object') return false;
      const candidate = value as Partial<ReadingPosition>;
      return Number.isInteger(candidate.spineIndex)
        && Number.isInteger(candidate.page)
        && (candidate.spineIndex as number) >= 0
        && (candidate.spineIndex as number) < spineLength
        && (candidate.page as number) >= 0;
    });
    return valid.filter((item, index) =>
      valid.findIndex((candidate) =>
        candidate.spineIndex === item.spineIndex && candidate.page === item.page
      ) === index
    );
  } catch {
    return [];
  }
};

interface PaginationCacheEntry {
  counts: number[];
  savedAt: number;
}

// Bumped only for changes in how the measurement itself works. Changes to the
// reader's CSS do not need it: the cache key carries a signature of the
// rendered document, so restyling invalidates the cache on its own.
const PAGINATION_CACHE_VERSION = 1;
// Keep a handful of entries so rotating the device, or resizing the window,
// does not throw away the measurement for the previous geometry.
const PAGINATION_CACHE_ENTRIES = 6;

// Pages a laid-out chapter spans. Vertical-rl stacks its pages as columns
// along the inline axis, which is the vertical one, so they are counted by
// height; horizontal lays them side by side and is counted by width. Both the
// live reader and the offline book measurement call this, so their counts
// cannot drift apart.
const countScrollerPages = (
  doc: Document,
  scroller: HTMLElement,
  vertical: boolean,
  viewportWidth: number,
  viewportHeight: number,
) => {
  const range = doc.createRange();
  range.selectNodeContents(scroller);
  const rect = range.getBoundingClientRect();
  if (vertical) {
    const top = scroller.getBoundingClientRect().top;
    const extent = Math.max(scroller.scrollHeight, rect.bottom - top, viewportHeight);
    return Math.max(1, Math.ceil((extent - 1) / viewportHeight));
  }
  const extent = Math.max(scroller.scrollWidth, Math.abs(rect.width), viewportWidth);
  return Math.max(1, Math.ceil(extent / viewportWidth));
};

const hashString = (value: string) => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
};

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
  const [pageNudge, setPageNudge] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [bookTotalPages, setBookTotalPages] = useState(1);
  const [chapterPageCounts, setChapterPageCounts] = useState<number[]>([]);
  const [isBookPaginationReady, setIsBookPaginationReady] = useState(false);
  // The global page number is offset(spineIndex) + page, so it is only
  // meaningful once the reader has actually been placed on its chapter.
  const [isReaderPositioned, setIsReaderPositioned] = useState(false);
  const [isLoadingChapter, setIsLoadingChapter] = useState(true);
  const [showUi, setShowUi] = useState(false);
  const [readerFit, setReaderFit] = useState({ scale: 1, offsetY: 0 });
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [tocError, setTocError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const bookStorageKey = `ereader_book_${encodeURIComponent(`${epub.metadata.title}|${epub.metadata.creator}`)}`;
  const translationHistoryStorageKey = `${bookStorageKey}_translation_history`;
  const [translationHistory, setTranslationHistory] = useState<TranslationHistoryEntry[]>(() =>
    readTranslationHistory(translationHistoryStorageKey)
  );
  const translationHistoryRef = useRef(translationHistory);
  const annotationsStorageKey = `${bookStorageKey}_annotations`;
  const textAnnotationsRef = useRef<TextAnnotation[]>([]);
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>(() => {
    const stored = readTextAnnotations(annotationsStorageKey);
    textAnnotationsRef.current = stored;
    return stored;
  });
  const [bookmarks, setBookmarks] = useState<ReadingPosition[]>(() =>
    readBookmarks(`${bookStorageKey}_bookmark`, epub.spine.length)
  );

  const [selectedText, setSelectedText] = useState('');
  const [dictionaryPreview, setDictionaryPreview] = useState<DictionaryLookup | null>(null);
  const [isSelectionUnderlined, setIsSelectionUnderlined] = useState(false);
  const [isSelectionAdjusting, setIsSelectionAdjusting] = useState(false);
  const selectionSettleRef = useRef<number | undefined>(undefined);
  // Set from the iframe's pointer events: the menu must wait for the finger to
  // leave the screen, not merely for the selection to pause.
  const pointerActiveRef = useRef(false);
  const [selectionPos, setSelectionPos] = useState<SelectionPosition | null>(null);
  const [isTranslateOpen, setIsTranslateOpen] = useState(false);
  const [isTranslationHistoryOpen, setIsTranslationHistoryOpen] = useState(false);
  const [aiTranslationProvider, setAiTranslationProvider] = useState<AiProvider | undefined>();
  const [imageViewerSrc, setImageViewerSrc] = useState<string | null>(null);
  const [imageViewerScale, setImageViewerScale] = useState(1);
  const [imageViewerOffset, setImageViewerOffset] = useState({ x: 0, y: 0 });

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSelectionTime = useRef<number>(0);
  const currentPageRef = useRef(0);
  const pageNudgeRef = useRef(0);
  const totalPagesRef = useRef(1);
  const currentSpineRef = useRef(0);
  const chapterPageCountsRef = useRef<number[]>([]);
  const bookPageOffsetsRef = useRef<number[]>([]);
  const measurementVersionRef = useRef(0);
  const shownPageRef = useRef<{ spine: number; page: number } | null>(null);
  const imageDragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const selectedTextRef = useRef('');
  const selectionRangeRef = useRef<Range | null>(null);
  const selectionAnnotationRef = useRef<Omit<TextAnnotation, 'id'> | null>(null);
  const selectedTextAnnotationIdRef = useRef<string | null>(null);
  const openOverlayRef = useRef(false);
  // Opt-in on-screen trace (append ?debug or #debug to the URL) for diagnosing
  // selection and paging on a real touch device, where no tooling is available.
  const [debugEnabled, setDebugEnabled] = useState(
    () => typeof window !== 'undefined' && /debug/i.test(window.location.search + window.location.hash)
  );
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [debugCopied, setDebugCopied] = useState(false);
  const logDebugRef = useRef<(line: string) => void>(() => {});
  const countDebugRef = useRef<(key: string) => void>(() => {});
  const debugBufferRef = useRef<string[]>([]);
  const debugCountsRef = useRef<Record<string, number>>({});

  const isVertical = settings.writingMode === 'vertical-rl';
  const isRtl = isVertical || settings.progressionDirection === 'rtl';
  const configuredAiProviders = useMemo(
    () => (['gemini', 'openai', 'deepseek'] as AiProvider[]).filter(
      (provider) => Boolean(settings.aiApiKeys[provider]?.trim())
    ),
    [settings.aiApiKeys]
  );

  const normalizeHref = useCallback((value: string) => {
    let path = value.split('#')[0];
    try {
      path = decodeURIComponent(path);
    } catch {
      // Keep the raw value when it is not valid percent-encoding.
    }
    return path
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\//, '')
      .toLowerCase();
  }, []);

  const resolveSpineIndex = useCallback((href: string) => {
    const target = normalizeHref(href);
    if (!target) return -1;
    const paths = epub.spine.map((item) => normalizeHref(item.href));
    const exact = paths.indexOf(target);
    if (exact !== -1) return exact;
    // Same file name, whatever directory prefix each side carries.
    const targetFile = target.split('/').pop() || target;
    const byFile = paths.findIndex((path) => (path.split('/').pop() || path) === targetFile);
    if (byFile !== -1) return byFile;
    // Otherwise one must be a whole-segment suffix of the other.
    return paths.findIndex(
      (path) => path.endsWith(`/${target}`) || target.endsWith(`/${path}`)
    );
  }, [epub.spine, normalizeHref]);

  const spineHrefs = epub.spine.map((s) => s.href);
  const displayChapterCount = Math.max(1, epub.toc.length || epub.spine.length);
  const getDisplayChapter = useCallback((spineIndex: number) => {
    const topLevelIndex = epub.toc.findIndex(
      (item) => resolveSpineIndex(item.href) === spineIndex
    );
    return topLevelIndex >= 0 ? topLevelIndex + 1 : Math.min(spineIndex + 1, displayChapterCount);
  }, [displayChapterCount, epub.toc, resolveSpineIndex]);

  const getGlobalPage = useCallback((spineIndex: number, page: number) => {
    return (bookPageOffsetsRef.current[spineIndex] || 0) + page;
  }, []);

  const saveReadingPosition = useCallback((position: ReadingPosition) => {
    try {
      localStorage.setItem(`${bookStorageKey}_position`, JSON.stringify(position));
    } catch {
      // Persistence is optional when storage is unavailable.
    }
  }, [bookStorageKey]);

  const handleSaveTranslationHistory = useCallback((
    kind: TranslationHistoryKind,
    query: string,
    response: string,
    provider?: AiProvider,
  ) => {
    const next = saveTranslationHistoryEntry(
      translationHistoryStorageKey,
      translationHistoryRef.current,
      { kind, query, response, ...(kind === 'ai' && provider ? { provider } : {}) }
    );
    translationHistoryRef.current = next;
    setTranslationHistory(next);
  }, [translationHistoryStorageKey]);

  const handleRemoveTranslationHistoryEntry = useCallback((id: string) => {
    const next = translationHistoryRef.current.filter((entry) => entry.id !== id);
    translationHistoryRef.current = next;
    setTranslationHistory(next);
    try {
      if (next.length) localStorage.setItem(translationHistoryStorageKey, JSON.stringify(next));
      else localStorage.removeItem(translationHistoryStorageKey);
    } catch {
      // Keep the in-memory history available when storage is unavailable.
    }
  }, [translationHistoryStorageKey]);

  const handleClearTranslationHistory = useCallback(() => {
    translationHistoryRef.current = [];
    setTranslationHistory([]);
    try {
      localStorage.removeItem(translationHistoryStorageKey);
    } catch {
      // Keep the in-memory history available when storage is unavailable.
    }
  }, [translationHistoryStorageKey]);

  useEffect(() => {
    try {
      if (bookmarks.length) {
        localStorage.setItem(`${bookStorageKey}_bookmark`, JSON.stringify(bookmarks));
      } else {
        localStorage.removeItem(`${bookStorageKey}_bookmark`);
      }
    } catch {
      // Persistence is optional when storage is unavailable.
    }
  }, [bookmarks, bookStorageKey]);

  useEffect(() => {
    textAnnotationsRef.current = textAnnotations;
    try {
      if (textAnnotations.length) {
        localStorage.setItem(annotationsStorageKey, JSON.stringify(textAnnotations));
      } else {
        localStorage.removeItem(annotationsStorageKey);
      }
    } catch {
      // Persistence is optional when storage is unavailable.
    }
  }, [annotationsStorageKey, textAnnotations]);

  const isCurrentBookmarked = bookmarks.some((item) =>
    item.spineIndex === currentSpineIndex && item.page === currentPage
  );

  const handleToggleBookmark = useCallback(() => {
    const currentPosition = {
      spineIndex: currentSpineRef.current,
      page: currentPageRef.current,
    };
    setBookmarks((existing) => {
      const alreadySaved = existing.some((item) =>
        item.spineIndex === currentPosition.spineIndex && item.page === currentPosition.page
      );
      return alreadySaved
        ? existing.filter((item) =>
          item.spineIndex !== currentPosition.spineIndex || item.page !== currentPosition.page
        )
        : [...existing, currentPosition].sort((a, b) =>
          a.spineIndex - b.spineIndex || a.page - b.page
        );
    });
  }, []);

  const handleRemoveBookmark = useCallback((position: ReadingPosition) => {
    setBookmarks((existing) => existing.filter((item) =>
      item.spineIndex !== position.spineIndex || item.page !== position.page
    ));
  }, []);

  const themeColors = {
    light: { bg: '#ffffff', text: '#18181b' },
    paper: { bg: '#faf7f0', text: '#2c2825' },
    sepia: { bg: '#f4ede4', text: '#433428' },
    dark: { bg: '#18181b', text: '#e4e4e7' },
  }[settings.theme];

  const getFontFamilyCss = useCallback((font: string) => {
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
  }, []);

  // The reader document is built here and ONLY here. The offline measurement
  // used its own, slightly different copy of this CSS — no web fonts, other
  // letter-spacing, no ruby sizing, other image limits — so its page counts
  // disagreed with what the reader actually rendered, which showed up as the
  // page number jumping when crossing a chapter boundary. Sharing one builder
  // keeps them from drifting apart again.
  const buildChapterDocument = useCallback((rawHtml: string) => {
    const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
    const bodyContent = parsed.body.innerHTML;
    const fontCss = getFontFamilyCss(settings.fontFamily);
    const mobile = window.innerWidth < 640;
    const sidePad = mobile ? 16 : 44;
    // Keep only a small permanent margin. The outer reader viewport
    // reserves the larger header/footer areas only while the UI is open.
    const pageColumnWidth = `calc(100vw - ${sidePad * 2}px)`;
    const pageColumnGap = `${sidePad * 2}px`;
    const padTop = mobile ? 18 : 32;
    const padBottom = mobile ? 52 : 40;
    const pad = `${padTop}px 0 ${padBottom}px`;
    // In vertical-rl a page is a column: its inline size is the screen height
    // minus the top and bottom padding, and the gap between columns equals that
    // padding, so the column pitch is exactly one screen height.
    const verticalColumnHeight = `calc(100vh - ${padTop + padBottom}px)`;
    const verticalColumnGap = `${padTop + padBottom}px`;
    const imgMaxH = isVertical ? `calc(100vh - ${padTop + padBottom + 8}px)` : 'calc(100% - 32px)';
    const imgMaxW = isVertical
      ? `calc(100vw - ${sidePad * 2}px)`
      : mobile ? 'calc(100vw - 28px)' : 'calc(100vw - 88px)';
    const fontSize = mobile ? Math.min(settings.fontSize, 18) : settings.fontSize;

    // For vertical-rl multi-column we MUST set height on the scroller
    // and let the browser compute the columns for us.
    // For horizontal-tb we set column-width to viewport width so we get 1 column per page.
    const scrollerCss = isVertical ? `
      /* Vertical RTL, paginated by the browser's own fragmentation.
         The previous layout flowed the text as one endless strip and paged it
         with translateX by the screen width. That width is not a multiple of
         the line pitch, so every few pages a whole line fell across the edge
         and could not be read (measured: 28 of 40 pages) — the reason for
         the manual nudge controls.
         Here each page is a column of the multicol container. In vertical-rl
         the inline axis is vertical, so columns stack downwards: the block
         size is fixed to one screen width, overflow columns are created below,
         and paging is a translateY by one screen height. Fragmentation never
         splits a line, so no line can straddle two pages. */
      position: absolute;
      top: 0;
      right: 0;
      width: 100vw;
      height: 100%;
      writing-mode: vertical-rl;
      -webkit-writing-mode: vertical-rl;
      direction: ltr;
      text-orientation: mixed;
      -webkit-text-orientation: mixed;
      font-feature-settings: "vert" 1, "vrt2" 1, "palt" 1;
      -webkit-font-feature-settings: "vert" 1, "vrt2" 1, "palt" 1;
      /* column-width is the column HEIGHT here (inline axis). It must match
         the screen height minus padding: a smaller value confined the text to
         a band and left half a phone screen empty. */
      column-width: ${verticalColumnHeight};
      column-gap: ${verticalColumnGap};
      column-fill: auto;
      padding: ${padTop}px ${sidePad}px ${padBottom}px;
      will-change: transform;
      /* No CSS transition here: pages are stacked downwards, so animating the
         transform would visibly scroll the text up and down. The page turn is
         animated sideways from JS instead (see updatePagination). */
      transition: none;
    ` : `
      /* Horizontal LTR multi-column */
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: max-content;
      writing-mode: horizontal-tb;
      -webkit-writing-mode: horizontal-tb;
      direction: ltr;
      column-width: ${pageColumnWidth};
      column-gap: ${pageColumnGap};
      column-fill: auto;
      padding: ${pad};
      will-change: transform;
      transition: transform 0.22s cubic-bezier(0.25, 1, 0.5, 1);
    `;

    const html = `<!DOCTYPE html>
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
      width: 100vw; height: 100%;
      overflow: hidden;
      background: ${themeColors.bg};
      color: ${themeColors.text};
      -webkit-text-size-adjust: 100%;
      user-select: text; -webkit-user-select: text;
    }
    #reader-viewport {
      position: relative;
      width: 100vw;
      height: 100%;
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
      overflow-wrap: normal;
      text-align: justify;
      text-justify: inter-ideograph;
    }
    ::selection { background: #818cf8; color: #fff; }
    img, svg { max-height: ${imgMaxH}; max-width: ${imgMaxW}; object-fit: contain;
      break-inside: avoid-column; page-break-inside: avoid;
      margin: 0.4rem auto; display: inline-block; vertical-align: top; }
    .vertical-punctuation {
      text-orientation: upright; -webkit-text-orientation: upright;
      display: inline-block; line-height: 1;
    }
    p  { margin: 0; padding: ${isVertical ? '0 0 0 0.5rem' : '0 0 0.5rem 0'}; }
    h1,h2,h3,h4 { font-weight:700; break-after:avoid; }
    ruby {
      break-inside: avoid;
      page-break-inside: avoid;
      -webkit-column-break-inside: avoid;
    }
    ruby rt {
      font-size: 0.52em;
      line-height: 1;
      opacity: 0.85;
      font-weight: 400;
      user-select: none;
      -webkit-user-select: none;
      pointer-events: none;
    }
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
    return { html, sidePad, fontSize };
  }, [getFontFamilyCss, isVertical, settings, themeColors]);

  // The key covers everything that can change the page count: the rendered
  // document itself (fonts, sizes, spacing, column geometry — minus the theme
  // colours, which cannot move text), the viewport it was measured at, and the
  // number of chapters. Height is rounded because mobile browsers nudge it by
  // a few pixels as their toolbars come and go, and that must not count as a
  // different layout.
  const paginationCacheKey = useCallback((viewportWidth: number, viewportHeight: number) => {
    const layout = buildChapterDocument('').html
      .split(themeColors.bg).join('#bg')
      .split(themeColors.text).join('#fg');
    return [
      PAGINATION_CACHE_VERSION,
      hashString(layout),
      viewportWidth,
      Math.round(viewportHeight / 20) * 20,
      epub.spine.length,
    ].join(':');
  }, [buildChapterDocument, epub.spine.length, themeColors]);

  const paginationCacheStore = `${bookStorageKey}_pagination`;

  const readPaginationCache = useCallback((key: string) => {
    try {
      const raw = localStorage.getItem(paginationCacheStore);
      if (!raw) return null;
      const store = JSON.parse(raw) as Record<string, PaginationCacheEntry>;
      const entry = store?.[key];
      if (!entry || !Array.isArray(entry.counts)) return null;
      if (!entry.counts.every((count) => Number.isInteger(count) && count > 0)) return null;
      return entry.counts;
    } catch {
      return null;
    }
  }, [paginationCacheStore]);

  const writePaginationCache = useCallback((key: string, counts: number[]) => {
    try {
      const raw = localStorage.getItem(paginationCacheStore);
      const store = (raw ? JSON.parse(raw) : {}) as Record<string, PaginationCacheEntry>;
      store[key] = { counts, savedAt: Date.now() };
      const trimmed = Object.entries(store)
        .sort(([, a], [, b]) => (b?.savedAt || 0) - (a?.savedAt || 0))
        .slice(0, PAGINATION_CACHE_ENTRIES);
      localStorage.setItem(paginationCacheStore, JSON.stringify(Object.fromEntries(trimmed)));
    } catch {
      // Caching is an optimisation; never let it break pagination.
    }
  }, [paginationCacheStore]);

  const applyChapterCounts = useCallback((counts: number[]) => {
    const offsets: number[] = [];
    let offset = 0;
    counts.forEach((count, index) => {
      offsets[index] = offset;
      offset += Math.max(1, count || 1);
    });
    chapterPageCountsRef.current = counts;
    bookPageOffsetsRef.current = offsets;
    setChapterPageCounts(counts);
    setBookTotalPages(offset);
    setIsBookPaginationReady(true);
  }, []);

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
    const vh = iframe.clientHeight || window.innerHeight;
    const pages = countScrollerPages(doc, scroller, isVertical, vw, vh);
    setTotalPages(pages);
    totalPagesRef.current = pages;
    const page = currentPageRef.current;
    const offset = pageNudgeRef.current;

    if (isVertical) {
      // Pages are stacked downwards, so the strip moves up by one screen height
      // per page — instantly. What the reader sees is a sideways slide of the
      // incoming page, the way every e-reader turns pages: in vertical-rl the
      // reading flow runs right to left, so the next page enters from the left
      // and the previous one from the right.
      const target = `translate(${offset}px, ${-page * vh}px)`;
      scroller.style.transform = target;
      const shown = shownPageRef.current;
      const spine = currentSpineRef.current;
      const turned = shown && shown.spine === spine && shown.page !== page;
      shownPageRef.current = { spine, page };
      const reduceMotion = iframe.contentWindow?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (turned && !reduceMotion && typeof scroller.animate === 'function') {
        const from = (page > shown.page ? -1 : 1) * vw * 0.35;
        scroller.getAnimations().forEach((animation) => animation.cancel());
        scroller.animate(
          [
            { transform: `translate(${offset + from}px, ${-page * vh}px)`, opacity: 0.35 },
            { transform: target, opacity: 1 },
          ],
          { duration: 220, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
        );
      }
    } else {
      scroller.style.transform = `translateX(${-page * vw + offset}px)`;
    }
  }, [isVertical]);

  const measureBookPages = useCallback(async () => {
    const host = iframeRef.current;
    if (!host || !epub.spine.length) return;
    const measurementVersion = measurementVersionRef.current + 1;
    measurementVersionRef.current = measurementVersion;
    const vw = host.clientWidth || window.innerWidth;
    const vh = host.clientHeight || window.innerHeight;
    const cacheKey = paginationCacheKey(vw, vh);
    const cached = readPaginationCache(cacheKey);
    if (cached && cached.length === epub.spine.length) {
      applyChapterCounts(cached);
      return;
    }
    const frame = document.createElement('iframe');
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${vw}px;height:${vh}px;visibility:hidden;pointer-events:none;border:0;`;
    document.body.appendChild(frame);
    const counts: number[] = [];
    try {
      for (let index = 0; index < epub.spine.length; index += 1) {
        const rawHtml = await epub.getChapterContent(epub.spine[index].href);
        const doc = frame.contentDocument;
        if (!doc) break;
        doc.open();
        doc.write(buildChapterDocument(rawHtml).html);
        doc.close();
        await doc.fonts?.ready;
        const images = Array.from(doc.images);
        await Promise.race([
          Promise.all(images.map((image) => image.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
              image.addEventListener('load', () => resolve(), { once: true });
              image.addEventListener('error', () => resolve(), { once: true });
            }))),
          new Promise<void>((resolve) => window.setTimeout(resolve, 1200)),
        ]);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
        const scroller = doc.getElementById('reader-scroller');
        if (scroller) {
          counts[index] = countScrollerPages(doc, scroller, isVertical, vw, vh);
        } else {
          counts[index] = 1;
        }
      }
      if (measurementVersion !== measurementVersionRef.current) return;
      applyChapterCounts(counts);
      if (counts.length === epub.spine.length) writePaginationCache(cacheKey, counts);
    } finally {
      frame.remove();
    }
  }, [
    applyChapterCounts,
    buildChapterDocument,
    epub,
    isVertical,
    paginationCacheKey,
    readPaginationCache,
    writePaginationCache,
  ]);

  const measureBookPagesRef = useRef(measureBookPages);
  useEffect(() => { measureBookPagesRef.current = measureBookPages; }, [measureBookPages]);

  // ─── SELECTION ────────────────────────────────────────────────────────────────
  const handleSelection = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;
    const sel = iframe.contentWindow?.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) return;

    const range = sel.getRangeAt(0);
    const scroller = iframe.contentDocument.getElementById('reader-scroller');
    const anchor = scroller
      ? captureTextAnnotation(range, scroller, currentSpineRef.current)
      : null;
    selectionRangeRef.current = range.cloneRange();
    selectionAnnotationRef.current = anchor;
    const matchingAnnotation = anchor && textAnnotationsRef.current.find((annotation) =>
      annotation.spineIndex === anchor.spineIndex &&
      annotation.quote === anchor.quote &&
      annotation.prefix === anchor.prefix &&
      annotation.suffix === anchor.suffix
    );
    const intersectingSpan = matchingAnnotation ? null : Array.from(
      iframe.contentDocument.querySelectorAll<HTMLElement>('[data-reader-underline]')
    ).find((span) => {
      try {
        return range.intersectsNode(span);
      } catch {
        return false;
      }
    });
    const annotationId = matchingAnnotation?.id || intersectingSpan?.dataset.readerUnderline || null;
    selectedTextAnnotationIdRef.current = annotationId || null;
    setIsSelectionUnderlined(Boolean(annotationId));

    const text = sel.toString().trim();
    const rect = range.getBoundingClientRect();
    const iRect = iframe.getBoundingClientRect();

    lastSelectionTime.current = Date.now();
    // Fold the menu away while the selection is being made, and only bring it
    // back once the finger is off the screen and the selection has settled.
    // A time-only rule revealed the menu in the pause between the long-press
    // and grabbing a handle, which is exactly when it gets in the way.
    setIsSelectionAdjusting(true);
    if (selectionSettleRef.current !== undefined) window.clearTimeout(selectionSettleRef.current);
    const revealWhenReleased = (waited: number) => {
      // Handles do not always deliver a matching pointerup, so give up waiting
      // after a while rather than hiding the menu for good.
      if (!pointerActiveRef.current || waited >= 2500) {
        setIsSelectionAdjusting(false);
        return;
      }
      selectionSettleRef.current = window.setTimeout(() => revealWhenReleased(waited + 250), 250);
    };
    selectionSettleRef.current = window.setTimeout(() => revealWhenReleased(300), 300);
    setSelectedText(text);
    setSelectionPos({
      x: iRect.left + rect.left,
      y: iRect.top + rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  const handleToggleUnderline = useCallback(() => {
    const anchor = selectionAnnotationRef.current;
    const iframe = iframeRef.current;
    const scroller = iframe?.contentDocument?.getElementById('reader-scroller');
    if (!anchor || !scroller) return;

    const existing = textAnnotationsRef.current.find((annotation) =>
      annotation.id === selectedTextAnnotationIdRef.current
    ) || textAnnotationsRef.current.find((annotation) =>
      annotation.spineIndex === anchor.spineIndex &&
      annotation.quote === anchor.quote &&
      annotation.prefix === anchor.prefix &&
      annotation.suffix === anchor.suffix
    );
    if (existing) {
      removeTextAnnotationMarkup(scroller, existing.id);
      const next = textAnnotationsRef.current.filter((annotation) => annotation.id !== existing.id);
      textAnnotationsRef.current = next;
      setTextAnnotations(next);
      selectedTextAnnotationIdRef.current = null;
      setIsSelectionUnderlined(false);
      return;
    }

    const range = selectionRangeRef.current;
    if (!range || range.startContainer.ownerDocument !== scroller.ownerDocument) return;
    const annotation: TextAnnotation = {
      ...anchor,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    };
    applyTextAnnotationToRange(range, annotation.id);
    const next = [...textAnnotationsRef.current, annotation];
    textAnnotationsRef.current = next;
    setTextAnnotations(next);
    selectedTextAnnotationIdRef.current = annotation.id;
    setIsSelectionUnderlined(true);
  }, []);

  // ─── PAGE ACTIONS ─────────────────────────────────────────────────────────────
  // We use refs so that callbacks registered inside the iframe closure stay fresh.
  const doNextPage = useCallback(() => {
    const page = currentPageRef.current;
    const spine = currentSpineRef.current;
    const pages = totalPagesRef.current;

    if (page < pages - 1) {
      pageNudgeRef.current = 0;
      setPageNudge(0);
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
      pageNudgeRef.current = 0;
      setPageNudge(0);
      currentPageRef.current = page - 1;
      setCurrentPage(page - 1);
      updatePagination();
    } else if (spine > 0) {
      // Going back from the first page opens the end of the previous chapter,
      // not its first page.
      loadChapter(spine - 1, -1);
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
      selectionRangeRef.current = null;
      selectionAnnotationRef.current = null;
      selectedTextAnnotationIdRef.current = null;
      setIsSelectionUnderlined(false);
      currentSpineRef.current = spineIndex;
      setCurrentSpineIndex(spineIndex);
      if (targetPage >= 0) {
        currentPageRef.current = targetPage;
        setCurrentPage(targetPage);
      }
      setIsReaderPositioned(true);

      try {
        const item = epub.spine[spineIndex];
        const rawHtml = await epub.getChapterContent(item.href);

        const iframe = iframeRef.current;
        if (!iframe) return;
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) return;

        const { html: fullHtml, sidePad, fontSize } = buildChapterDocument(rawHtml);

        doc.open();
        doc.write(fullHtml);
        doc.close();

        // Force common Japanese ellipsis, exclamation, and question marks upright in vertical writing.
        if (isVertical) {
          const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
          const textNodes: Text[] = [];
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (node.parentElement?.closest('style, script, .vertical-punctuation')) continue;
            if (/[…⋯︙!?！？‼⁇⁉]/.test(node.nodeValue || '')) textNodes.push(node as Text);
          }
          textNodes.forEach((textNode) => {
            const parts = (textNode.nodeValue || '').split(/([…⋯︙!?！？‼⁇⁉]+)/g);
            const fragment = doc.createDocumentFragment();
            parts.forEach((part) => {
              if (!part) return;
              if (/^[…⋯︙!?！？‼⁇⁉]+$/.test(part)) {
                const span = doc.createElement('span');
                span.className = 'vertical-punctuation';
                span.textContent = part;
                fragment.appendChild(span);
              } else {
                fragment.appendChild(doc.createTextNode(part));
              }
            });
            textNode.parentNode?.replaceChild(fragment, textNode);
          });
        }

        const scroller = doc.getElementById('reader-scroller');
        if (scroller) {
          applyTextAnnotations(
            scroller,
            textAnnotationsRef.current.filter((annotation) => annotation.spineIndex === spineIndex)
          );
        }

        // ── Gesture & tap handlers attached inside the iframe ──
        const nudgeLimit = 72;
        const pageSwipeThreshold = 96;
        // Extra lateral push required once the selection has reached the very end
        // of the visible page. Reaching the last column must not paginate: only
        // insisting in the same direction does.
        const selectionPushDistance = 50;
        const selectionPushReset = 16;
        const selectionHoldDelay = 1000;
        const selectionGuardDuration = 650;
        const selectionResumeDistance = 24;
        // The reading flow of a page grows towards this side, so the next page
        // always lives beyond it. vertical-rl is anchored right and grows left.
        const forwardSide: 'left' | 'right' = isVertical ? 'left' : 'right';

        let sx = 0, sy = 0, st = 0, moved = false, selecting = false;
        let gestureNudgeStart = 0;
        let selectionOrOverlayAtStart = false;
        let pointerX = 0;
        let pointerTracked = false;
        let pointerDrivenSelection = false;
        let edgePush = 0;
        let edgePushDirection: 'next' | 'previous' | null = null;
        let selectionHoldTimer: number | undefined;
        let selectionHoldDirection: 'next' | 'previous' | null = null;
        let selectionBaseline = '';
        let selectionBaselineReady = false;
        let selectionAdjustmentStarted = false;
        let selectionBaselineTimer: number | undefined;
        let selectionTurnBusy = false;
        let ignoreSelectionChange = false;
        let selectionGuard:
          | {
            node: Node;
            offset: number;
            pointerX: number;
            pushSign: number;
            direction: 'next' | 'previous';
            until: number;
          }
          | null = null;

        const getPageWidth = () => iframe.clientWidth || window.innerWidth;

        const clearSelectionHold = (reason = '') => {
          if (selectionHoldTimer !== undefined) {
            window.clearTimeout(selectionHoldTimer);
            selectionHoldTimer = undefined;
            logDebugRef.current(`hold cancelled ${reason}`);
          }
          selectionHoldDirection = null;
        };

        const getSelectionSignature = (selection: Selection) =>
          `${selection.toString()}|${selection.anchorOffset}|${selection.focusOffset}`;

        const resetSelectionTracking = () => {
          clearSelectionHold('reset');
          if (selectionBaselineTimer !== undefined) {
            window.clearTimeout(selectionBaselineTimer);
            selectionBaselineTimer = undefined;
          }
          selectionBaseline = '';
          selectionBaselineReady = false;
          selectionAdjustmentStarted = false;
        };

        const isSelectionBackwards = (selection: Selection) => {
          const { anchorNode, focusNode } = selection;
          if (!anchorNode || !focusNode) return false;
          if (anchorNode === focusNode) return selection.focusOffset < selection.anchorOffset;
          const position = anchorNode.compareDocumentPosition(focusNode);
          return Boolean(position & Node.DOCUMENT_POSITION_PRECEDING);
        };

        // Rect of the character immediately after (or before) the caret in
        // document order. Ruby annotations are skipped because they are not
        // selectable and would report the position of their base text.
        const getAdjacentCharRect = (node: Node | null, offset: number, forward: boolean) => {
          const scroller = doc.getElementById('reader-scroller');
          if (!node || node.nodeType !== Node.TEXT_NODE || !scroller?.contains(node)) return null;
          const walker = doc.createTreeWalker(scroller, NodeFilter.SHOW_TEXT, {
            acceptNode: (candidate: Node) =>
              (candidate.nodeValue || '').trim() && !(candidate.parentElement?.closest('rt'))
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT,
          });
          walker.currentNode = node;
          let cursor: Node | null = node;
          let index = forward ? offset : offset - 1;
          let guard = 0;
          while (cursor && guard < 400) {
            guard += 1;
            const length = (cursor.nodeValue || '').length;
            if (forward ? index < length : index >= 0) {
              const range = doc.createRange();
              range.setStart(cursor, index);
              range.setEnd(cursor, index + 1);
              const rect = range.getBoundingClientRect();
              if (rect.width || rect.height) return rect;
              index = forward ? index + 1 : index - 1;
              continue;
            }
            cursor = forward ? walker.nextNode() : walker.previousNode();
            if (!cursor) return null;
            index = forward ? 0 : (cursor.nodeValue || '').length - 1;
          }
          return null;
        };

        // Returns a direction when the caret sits on the page boundary: the
        // next character of the flow is already off-screen.
        // `tolerant` also accepts a caret standing on the last line of the
        // page. Native selection handles follow the finger, which cannot
        // always reach the very last character in the corner, so the handle
        // path needs the looser test; the pointer path keeps the strict one,
        // because there insisting with the finger is what confirms the turn.
        const getSelectionEdgeDirection = (tolerant = false): 'next' | 'previous' | null => {
          const selection = iframe.contentWindow?.getSelection();
          if (!selection?.rangeCount || !selection.toString()) return null;
          const backwards = isSelectionBackwards(selection);
          const pageWidth = getPageWidth();
          const pageHeight = iframe.clientHeight || window.innerHeight;
          const rect = getAdjacentCharRect(selection.focusNode, selection.focusOffset, !backwards);
          // Where the neighbouring character lies relative to the visible page.
          // Vertical pages are stacked downwards: the following page is below
          // the screen and the previous one above it.
          let side: 'forward' | 'backward' | null = null;
          if (rect) {
            if (isVertical) {
              if (rect.top >= pageHeight - 1) side = 'forward';
              else if (rect.bottom <= 1) side = 'backward';
            } else if (rect.left >= pageWidth - 1) side = 'forward';
            else if (rect.right <= 1) side = 'backward';
          }
          if (!side && tolerant) {
            const focusRect = getAdjacentCharRect(selection.focusNode, selection.focusOffset, backwards);
            if (focusRect) {
              // A page ends on its last line: the leftmost one in vertical-rl,
              // the rightmost column edge in horizontal.
              const lastLine = sidePad + fontSize * settings.lineHeight * 1.2;
              const nearLeft = focusRect.left <= lastLine;
              const nearRight = focusRect.right >= pageWidth - lastLine;
              if (isVertical) side = nearLeft ? 'forward' : nearRight ? 'backward' : null;
              else side = nearRight ? 'forward' : nearLeft ? 'backward' : null;
            }
          }
          if (!side) return null;
          if (!backwards) return side === 'forward' ? 'next' : null;
          return side === 'backward' ? 'previous' : null;
        };

        const canTurnSelectionPage = (direction: 'next' | 'previous') =>
          direction === 'next'
            ? currentPageRef.current < totalPagesRef.current - 1
            : currentPageRef.current > 0;

        // Caret where reading enters the page that is about to become visible.
        const getPageEntryCaret = (direction: 'next' | 'previous') => {
          const caretFromPoint = (doc as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
          }).caretRangeFromPoint;
          if (!caretFromPoint) return null;
          const pageWidth = getPageWidth();
          const pageHeight = iframe.clientHeight || window.innerHeight;
          // Reading starts on the right in vertical-rl and on the left otherwise;
          // going back lands on the opposite corner, where the page ends.
          const startsRight = isVertical;
          const useRightSide = direction === 'next' ? startsRight : !startsRight;
          const ys = direction === 'next'
            ? [pageHeight * 0.06, pageHeight * 0.18, pageHeight * 0.5]
            : [pageHeight * 0.94, pageHeight * 0.82, pageHeight * 0.5];
          // Start inside the column: the outer band is the column gap, and a
          // point there resolves to the neighbouring column, i.e. the page we
          // just left.
          const columnStart = sidePad + 6;
          const columnSpan = Math.max(1, pageWidth - sidePad * 2 - 6);
          for (const y of ys) {
            for (let step = 0; step < 12; step += 1) {
              const inset = columnStart + step * columnSpan * 0.08;
              const x = useRightSide ? pageWidth - inset : inset;
              const range = caretFromPoint.call(doc, x, y);
              const container = range?.startContainer;
              if (!range || container?.nodeType !== Node.TEXT_NODE) continue;
              // Reject carets that resolved onto an off-screen column.
              const probe = doc.createRange();
              probe.setStart(container, range.startOffset);
              probe.setEnd(container, Math.min(range.startOffset + 1, (container.nodeValue || '').length));
              const rect = probe.getBoundingClientRect();
              if (!rect.width && !rect.height) continue;
              if (rect.right <= 1 || rect.left >= pageWidth - 1) continue;
              if (rect.bottom <= 1 || rect.top >= pageHeight - 1) continue;
              return { node: container, offset: range.startOffset };
            }
          }
          return null;
        };

        const turnSelectionPage = (direction: 'next' | 'previous') => {
          const selection = iframe.contentWindow?.getSelection();
          if (selectionTurnBusy || !selection?.rangeCount || !canTurnSelectionPage(direction)) {
            logDebugRef.current(
              `turn refused busy=${selectionTurnBusy ? 1 : 0} sel=${selection?.rangeCount || 0} can=${canTurnSelectionPage(direction) ? 1 : 0}`
            );
            return;
          }
          clearSelectionHold('turning');
          selectionAdjustmentStarted = true;
          // Block further boundary checks until the page transition settles,
          // otherwise the mid-animation layout reports the edge again and the
          // reader would skip several pages at once.
          selectionTurnBusy = true;
          edgePush = 0;
          edgePushDirection = null;
          const pushSign = direction === 'next'
            ? (forwardSide === 'left' ? -1 : 1)
            : (forwardSide === 'left' ? 1 : -1);
          logDebugRef.current(`TURN ${direction} from p${currentPageRef.current + 1}`);
          if (direction === 'next') doNextRef.current();
          else doPrevRef.current();

          // Once the page transition settles, pin the caret to the edge where
          // the new page starts. Without this the selection would jump a whole
          // column at once, because the pointer already rests on the far side.
          window.setTimeout(() => {
            selectionTurnBusy = false;
            if (currentSpineRef.current !== spineIndex) return;
            const live = iframe.contentWindow?.getSelection();
            if (!live?.rangeCount || !live.toString()) return;
            const caret = getPageEntryCaret(direction);
            if (!caret) return;
            // Never let the re-anchoring destroy the selection: if the caret
            // lands on the anchor itself the selection would collapse.
            const previous = live.getRangeAt(0).cloneRange();
            const previousLength = live.toString().length;
            try {
              live.extend(caret.node, caret.offset);
            } catch {
              return;
            }
            if (live.toString().length < previousLength) {
              live.removeAllRanges();
              live.addRange(previous);
              return;
            }
            selectionGuard = {
              node: caret.node,
              offset: caret.offset,
              pointerX,
              pushSign,
              direction,
              until: Date.now() + selectionGuardDuration,
            };
            handleSelection();
          }, 260);
        };

        // Android's native selection handles do not emit touch events, so the
        // boundary is watched through selectionchange and confirmed by holding.
        const scheduleSelectionHold = (direction: 'next' | 'previous') => {
          // Merely creating a selection at the edge must never turn the page.
          // The hold is only valid after a later selection change proves that
          // the user is dragging a handle to extend the selection.
          if (!selectionAdjustmentStarted) {
            logDebugRef.current(`hold skipped, selection not adjusting`);
            return;
          }
          if (selectionHoldTimer !== undefined && selectionHoldDirection === direction) return;
          clearSelectionHold('rearm');
          if (!canTurnSelectionPage(direction)) {
            logDebugRef.current(`hold skipped, cannot turn ${direction}`);
            return;
          }
          selectionHoldDirection = direction;
          logDebugRef.current(`hold armed ${direction}`);
          selectionHoldTimer = window.setTimeout(() => {
            selectionHoldTimer = undefined;
            selectionHoldDirection = null;
            logDebugRef.current(`hold fired busy=${selectionTurnBusy ? 1 : 0}`);
            if (currentSpineRef.current !== spineIndex) {
              logDebugRef.current('hold dropped (chapter)');
              return;
            }
            if (getSelectionEdgeDirection() !== direction) {
              logDebugRef.current('hold dropped (off edge)');
              return;
            }
            turnSelectionPage(direction);
          }, selectionHoldDelay);
        };

        const handleIframeSelectionChange = () => {
          if (ignoreSelectionChange) return;
          const selection = iframe.contentWindow?.getSelection();
          if (!selection?.rangeCount || !selection.toString()) {
            resetSelectionTracking();
            selectionGuard = null;
            edgePush = 0;
            edgePushDirection = null;
            setSelectedText('');
            setSelectionPos(null);
            selectionRangeRef.current = null;
            selectionAnnotationRef.current = null;
            selectedTextAnnotationIdRef.current = null;
            setIsSelectionUnderlined(false);
            return;
          }

          const scroller = doc.getElementById('reader-scroller');
          const focusNode = selection.focusNode;
          const anchorNode = selection.anchorNode;

          if (
            !focusNode ||
            !anchorNode ||
            focusNode.nodeType !== Node.TEXT_NODE ||
            anchorNode.nodeType !== Node.TEXT_NODE ||
            focusNode === scroller ||
            anchorNode === scroller ||
            focusNode === doc.body ||
            anchorNode === doc.body ||
            focusNode === doc.documentElement ||
            anchorNode === doc.documentElement
          ) {
            return;
          }

          const range = selection.getRangeAt(0);
          if (range) {
            selectionRangeRef.current = range.cloneRange();
          }

          const signature = getSelectionSignature(selection);
          if (!selectionBaseline) {
            selectionBaseline = signature;
            selectionBaselineReady = false;
            if (selectionBaselineTimer !== undefined) window.clearTimeout(selectionBaselineTimer);
            selectionBaselineTimer = window.setTimeout(() => {
              selectionBaselineReady = true;
              const current = iframe.contentWindow?.getSelection();
              if (current?.rangeCount && current.toString()) {
                selectionBaseline = getSelectionSignature(current);
              }
              selectionBaselineTimer = undefined;
            }, 180);
          } else if (selectionBaselineReady && signature !== selectionBaseline) {
            selectionAdjustmentStarted = true;
            selectionBaseline = signature;
          }

          if (selectionGuard) {
            if (Date.now() < selectionGuard.until) {
              if (
                selection.focusNode !== selectionGuard.node ||
                selection.focusOffset !== selectionGuard.offset
              ) {
                try {
                  selection.extend(selectionGuard.node, selectionGuard.offset);
                } catch {
                  selectionGuard = null;
                }
              }
              handleSelection();
              return;
            }
            selectionGuard = null;
          }

          handleSelection();
          if (selectionTurnBusy) return;
          // Do not use the tolerant last-line check here. A selection can
          // legitimately end in the penultimate column; only an adjacent
          // character that is actually outside the viewport is a boundary.
          const direction = getSelectionEdgeDirection();
          logDebugRef.current(
            `sel ${selection.toString().length} edge=${direction || '-'} p${currentPageRef.current + 1}/${totalPagesRef.current} pd=${pointerDrivenSelection ? 1 : 0}`
          );
          if (direction) scheduleSelectionHold(direction);
          else clearSelectionHold('off edge');
        };

        const onStart = (cx: number, cy: number) => {
          clearSelectionHold('start');
          sx = cx; sy = cy; st = Date.now(); moved = false; selecting = false;
          pointerX = cx;
          pointerTracked = true;
          pointerDrivenSelection = false;
          selectionGuard = null;
          resetSelectionTracking();
          edgePush = 0;
          edgePushDirection = null;
          gestureNudgeStart = pageNudgeRef.current;
          selectionOrOverlayAtStart = Boolean(
            selectedTextRef.current.trim() ||
            openOverlayRef.current ||
            iframe.contentWindow?.getSelection()?.toString().trim()
          );
        };
        const onMove = (cx: number, cy: number) => {
          const dx = cx - sx;
          const dy = cy - sy;
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;

          const selection = iframe.contentWindow?.getSelection();
          const hasSelection = Boolean(selection?.rangeCount && selection.toString());

          if (!hasSelection && !selecting && Math.abs(dx) > 8 && Math.abs(dx) <= nudgeLimit && Math.abs(dx) > Math.abs(dy)) {
            const nudge = Math.max(-nudgeLimit, Math.min(nudgeLimit, gestureNudgeStart + dx));
            pageNudgeRef.current = nudge;
            const page = currentPageRef.current;
            const vw = iframe.clientWidth || window.innerWidth;
            const vh = iframe.clientHeight || window.innerHeight;
            const scroller = doc.getElementById('reader-scroller');
            if (scroller) {
              scroller.style.transform = isVertical
                ? `translate(${nudge}px, ${-page * vh}px)`
                : `translateX(${-page * vw + nudge}px)`;
            }
          }

          if (!hasSelection) return;
          selecting = true;
        };

        // Runs on pointermove, which is what the native selection handles
        // deliver. It only handles pushing the selection past the page edge;
        // paging gestures stay on the touch/mouse path above.
        const onSelectionPointerMove = (cx: number) => {
          const selection = iframe.contentWindow?.getSelection();
          if (!selection?.rangeCount || !selection.toString()) {
            pointerTracked = false;
            return;
          }
          selectionAdjustmentStarted = true;
          pointerDrivenSelection = true;
          clearSelectionHold('push');

          // A handle drag can arrive with no start event at all, so the first
          // sample only establishes where the finger is.
          const step = pointerTracked ? cx - pointerX : 0;
          pointerX = cx;
          pointerTracked = true;

          if (selectionGuard) {
            // Selection resumes freely as soon as the pointer travels back
            // towards the inside of the page that was just turned to.
            const inward = (cx - selectionGuard.pointerX) * -selectionGuard.pushSign;
            if (inward > selectionResumeDistance) {
              selectionGuard = null;
              return;
            }
            if (Date.now() < selectionGuard.until) return;
            // Still pushing against the same edge: chain another page keeping
            // the caret anchored, instead of releasing it onto the far column.
            const held = selectionGuard;
            selectionGuard = null;
            turnSelectionPage(held.direction);
            return;
          }

          if (selectionTurnBusy) return;
          const direction = getSelectionEdgeDirection();
          if (!direction) {
            edgePush = 0;
            edgePushDirection = null;
            return;
          }
          const pushSign = direction === 'next'
            ? (forwardSide === 'left' ? -1 : 1)
            : (forwardSide === 'left' ? 1 : -1);
          if (edgePushDirection !== direction) {
            edgePushDirection = direction;
            edgePush = 0;
          }
          const advance = step * pushSign;
          if (advance > 0) edgePush += advance;
          else if (advance < -selectionPushReset) edgePush = 0;
          logDebugRef.current(`push ${Math.round(edgePush)} ${direction} x=${Math.round(cx)}`);
          if (edgePush >= selectionPushDistance) turnSelectionPage(direction);
        };
        const onEnd = (cx: number, allowTapNavigation = true) => {
          // Releasing the gesture also cancels any pending boundary hold, so
          // finishing a selection at the end of a page never turns it.
          clearSelectionHold('end');
          if (selectionBaselineTimer !== undefined) {
            window.clearTimeout(selectionBaselineTimer);
            selectionBaselineTimer = undefined;
          }
          pointerDrivenSelection = false;
          selectionGuard = null;
          edgePush = 0;
          edgePushDirection = null;
          const dt = Date.now() - st;
          const dx = cx - sx;

          if (moved && Math.abs(dx) <= nudgeLimit) {
            setPageNudge(pageNudgeRef.current);
            return;
          }

          setTimeout(() => {
            const sel = iframe.contentWindow?.getSelection()?.toString().trim();
            const isTap = allowTapNavigation && !moved && dt < 300;
            if (isTap && (selectionOrOverlayAtStart || sel || selectedTextRef.current.trim() || openOverlayRef.current)) {
              iframe.contentWindow?.getSelection()?.removeAllRanges();
              setSelectedText('');
              setSelectionPos(null);
              selectionRangeRef.current = null;
              selectionAnnotationRef.current = null;
              selectedTextAnnotationIdRef.current = null;
              setIsSelectionUnderlined(false);
              setIsTocOpen(false);
              setIsSettingsOpen(false);
              setIsTranslateOpen(false);
              setImageViewerSrc(null);
              return;
            }
            if (sel) { handleSelection(); return; }

            if (!selecting && !sel && Math.abs(dx) >= pageSwipeThreshold) {
              // Swipe follows the same physical direction as the page controls:
              // moving right advances and moving left goes back.
              if (dx > 0) doNextRef.current(); else doPrevRef.current();
              return;
            }

            if (isTap) {
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

        logDebugRef.current('listeners ok');
        doc.addEventListener('selectionchange', () => {
          countDebugRef.current('selchg');
          handleIframeSelectionChange();
        });
        // The native selection handles report through pointer events, so this is
        // the stream the selection paging has to run on.
        doc.addEventListener('pointerdown', () => countDebugRef.current('pdown'), { passive: true });
        doc.addEventListener('pointermove', (e) => {
          countDebugRef.current('pmove');
          onSelectionPointerMove(e.clientX);
        }, { passive: true });
        doc.addEventListener('pointerup', () => countDebugRef.current('pup'), { passive: true });
        // The browser cancels the pointer as soon as a long-press turns into a
        // native selection. That must not be read as "the finger left the
        // screen": doing so let the menu pop up mid-selection, and swallowed
        // the end of swipe gestures.
        doc.addEventListener('pointercancel', () => {
          countDebugRef.current('pcancel');
          pointerTracked = false;
        }, { passive: true });
        document.addEventListener('selectionchange', () => countDebugRef.current('selchg-top'));
        doc.addEventListener('contextmenu', (e) => e.preventDefault());
        doc.addEventListener('mousedown', (e) => {
          pointerActiveRef.current = true;
          onStart(e.clientX, e.clientY);
        });
        doc.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
        doc.addEventListener('mouseup', (e) => {
          pointerActiveRef.current = false;
          onEnd(e.clientX);
        });
        doc.addEventListener('dblclick', (e) => {
          const target = (e.target as Element | null)?.closest('img, svg');
          const source = target?.getAttribute('src') || target?.getAttribute('href');
          if (source) {
            e.preventDefault();
            setImageViewerSrc(source);
            setImageViewerScale(1);
            setImageViewerOffset({ x: 0, y: 0 });
          }
        });
        // Android WebView routes selection-handle drags outside the document's
        // touch event stream. selectionchange handles those interactions while
        // touch gestures remain available for regular page swipes.
        doc.addEventListener('touchstart', (e) => {
          countDebugRef.current('tstart');
          pointerActiveRef.current = true;
          if (e.touches[0]) onStart(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        doc.addEventListener('touchmove', (e) => {
          countDebugRef.current('tmove');
          if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        doc.addEventListener('touchend', (e) => {
          countDebugRef.current('tend');
          pointerActiveRef.current = false;
          if (e.changedTouches[0]) onEnd(e.changedTouches[0].clientX, false);
        }, { passive: true });
        doc.addEventListener('touchcancel', () => {
          countDebugRef.current('tcancel');
          pointerActiveRef.current = false;
        }, { passive: true });

        // ── Trigger pagination once content is laid out ──
        const loadedAt = Date.now();
        // How long the freshly loaded chapter may still move to its target
        // page while fonts, images and columns settle.
        const positionSettleWindow = 700;
        // After this long without a measurement above one page, accept that the
        // chapter really is a single page.
        const lastPageDeadline = 4000;
        // A negative target means "last page", which cannot be known until the
        // chapter has been measured for real.
        const wantsLastPage = targetPage === -1;
        let lastPageResolved = !wantsLastPage;
        let targetApplied = false;

        const applyTargetPosition = () => {
          currentSpineRef.current = spineIndex;
          pageNudgeRef.current = 0;
          setPageNudge(0);
          setCurrentSpineIndex(spineIndex);
          setIsReaderPositioned(true);
          targetApplied = true;
          if (wantsLastPage) {
            // Once resolveLastPage has landed on the real last page, this must
            // not touch the page again. It used to reset it to 0 on every
            // trigger inside the settle window, so a target resolved early was
            // silently undone by the next timeout or resize — and since the
            // target counts as resolved, nothing ever put it right again.
            if (!lastPageResolved) currentPageRef.current = 0;
          } else {
            currentPageRef.current = targetPage;
            setCurrentPage(targetPage);
          }
          updatePagination();
          if (lastPageResolved) setIsLoadingChapter(false);
        };

        // Resolving "last page" used to happen once, inline, right after
        // painting page 0: hence the visible flash of the chapter's first page
        // followed by a jump to the end. Worse, if that single attempt landed
        // while the columns were still laying out, totalPages read 1, the
        // target resolved to page 0 and the reader simply stayed there — no
        // later trigger would try again once the settle window had closed.
        // It is now retried until a real measurement arrives, and the loading
        // overlay stays up meanwhile so no intermediate page is shown.
        let lastMeasuredPages = -1;
        const resolveLastPage = () => {
          if (lastPageResolved || currentSpineRef.current !== spineIndex) return;
          const measured = totalPagesRef.current;
          const known = chapterPageCountsRef.current[spineIndex] || 0;
          const stable = measured === lastMeasuredPages;
          lastMeasuredPages = measured;
          // Only settle on "the last page" once the layout is final. The first
          // measurement usually arrives before the web fonts, and swapping the
          // fallback font for the real one reflows the chapter onto more pages:
          // resolving early landed the reader a few pages short of the end
          // (page 91 of 95 in testing). So wait for fonts and images, for two
          // equal readings in a row, and for the live count to catch up with
          // the offline one, which is measured with everything loaded and the
          // very same document. The deadline caps the wait either way.
          if (Date.now() - loadedAt < lastPageDeadline) {
            const fontsReady = !doc.fonts || doc.fonts.status === 'loaded';
            const imagesReady = Array.from(doc.images).every((image) => image.complete);
            if (!fontsReady || !imagesReady || !stable || known > measured) return;
          }
          // The live measurement is authoritative; the offline count only stands
          // in when there is no layout yet.
          const total = measured > 1 ? measured : Math.max(measured, known);
          lastPageResolved = true;
          const lastPage = Math.max(0, total - 1);
          currentPageRef.current = lastPage;
          setCurrentPage(lastPage);
          pageViewport = `${iframe.clientWidth}x${iframe.clientHeight}`;
          updatePagination();
          setIsLoadingChapter(false);
          logDebugRef.current(`last page resolved p${lastPage + 1}/${total}`);
        };

        let pageViewport = `${iframe.clientWidth}x${iframe.clientHeight}`;

        // Re-measures the chapter WITHOUT touching the reading position.
        const refreshLayout = () => {
          currentSpineRef.current = spineIndex;
          updatePagination();
          const viewport = `${iframe.clientWidth}x${iframe.clientHeight}`;
          const viewportChanged = viewport !== pageViewport;
          pageViewport = viewport;
          // Never move the reader while a selection is live: that is exactly
          // when mobile browsers resize the viewport, and it would undo the
          // page just turned to extend the selection.
          const selectionLive = Boolean(selectedTextRef.current.trim());
          const lastPage = Math.max(0, totalPagesRef.current - 1);
          // A re-measure at the same viewport size that reports fewer pages is
          // transient layout noise, not a shorter chapter. Acting on it would
          // drag the reader backwards for no reason.
          if (lastPageResolved && !selectionLive && viewportChanged && currentPageRef.current > lastPage) {
            logDebugRef.current(`CLAMP p${currentPageRef.current + 1}->p${lastPage + 1}`);
            currentPageRef.current = lastPage;
            setCurrentPage(lastPage);
            updatePagination();
          }
          if (lastPageResolved) setIsLoadingChapter(false);
        };

        // Layout keeps changing long after the chapter loaded: mobile browsers
        // show and hide their address bar, the native selection toolbar opens,
        // images finish decoding. Those must only re-measure — re-applying the
        // target page would throw the reader back to the start of the chapter
        // mid-selection, undoing any page turned while selecting.
        const triggerUpdate = () => {
          if (!targetApplied) {
            applyTargetPosition();
          } else {
            logDebugRef.current('layout re-measure');
            refreshLayout();
          }
          resolveLastPage();
        };

        doc.fonts?.ready?.then(triggerUpdate);
        doc.querySelectorAll('img').forEach(img => img.addEventListener('load', triggerUpdate));

        const wrapper = doc.getElementById('reader-scroller');
        if (wrapper && 'ResizeObserver' in window) {
          const browserChromeJitter = 120;
          let layoutDebounce: number | undefined;
          let lastWidth = iframe.clientWidth;
          let lastHeight = iframe.clientHeight;
          const observer = new ResizeObserver(() => {
            if (layoutDebounce !== undefined) window.clearTimeout(layoutDebounce);
            layoutDebounce = window.setTimeout(() => {
              layoutDebounce = undefined;
              const width = iframe.clientWidth;
              const height = iframe.clientHeight;
              if (Date.now() - loadedAt >= positionSettleWindow) {
                const widthChanged = width !== lastWidth;
                const rotated = Math.abs(height - lastHeight) > browserChromeJitter;
                if (!widthChanged && !rotated) return;
              }
              lastWidth = width;
              lastHeight = height;
              triggerUpdate();
            }, 180);
          });
          observer.observe(wrapper);
        }

        setTimeout(triggerUpdate, 60);
        setTimeout(triggerUpdate, 200);
        setTimeout(triggerUpdate, 500);
        setTimeout(() => {
          if (currentSpineRef.current !== spineIndex) return;
          if (!targetApplied) {
            logDebugRef.current('target forced');
            applyTargetPosition();
          }
          setIsReaderPositioned(true);
          // Resolving "last page" may legitimately take up to its deadline;
          // lifting the overlay before that would flash an intermediate page.
          resolveLastPage();
          if (lastPageResolved) setIsLoadingChapter(false);
        }, 3000);
        setTimeout(() => {
          if (currentSpineRef.current !== spineIndex) return;
          resolveLastPage();
          setIsLoadingChapter(false);
        }, lastPageDeadline + 300);

        // Poll for the measurement instead of relying on layout events, which
        // may all fire before the columns are ready on a long chapter.
        if (wantsLastPage) {
          const retryLastPage = () => {
            if (lastPageResolved || currentSpineRef.current !== spineIndex) return;
            updatePagination();
            resolveLastPage();
            if (!lastPageResolved) window.setTimeout(retryLastPage, 120);
          };
          window.setTimeout(retryLastPage, 80);
        }

      } catch (err) {
        console.error(err);
        setIsLoadingChapter(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epub, settings, isVertical, isRtl, themeColors, updatePagination, handleSelection]
  );

  useEffect(() => {
    logDebugRef.current = (line: string) => {
      if (!debugEnabled) return;
      const stamp = new Date().toISOString().slice(17, 23);
      debugBufferRef.current = [...debugBufferRef.current.slice(-13), `${stamp} ${line}`];
    };
    countDebugRef.current = (key: string) => {
      if (!debugEnabled) return;
      debugCountsRef.current[key] = (debugCountsRef.current[key] || 0) + 1;
    };
  }, [debugEnabled]);

  useEffect(() => {
    if (!debugEnabled) return;
    const flush = window.setInterval(() => {
      const counts = Object.entries(debugCountsRef.current)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
      const next = [...debugBufferRef.current, counts || 'sin eventos'];
      setDebugLines((prev) => (prev.join('|') === next.join('|') ? prev : next));
    }, 300);
    return () => window.clearInterval(flush);
  }, [debugEnabled]);

  // Sync state → refs so iframe closures always see latest values
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);
  useEffect(() => { currentSpineRef.current = currentSpineIndex; }, [currentSpineIndex]);
  useEffect(() => {
    selectedTextRef.current = selectedText;
    openOverlayRef.current = isBookmarksOpen || isTranslationHistoryOpen || isTocOpen || isSettingsOpen || isTranslateOpen || Boolean(imageViewerSrc);
  }, [imageViewerSrc, isBookmarksOpen, isSettingsOpen, isTocOpen, isTranslateOpen, isTranslationHistoryOpen, selectedText]);

  useEffect(() => {
    const query = selectedText.trim();
    if (isSelectionAdjusting || !query || Array.from(query).length > 32) {
      setDictionaryPreview(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getDictionarySearchTerms(query)
        .then((lookup) => {
          if (cancelled) return;
          const hasEntries = lookup.entries.length > 0;
          setDictionaryPreview(hasEntries ? lookup : null);
          if (hasEntries) {
            handleSaveTranslationHistory(
              'dictionary',
              query,
              formatDictionaryHistoryResponse(lookup.baseForm, lookup.searchTerms, lookup.entries)
            );
          }
        })
        .catch(() => {
          if (!cancelled) setDictionaryPreview(null);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [handleSaveTranslationHistory, isSelectionAdjusting, selectedText]);
  useEffect(() => {
    if (!isLoadingChapter) {
      saveReadingPosition({ spineIndex: currentSpineIndex, page: currentPage });
    }
  }, [currentPage, currentSpineIndex, isLoadingChapter, saveReadingPosition]);

  // Expose page-turn handlers to React world (footer buttons, keyboard)
  const handleNextPage = useCallback(() => doNextRef.current(), []);
  const handlePrevPage = useCallback(() => doPrevRef.current(), []);
  const handleNudgePage = useCallback((delta: number) => {
    const next = Math.max(-192, Math.min(192, pageNudgeRef.current + delta));
    pageNudgeRef.current = next;
    setPageNudge(next);
    updatePagination();
  }, [updatePagination]);
  const handleResetNudge = useCallback(() => {
    pageNudgeRef.current = 0;
    setPageNudge(0);
    updatePagination();
  }, [updatePagination]);

  const handleSeekPage = useCallback((requestedPage: number) => {
    if (!isBookPaginationReady || !bookTotalPages) return;
    const targetPage = Math.min(Math.max(0, Math.round(requestedPage)), bookTotalPages - 1);
    let targetSpineIndex = 0;
    for (let index = 0; index < bookPageOffsetsRef.current.length; index += 1) {
      if (bookPageOffsetsRef.current[index] <= targetPage) targetSpineIndex = index;
      else break;
    }
    const targetLocalPage = targetPage - (bookPageOffsetsRef.current[targetSpineIndex] || 0);
    if (targetSpineIndex === currentSpineRef.current) {
      currentPageRef.current = targetLocalPage;
      setCurrentPage(targetLocalPage);
      updatePagination();
      return;
    }
    loadChapter(targetSpineIndex, targetLocalPage);
  }, [bookTotalPages, isBookPaginationReady, loadChapter, updatePagination]);

  const handleSelectBookmark = useCallback((position: ReadingPosition) => {
    if (position.spineIndex < 0 || position.spineIndex >= epub.spine.length || position.page < 0) return;
    const maxPage = Math.max(1, chapterPageCountsRef.current[position.spineIndex] || 1) - 1;
    const targetPage = Math.min(position.page, maxPage);
    if (position.spineIndex === currentSpineRef.current) {
      currentPageRef.current = targetPage;
      setCurrentPage(targetPage);
      updatePagination();
    } else {
      loadChapter(position.spineIndex, targetPage);
    }
    setIsBookmarksOpen(false);
  }, [epub.spine.length, loadChapter, updatePagination]);

  const bookmarkItems = bookmarks.map((position) => {
    const chapterIndex = epub.toc.findIndex(
      (item) => resolveSpineIndex(item.href) === position.spineIndex
    );
    const chapterLabel = chapterIndex >= 0
      ? epub.toc[chapterIndex].label
      : `Capítulo ${getDisplayChapter(position.spineIndex)}`;
    return {
      ...position,
      chapterLabel,
      bookPage: getGlobalPage(position.spineIndex, position.page) + 1,
    };
  });
  const bookmarkPageMarkers = isBookPaginationReady
    ? bookmarks.map((position) => getGlobalPage(position.spineIndex, position.page))
    : [];

  // Reload the chapter when a style that changes the layout is modified.
  //
  // This compares the values rather than tracking whether the effect has run
  // before. With a "first run" flag, any second execution carrying the SAME
  // settings reloaded the chapter at page 0 — which is exactly what React's
  // StrictMode does on mount, since the ref survives the remount. The result
  // was that opening the book loaded chapter 0 over the restored position,
  // and the page counter briefly read "1/102" before the real chapter landed.
  const lastStyleSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const signature = [
      settings.writingMode,
      settings.fontFamily,
      settings.fontSize,
      settings.lineHeight,
      settings.theme,
    ].join('|');
    if (lastStyleSignatureRef.current === signature) return;
    const isFirstRun = lastStyleSignatureRef.current === null;
    lastStyleSignatureRef.current = signature;
    if (isFirstRun) return;
    loadChapter(currentSpineRef.current, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.writingMode, settings.fontFamily, settings.fontSize, settings.lineHeight, settings.theme]);

  // Initial load. The chapter opens first and the whole-book measurement runs
  // afterwards, in the background.
  //
  // This effect used to depend on measureBookPages, which is rebuilt whenever
  // any setting changes, and it awaited the measurement before calling
  // loadChapter with the position read at the start. Measuring a real book
  // (26 chapters here) takes seconds, so the reader was thrown back to a stale
  // stored position long after the user had navigated somewhere else: picking
  // a chapter from the table of contents appeared to do nothing, to open the
  // wrong chapter, or to land on an arbitrary page.
  const hasLoadedInitialRef = useRef(false);
  useEffect(() => {
    if (hasLoadedInitialRef.current) return;
    hasLoadedInitialRef.current = true;
    let position: ReadingPosition = { spineIndex: 0, page: 0 };
    try {
      const saved = localStorage.getItem(`${bookStorageKey}_position`);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ReadingPosition>;
        const savedSpineIndex = parsed.spineIndex;
        const savedPage = parsed.page;
        if (
          typeof savedSpineIndex === 'number' &&
          typeof savedPage === 'number' &&
          Number.isInteger(savedSpineIndex) &&
          Number.isInteger(savedPage) &&
          savedSpineIndex >= 0 &&
          savedSpineIndex < epub.spine.length &&
          savedPage >= 0
        ) {
          position = { spineIndex: savedSpineIndex, page: savedPage };
        }
      }
    } catch {
      // Ignore malformed or unavailable persisted position.
    }
    loadChapter(position.spineIndex, position.page);
    void measureBookPagesRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-measure the book when a layout setting changes. It must never touch the
  // reading position; the chapter reload is handled by its own effect above.
  useEffect(() => {
    if (!hasLoadedInitialRef.current) return;
    void measureBookPagesRef.current();
  }, [
    settings.writingMode,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.letterSpacing,
  ]);

  // Re-apply transform when page changes from React state
  useEffect(() => { updatePagination(); }, [currentPage, updatePagination]);

  // Resize
  useEffect(() => {
    const onResize = () => {
      updatePagination();
      void measureBookPages();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureBookPages, updatePagination]);

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
    const index = resolveSpineIndex(href);
    if (index === -1) {
      // Some books list entries that are not in the spine at all (this one has
      // a "Cover" pointing at a file the spine never includes). Silently doing
      // nothing looks like a broken menu, so say what happened.
      logDebugRef.current(`toc unresolved ${href}`);
      setTocError('Ese apartado no está disponible en este libro.');
      window.setTimeout(() => setTocError(null), 3000);
      return;
    }
    setTocError(null);
    loadChapter(index, 0);
  };

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSettingsOpen || isTocOpen || isTranslateOpen) return;
      if (isTranslationHistoryOpen) {
        if (e.key === 'Escape') setIsTranslationHistoryOpen(false);
        return;
      }
      if (isBookmarksOpen) {
        if (e.key === 'Escape') setIsBookmarksOpen(false);
        return;
      }
      const next = isRtl
        ? ['ArrowLeft', ' ', 'PageDown', 'j']
        : ['ArrowRight', ' ', 'PageDown', 'j'];
      const prev = isRtl
        ? ['ArrowRight', 'PageUp', 'k']
        : ['ArrowLeft', 'PageUp', 'k'];
      if (next.includes(e.key)) handleNextPage();
      else if (prev.includes(e.key)) handlePrevPage();
      else if (e.key === 'Escape') {
        setSelectedText('');
        setSelectionPos(null);
        selectionRangeRef.current = null;
        selectionAnnotationRef.current = null;
        selectedTextAnnotationIdRef.current = null;
        setIsSelectionUnderlined(false);
        if (imageViewerSrc) setImageViewerSrc(null);
        else if (isSettingsOpen) setIsSettingsOpen(false);
        else if (isTocOpen) setIsTocOpen(false);
        else if (isTranslateOpen) setIsTranslateOpen(false);
        else onCloseBook();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imageViewerSrc, isBookmarksOpen, isRtl, isSettingsOpen, isTocOpen, isTranslateOpen, isTranslationHistoryOpen, handleNextPage, handlePrevPage, onCloseBook]);

  useEffect(() => {
    let cancelled = false;
    let removeListener: (() => Promise<void>) | undefined;
    void CapacitorApp.addListener('backButton', () => {
      if (cancelled) return;
      if (imageViewerSrc) setImageViewerSrc(null);
      else if (isTranslationHistoryOpen) setIsTranslationHistoryOpen(false);
      else if (isBookmarksOpen) setIsBookmarksOpen(false);
      else onCloseBook();
    }).then((listener) => {
      removeListener = () => listener.remove();
    });
    return () => {
      cancelled = true;
      if (removeListener) void removeListener();
    };
  }, [imageViewerSrc, isBookmarksOpen, isTranslationHistoryOpen, onCloseBook]);

  const handleCopyDebug = async () => {
    const text = debugLines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setDebugCopied(true);
      setTimeout(() => setDebugCopied(false), 1500);
      return;
    } catch {
      // Clipboard API unavailable inside this frame; fall back below.
    }
    try {
      const scratch = document.createElement('textarea');
      scratch.value = text;
      scratch.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(scratch);
      scratch.select();
      scratch.setSelectionRange(0, text.length);
      const copied = document.execCommand('copy');
      scratch.remove();
      if (copied) {
        setDebugCopied(true);
        setTimeout(() => setDebugCopied(false), 1500);
      }
    } catch {
      // Nothing else to try without clipboard access.
    }
  };

  const closeImageViewer = () => {
    setImageViewerSrc(null);
    setImageViewerScale(1);
    setImageViewerOffset({ x: 0, y: 0 });
    imageDragRef.current = null;
  };

  const handleImagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    imageDragRef.current = {
      x: imageViewerOffset.x,
      y: imageViewerOffset.y,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const handleImagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = imageDragRef.current;
    if (!drag) return;
    setImageViewerOffset({
      x: drag.x + event.clientX - drag.startX,
      y: drag.y + event.clientY - drag.startY,
    });
  };

  const handleImagePointerUp = () => {
    imageDragRef.current = null;
  };

  const currentChapterPages = chapterPageCounts[currentSpineIndex] || totalPages;
  const globalPage = getGlobalPage(currentSpineIndex, currentPage);
  const displayChapter = getDisplayChapter(currentSpineIndex);

  const currentChapterToc = epub.toc.find(
    (item) => resolveSpineIndex(item.href) === currentSpineIndex
  );

  useLayoutEffect(() => {
    if (!showUi) {
      setReaderFit((current) =>
        current.scale === 1 && current.offsetY === 0
          ? current
          : { scale: 1, offsetY: 0 }
      );
      return;
    }

    const container = containerRef.current;
    const header = container?.querySelector<HTMLElement>('[data-reader-chrome="header"]');
    const footer = container?.querySelector<HTMLElement>('[data-reader-chrome="footer"]');
    if (!container || !header || !footer) return;

    const updateFit = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      const margin = 12;
      const headerHeight = header.getBoundingClientRect().height;
      const footerHeight = footer.getBoundingClientRect().height;
      const heightScale = (height - headerHeight - footerHeight - margin * 2) / height;
      const widthScale = (width - margin * 2) / width;
      const scale = Math.max(0.1, Math.min(1, heightScale, widthScale));
      setReaderFit({ scale, offsetY: (headerHeight - footerHeight) / 2 });
    };

    updateFit();
    const observer = new ResizeObserver(updateFit);
    observer.observe(container);
    observer.observe(header);
    observer.observe(footer);
    window.addEventListener('resize', updateFit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateFit);
    };
  }, [showUi]);

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
        onOpenBookmarks={() => setIsBookmarksOpen(true)}
        bookmarkCount={bookmarks.length}
        onOpenHistory={() => setIsTranslationHistoryOpen(true)}
        historyCount={translationHistory.length}
        onToggleSettings={() => setIsSettingsOpen(true)}
        onOpenFile={onCloseBook}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
      />

      {/* Compact progress stays available without opening the full controls. */}
      <div
        className={`fixed bottom-[max(env(safe-area-inset-bottom,0px),8px)] left-1/2 -translate-x-1/2 z-[45] rounded-full px-3 py-1 bg-black/45 text-white/90 backdrop-blur-md text-[10px] tabular-nums pointer-events-none transition-opacity ${
          showUi ? 'opacity-0' : 'opacity-100'
        }`}
        aria-live="polite"
      >
        {isBookPaginationReady && isReaderPositioned
          ? `${globalPage + 1}/${Math.max(1, bookTotalPages)} · C${displayChapter}/${displayChapterCount}`
          : isReaderPositioned
            ? 'Calculando paginación…'
            : 'Abriendo libro…'}
      </div>

      {/* Keep the toggle in the bottom chrome instead of over the text header area. */}
      <button
        onClick={() => setShowUi((visible) => !visible)}
        onContextMenu={(event) => {
          // Long-press toggles the on-screen diagnostics trace.
          event.preventDefault();
          setDebugEnabled((enabled) => !enabled);
        }}
        className={`tap-area-free fixed z-[55] p-2 rounded-full backdrop-blur-md shadow-md transition-colors ${
          showUi
            ? 'right-3 bottom-[118px]'
            : 'left-3 bottom-[max(env(safe-area-inset-bottom,8px),8px)]'
        } ${
          showUi
            ? 'bg-white/90 text-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-200'
            : 'bg-zinc-900/40 text-white/80'
        }`}
        title={showUi ? 'Ocultar menú' : 'Mostrar menú'}
        aria-label={showUi ? 'Ocultar menú' : 'Mostrar menú'}
      >
        {showUi ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
      </button>

      {!showUi && (
        <button
          type="button"
          onClick={handleToggleBookmark}
          className={`tap-area fixed right-2 z-[55] flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
            isCurrentBookmarked
              ? 'bg-amber-400/55 text-amber-950/80 dark:bg-amber-300/45 dark:text-amber-100/90'
              : 'bg-black/25 text-white/65 hover:bg-black/45 hover:text-white/90'
          }`}
          style={{
            bottom: 'max(env(safe-area-inset-bottom, 4px), 4px)',
            right: 'max(env(safe-area-inset-right, 4px), 4px)',
          }}
          title={isCurrentBookmarked ? 'Quitar marcador de esta página' : 'Marcar esta página'}
          aria-label={isCurrentBookmarked ? 'Quitar marcador de esta página' : 'Marcar esta página'}
          aria-pressed={isCurrentBookmarked}
        >
          {isCurrentBookmarked
            ? <BookmarkCheck className="h-4 w-4" />
            : <Bookmark className="h-4 w-4" />}
        </button>
      )}

      {/* Keep the viewport fixed so showing the controls never changes pagination. */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          transform: showUi
            ? `translateY(${readerFit.offsetY}px) scale(${readerFit.scale})`
            : 'none',
          transformOrigin: 'center center',
          boxShadow: showUi
            ? '0 8px 24px rgba(0, 0, 0, 0.28), 0 2px 6px rgba(0, 0, 0, 0.18)'
            : 'none',
        }}
      >
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

      {debugEnabled && (
        <div className="fixed top-2 left-2 z-[95] max-w-[78vw] rounded-lg bg-black/75 px-2 py-1.5 pointer-events-none">
          <div className="font-mono text-[9px] leading-[1.35] text-lime-200 whitespace-pre-wrap select-text">
            {debugLines.length ? debugLines.join('\n') : 'diagnóstico activo · selecciona texto…'}
          </div>
          <button
            onClick={handleCopyDebug}
            className="pointer-events-auto mt-1 rounded bg-lime-300/90 px-2 py-1 text-[10px] font-semibold text-black"
          >
            {debugCopied ? 'copiado ✓' : 'copiar log'}
          </button>
        </div>
      )}

      {tocError && (
        <div className="fixed bottom-24 left-1/2 z-[85] -translate-x-1/2 rounded-xl bg-zinc-900/90 px-4 py-2 text-xs text-white shadow-lg">
          {tocError}
        </div>
      )}

      <TextSelectionMenu
        selectedText={selectedText}
        position={selectionPos}
        // The menu sits at z-60, above the translation modal (z-50), so with a
        // panel open it covered the bottom of the dictionary result. Fold it
        // away while any overlay is on screen, as it is already folded away
        // while the selection is being dragged.
        isAdjusting={isSelectionAdjusting || isTranslateOpen || isBookmarksOpen || isTranslationHistoryOpen || isTocOpen || isSettingsOpen || Boolean(imageViewerSrc)}
        dictionaryPreview={dictionaryPreview}
        isUnderlined={isSelectionUnderlined}
        onToggleUnderline={handleToggleUnderline}
        onClose={() => {
          setSelectedText('');
          setSelectionPos(null);
          selectionRangeRef.current = null;
          selectionAnnotationRef.current = null;
          selectedTextAnnotationIdRef.current = null;
          setIsSelectionUnderlined(false);
        }}
        onOpenTranslate={() => {
          setAiTranslationProvider(undefined);
          setIsTranslateOpen(true);
        }}
        onOpenDictionary={() => {
          setAiTranslationProvider(undefined);
          setIsTranslateOpen(true);
        }}
        aiProviders={configuredAiProviders}
        onOpenAiTranslate={(provider) => {
          setAiTranslationProvider(provider);
          setIsTranslateOpen(true);
        }}
      />

      <TranslationModal
        isOpen={isTranslateOpen}
        onClose={() => setIsTranslateOpen(false)}
        selectedText={selectedText}
        aiProvider={aiTranslationProvider}
        aiApiKey={aiTranslationProvider ? settings.aiApiKeys[aiTranslationProvider] : undefined}
        availableAiProviders={configuredAiProviders}
        aiApiKeys={settings.aiApiKeys}
        onSaveHistory={handleSaveTranslationHistory}
      />

      <TranslationHistoryModal
        isOpen={isTranslationHistoryOpen}
        entries={translationHistory}
        onClose={() => setIsTranslationHistoryOpen(false)}
        onRemove={handleRemoveTranslationHistoryEntry}
        onClear={handleClearTranslationHistory}
      />

      <BookmarksModal
        isOpen={isBookmarksOpen}
        bookmarks={bookmarkItems}
        onClose={() => setIsBookmarksOpen(false)}
        onSelect={handleSelectBookmark}
        onRemove={handleRemoveBookmark}
      />

      <ReaderFooter
        isVisible={showUi}
        currentPage={currentPage}
        displayPage={globalPage}
        totalPages={bookTotalPages}
        currentChapterPage={currentPage}
        currentChapterTotalPages={currentChapterPages}
        currentSpineIndex={currentSpineIndex}
        totalSpineCount={epub.spine.length}
        displayChapter={displayChapter}
        displayChapterCount={displayChapterCount}
        direction={settings.progressionDirection}
        isVertical={isVertical}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
        onSeekPage={handleSeekPage}
        onNudgePage={handleNudgePage}
        onResetNudge={handleResetNudge}
        pageNudge={pageNudge}
        onPrevChapter={handlePrevChapter}
        onNextChapter={handleNextChapter}
        bookmarkPages={bookmarkPageMarkers}
      />

      {imageViewerSrc && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 touch-none"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeImageViewer();
          }}
          onPointerDown={handleImagePointerDown}
          onPointerMove={handleImagePointerMove}
          onPointerUp={handleImagePointerUp}
          onPointerCancel={handleImagePointerUp}
        >
          <img
            src={imageViewerSrc}
            alt="Imagen ampliada"
            draggable={false}
            className="max-w-[92vw] max-h-[82vh] select-none object-contain"
            style={{
              transform: `translate(${imageViewerOffset.x}px, ${imageViewerOffset.y}px) scale(${imageViewerScale})`,
              transformOrigin: 'center center',
            }}
          />
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-2xl bg-zinc-900/90 px-3 py-2 text-white shadow-xl">
            <button
              onClick={() => setImageViewerScale((scale) => Math.max(1, scale - 0.25))}
              className="rounded-lg p-2 hover:bg-white/10"
              aria-label="Reducir zoom"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-12 text-center text-xs">{Math.round(imageViewerScale * 100)}%</span>
            <button
              onClick={() => setImageViewerScale((scale) => Math.min(4, scale + 0.25))}
              className="rounded-lg p-2 hover:bg-white/10"
              aria-label="Aumentar zoom"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                setImageViewerScale(1);
                setImageViewerOffset({ x: 0, y: 0 });
              }}
              className="rounded-lg p-2 hover:bg-white/10"
              aria-label="Restablecer imagen"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button onClick={closeImageViewer} className="rounded-lg p-2 hover:bg-white/10" aria-label="Cerrar imagen">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

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
