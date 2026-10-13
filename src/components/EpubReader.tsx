import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { t } from '../utils/i18n';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AiProvider, PaginationMode, ParsedEpub, ReaderSettingsState } from '../types/epub';
import { formatPageDisplay, formatChapterPageDisplay } from '../utils/paginationDisplay';
import { GoogleDriveSession } from '../utils/googleDriveBackup';
import { SyncStatusBadge } from './SyncStatusBadge';
import { ReaderNavbar } from './ReaderNavbar';
import { ReaderFooter } from './ReaderFooter';
import { ReaderSettings } from './ReaderSettings';
import { ReaderToc } from './ReaderToc';
import { TextSelectionMenu, SelectionPosition } from './TextSelectionMenu';
import { TranslationModal } from './TranslationModal';
import { TranslationHistoryModal } from './TranslationHistoryModal';
import { BookmarksModal, ReaderBookmark } from './BookmarksModal';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Menu,
  Maximize2,
  Minimize2,
  X,
  Minus,
  Plus,
  RotateCcw,
  Bookmark,
  BookmarkCheck,
} from 'lucide-react';
import {
  applyTextAnnotations,
  captureTextAnnotation,
  findTextAnnotationRange,
  readTextAnnotations,
  removeTextAnnotationMarkup,
  TextAnnotation,
} from '../utils/textAnnotations';
import {
  readTranslationHistory,
  saveTranslationHistoryEntry,
  buildDictionaryHistoryResponse,
  DictionaryHistoryData,
  TranslationHistoryEntry,
  TranslationHistoryKind,
} from '../utils/translationHistory';
import {
  readTranslationFavorites,
  toggleTranslationFavorite,
  TranslationFavorite,
  TranslationFavoriteCandidate,
  writeTranslationFavorites,
} from '../utils/translationFavorites';
import {
  readFrequentQueries,
  recordFrequentQuery,
  FREQUENT_QUERIES_VERSION,
  FrequentQuery,
  writeFrequentQueries,
} from '../utils/frequentQueries';
import { ReaderBookBackup } from '../utils/googleDriveBackup';
import {
  DictionaryLookup,
  getDictionarySearchTerms,
  JapaneseMorphologicalToken,
  tokenizeJapanese,
  warmUpDictionary,
} from '../utils/dictionary';
import {
  getPageWordCategory,
  PageGlossaryModal,
  PageWordCategory,
  PageWordToken,
} from './PageGlossaryModal';
import { BookSearchModal } from './BookSearchModal';
import { setReaderFullscreen } from '../utils/readerFullscreen';
import {
  addRecentSearch,
  clearRecentSearches,
  createSearchLocator,
  extractSearchText,
  locateSearchRange,
  pageOfRange,
  readRecentSearches,
  removeRecentSearch,
  SearchHit,
  textOffsetOfPage,
} from '../utils/bookSearch';

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
        && (candidate.page as number) >= 0
        && (candidate.textOffset === undefined
          || (Number.isInteger(candidate.textOffset) && (candidate.textOffset as number) >= 0));
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

const mapPageToLayout = (page: number, savedPageCount: number | undefined, currentPageCount: number) => {
  if (!savedPageCount || savedPageCount <= 1 || currentPageCount <= 1) return page;
  const progress = Math.min(1, Math.max(0, page / (savedPageCount - 1)));
  return Math.round(progress * (currentPageCount - 1));
};

const pageWordHighlightNames: PageWordCategory[] = ['noun', 'verb', 'adjective', 'particle', 'other'];

const clearPageWordHighlights = (doc?: Document | null) => {
  const highlights = (doc?.defaultView as (Window & {
    CSS?: { highlights?: { delete(name: string): void } };
  }) | null)?.CSS?.highlights;
  pageWordHighlightNames.forEach((category) => highlights?.delete(`reader-word-${category}`));
  doc?.querySelector('[data-page-word-separators]')?.remove();
};

const applyPageWordHighlights = (
  doc: Document,
  tokens: PageWordToken[],
  vertical: boolean,
) => {
  const win = doc.defaultView as (Window & {
    Highlight?: { new (...ranges: Range[]): unknown };
    CSS?: { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } };
  }) | null;
  if (!win?.Highlight || !win.CSS?.highlights) return;
  const highlights = win.CSS.highlights;
  const HighlightConstructor = win.Highlight;

  const rangesByCategory = new Map<PageWordCategory, Range[]>();
  tokens.forEach((token) => {
    const category = getPageWordCategory(token);
    const ranges = rangesByCategory.get(category) || [];
    ranges.push(token.range);
    rangesByCategory.set(category, ranges);
  });

  pageWordHighlightNames.forEach((category) => {
    const ranges = rangesByCategory.get(category) || [];
    if (ranges.length === 0) {
      highlights.delete(`reader-word-${category}`);
      return;
    }
    highlights.set(`reader-word-${category}`, new HighlightConstructor(...ranges));
  });

  const scroller = doc.getElementById('reader-scroller');
  if (!scroller) return;
  const scrollerRect = scroller.getBoundingClientRect();

  const previousSeparators = doc.querySelector('[data-page-word-separators]');
  previousSeparators?.remove();
  const separatorLayer = doc.createElement('div');
  separatorLayer.setAttribute('data-page-word-separators', '');
  separatorLayer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 5; margin: 0; padding: 0; box-sizing: border-box;';
  const separatorColors: Record<PageWordCategory, string> = {
    noun: 'rgba(14,116,144,0.45)',
    verb: 'rgba(180,83,9,0.45)',
    adjective: 'rgba(4,120,87,0.45)',
    particle: 'rgba(109,40,217,0.42)',
    other: 'rgba(82,82,91,0.4)',
  };
  tokens.forEach((token) => {
    const rects = Array.from(token.range.getClientRects());
    const rect = rects[rects.length - 1];
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const separator = doc.createElement('span');
    const color = separatorColors[getPageWordCategory(token)];
    const localLeft = rect.left - scrollerRect.left;
    const localTop = rect.top - scrollerRect.top;
    separator.style.cssText = vertical
      ? `position: absolute; left: ${localLeft}px; top: ${localTop + rect.height - 1}px; width: ${rect.width}px; height: 1px; box-shadow: 0 1px 2px ${color};`
      : `position: absolute; left: ${localLeft + rect.width - 1}px; top: ${localTop}px; width: 1px; height: ${rect.height}px; box-shadow: 1px 0 2px ${color};`;
    separatorLayer.appendChild(separator);
  });
  scroller.appendChild(separatorLayer);
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

// Force common Japanese ellipsis, exclamation and question marks upright in
// vertical writing. Shared by the live reader and the hidden frame that finds
// where a search hit falls, so both lay out exactly the same DOM.
const wrapVerticalPunctuation = (doc: Document) => {
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
  selectedTheme: ReaderSettingsState['theme'];
  onUpdateSettings: (newSettings: Partial<ReaderSettingsState>) => void;
  onBookDataChange?: (data: ReaderBookBackup) => void;
  googleDriveSession?: GoogleDriveSession | null;
  isDriveBusy?: boolean;
  syncError?: string | null;
  onRetry?: () => void;
  lastSyncedDate?: string | null;
  isBookUploaded?: boolean;
  onUploadBook?: () => void;
}

export const EpubReader: React.FC<Props> = ({
  epub,
  onCloseBook,
  settings,
  selectedTheme,
  onUpdateSettings,
  onBookDataChange,
  googleDriveSession,
  isDriveBusy,
  syncError,
  onRetry,
  lastSyncedDate,
  isBookUploaded = true,
  onUploadBook,
}) => {
  const [currentSpineIndex, setCurrentSpineIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [bookTotalPages, setBookTotalPages] = useState(1);
  const [chapterPageCounts, setChapterPageCounts] = useState<number[]>([]);
  const [isBookPaginationReady, setIsBookPaginationReady] = useState(false);
  // The global page number is offset(spineIndex) + page, so it is only
  // meaningful once the reader has actually been placed on its chapter.
  const [isReaderPositioned, setIsReaderPositioned] = useState(false);
  const [isLoadingChapter, setIsLoadingChapter] = useState(true);
  const [showUi, setShowUi] = useState(false);
  const [selectionEdgeIndicator, setSelectionEdgeIndicator] = useState<{
    direction: 'next' | 'previous';
    x: number;
    y: number;
  } | null>(null);
  const [selectionEdgeActivation, setSelectionEdgeActivation] = useState<{
    direction: 'next' | 'previous';
    progress: number;
  } | null>(null);
  const [readerFit, setReaderFit] = useState({ scale: 1, offsetY: 0 });
  const [isReaderFullscreen, setIsReaderFullscreen] = useState(false);
  const [fullscreenFrameSize, setFullscreenFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const isReaderFullscreenRef = useRef(false);
  const fullscreenExitTimerRef = useRef<number | undefined>(undefined);
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(false);
  const [isPageGlossaryOpen, setIsPageGlossaryOpen] = useState(false);
  const [pageWords, setPageWords] = useState<PageWordToken[]>([]);
  const [isAnalyzingPage, setIsAnalyzingPage] = useState(false);
  const [isWordSelectionMode, setIsWordSelectionMode] = useState(false);
  const [wordAnalysisError, setWordAnalysisError] = useState<string | null>(null);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [tocError, setTocError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const bookStorageKey = `ereader_book_${encodeURIComponent(`${epub.metadata.title}|${epub.metadata.creator}`)}`;
  const recentSearchesStorageKey = `${bookStorageKey}_recent_searches`;
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchSeed, setSearchSeed] = useState({ text: '', token: 0 });
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    readRecentSearches(recentSearchesStorageKey)
  );
  // Searchable text of each chapter, filled on demand and kept while the book is open.
  const chapterSearchTextRef = useRef<Map<number, Promise<string>>>(new Map());
  const searchHighlightTimerRef = useRef<number | undefined>(undefined);
  const translationHistoryStorageKey = `${bookStorageKey}_translation_history`;
  const frequentQueriesStorageKey = `${bookStorageKey}_frequent_queries`;
  const [translationHistory, setTranslationHistory] = useState<TranslationHistoryEntry[]>(() =>
    readTranslationHistory(translationHistoryStorageKey)
  );
  const translationHistoryRef = useRef(translationHistory);
  const [frequentQueries, setFrequentQueries] = useState<FrequentQuery[]>(() =>
    readFrequentQueries(frequentQueriesStorageKey)
  );
  const frequentQueriesRef = useRef(frequentQueries);
  const translationFavoritesStorageKey = `${bookStorageKey}_translation_favorites`;
  const [translationFavorites, setTranslationFavorites] = useState<TranslationFavorite[]>(() =>
    readTranslationFavorites(translationFavoritesStorageKey)
  );
  const translationFavoritesRef = useRef(translationFavorites);
  const annotationsStorageKey = `${bookStorageKey}_annotations`;
  const textAnnotationsRef = useRef<TextAnnotation[]>([]);
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>(() => {
    const stored = readTextAnnotations(annotationsStorageKey);
    textAnnotationsRef.current = stored;
    return stored;
  });
  const [annotationPages, setAnnotationPages] = useState<Map<string, { page: number; pageCount: number } | null>>(
    () => new Map()
  );
  const [bookmarks, setBookmarks] = useState<ReadingPosition[]>(() =>
    readBookmarks(`${bookStorageKey}_bookmark`, epub.spine.length)
  );

  const [selectedText, setSelectedText] = useState('');
  const [frequentSearchToken, setFrequentSearchToken] = useState(0);
  const recordedFrequentSearchTokensRef = useRef(new Set<string>());
  const [dictionaryPreview, setDictionaryPreview] = useState<DictionaryLookup | null>(null);
  const [isSelectionUnderlined, setIsSelectionUnderlined] = useState(false);
  const [isSelectionAdjusting, setIsSelectionAdjusting] = useState(false);
  const selectionSettleRef = useRef<number | undefined>(undefined);
  // Set from the iframe's pointer events: the menu must wait for the finger to
  // leave the screen, not merely for the selection to pause.
  const pointerActiveRef = useRef(false);
  // Once a long-press turns into a native selection the browser cancels the
  // pointer and the handle drags no longer reach the document as touchend or
  // pointerup. From then on the release can only be inferred from silence, so
  // these track whether the native selection took over and when we last saw
  // the finger (or the selection) move.
  const nativeSelectionTookOverRef = useRef(false);
  const lastPointerActivityRef = useRef(0);
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
  const positionLocatorRef = useRef<{
    spineIndex: number;
    doc: Document;
    locator: ReturnType<typeof createSearchLocator>;
  } | null>(null);
  const measurementVersionRef = useRef(0);
  const shownPageRef = useRef<{ spine: number; page: number } | null>(null);
  const imageDragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const selectedTextRef = useRef('');
  const pageWordsRef = useRef<PageWordToken[]>([]);
  const wordSelectionModeRef = useRef(false);
  const previousAutoAnalyzePageRef = useRef(settings.autoAnalyzePage);
  const programmaticWordSelectionRef = useRef(false);
  const pageAnalysisRequestRef = useRef(0);
  const automaticPageAnalysisRequestRef = useRef(0);
  const wordAnalysisErrorTimerRef = useRef<number | undefined>(undefined);
  const showWordAnalysisError = useCallback((message: string) => {
    setWordAnalysisError(message);
    if (wordAnalysisErrorTimerRef.current !== undefined) {
      window.clearTimeout(wordAnalysisErrorTimerRef.current);
    }
    wordAnalysisErrorTimerRef.current = window.setTimeout(() => {
      setWordAnalysisError(null);
      wordAnalysisErrorTimerRef.current = undefined;
    }, 4500);
  }, []);
  const backupDirtyRef = useRef(false);
  const pendingReaderBackupRef = useRef<ReaderBookBackup | null>(null);
  const onBookDataChangeRef = useRef(onBookDataChange);
  onBookDataChangeRef.current = onBookDataChange;
  const selectionRangeRef = useRef<Range | null>(null);
  const handleSelectionRef = useRef<() => void>(() => {});
  const nativeTouchPositionRef = useRef<{ x: number; y: number } | null>(null);
  const selectionEdgeIndicatorRef = useRef<typeof selectionEdgeIndicator>(null);
  const selectionEdgeTurnRef = useRef<(direction: 'next' | 'previous') => void>(() => {});
  const selectionEdgeClearRef = useRef<() => void>(() => {});
  const startEdgeActivationRef = useRef<(direction: 'next' | 'previous') => void>(() => {});
  const cancelEdgeActivationRef = useRef<() => void>(() => {});
  const lastPageTurnTimeRef = useRef(0);
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
  const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  const [printedPages, setPrintedPages] = useState<number | undefined>(() => {
    try {
      const stored = localStorage.getItem(`${bookStorageKey}_printed_pages`);
      const val = stored ? Number(stored) : NaN;
      return !isNaN(val) && val > 0 ? val : undefined;
    } catch {
      return undefined;
    }
  });

  const handleUpdatePrintedPages = useCallback((pages: number | undefined) => {
    setPrintedPages(pages);
    try {
      if (pages && pages > 0) {
        localStorage.setItem(`${bookStorageKey}_printed_pages`, String(pages));
      } else {
        localStorage.removeItem(`${bookStorageKey}_printed_pages`);
      }
    } catch {
      // ignore
    }
  }, [bookStorageKey]);

  const handleTogglePaginationMode = useCallback(() => {
    const nextMode: PaginationMode =
      settings.paginationMode === 'device'
        ? 'printed'
        : settings.paginationMode === 'printed'
        ? 'percent'
        : 'device';
    onUpdateSettings({ paginationMode: nextMode });
  }, [onUpdateSettings, settings.paginationMode]);
  const configuredAiProviders = useMemo(
    () => (['gemini', 'openai', 'deepseek', 'openrouter'] as AiProvider[]).filter(
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

  const getPositionLocator = useCallback((spineIndex: number, doc: Document, scroller: HTMLElement) => {
    const cached = positionLocatorRef.current;
    if (cached?.spineIndex === spineIndex && cached.doc === doc) return cached.locator;
    const locator = createSearchLocator(scroller, doc);
    positionLocatorRef.current = { spineIndex, doc, locator };
    return locator;
  }, []);

  const getTextOffsetForPage = useCallback((spineIndex: number, page: number) => {
    if (currentSpineRef.current !== spineIndex) return undefined;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const scroller = doc?.getElementById('reader-scroller');
    if (!iframe || !doc || !scroller) return undefined;
    return textOffsetOfPage(
      scroller,
      doc,
      page,
      scroller,
      isVertical,
      iframe.clientWidth || window.innerWidth,
      iframe.clientHeight || window.innerHeight,
      getPositionLocator(spineIndex, doc, scroller),
    ) ?? undefined;
  }, [getPositionLocator, isVertical]);

  const getPageForTextOffset = useCallback((spineIndex: number, textOffset: number) => {
    if (currentSpineRef.current !== spineIndex) return null;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const scroller = doc?.getElementById('reader-scroller');
    if (!iframe || !doc || !scroller) return null;
    const range = getPositionLocator(spineIndex, doc, scroller).locate(textOffset, 1);
    if (!range) return null;
    return pageOfRange(
      range,
      scroller,
      isVertical,
      iframe.clientWidth || window.innerWidth,
      iframe.clientHeight || window.innerHeight,
    );
  }, [getPositionLocator, isVertical]);

  const saveReadingPosition = useCallback((position: ReadingPosition) => {
    try {
      localStorage.setItem(`${bookStorageKey}_position`, JSON.stringify(position));
    } catch {
      // Persistence is optional when storage is unavailable.
    }
  }, [bookStorageKey]);

  const markReaderDataChanged = useCallback(() => {
    backupDirtyRef.current = true;
  }, []);

  const handleRecordFrequentQuery = useCallback((query: string, searchToken: string | number) => {
    const token = String(searchToken);
    if (recordedFrequentSearchTokensRef.current.has(token)) return;
    recordedFrequentSearchTokensRef.current.add(token);
    if (recordedFrequentSearchTokensRef.current.size > 500) {
      const oldestToken = recordedFrequentSearchTokensRef.current.values().next().value;
      if (oldestToken !== undefined) recordedFrequentSearchTokensRef.current.delete(oldestToken);
    }
    const next = recordFrequentQuery(
      frequentQueriesStorageKey,
      frequentQueriesRef.current,
      query,
    );
    if (next === frequentQueriesRef.current) return;
    frequentQueriesRef.current = next;
    setFrequentQueries(next);
    markReaderDataChanged();
  }, [frequentQueriesStorageKey, markReaderDataChanged]);

  const handleClearFrequentQueries = useCallback(() => {
    frequentQueriesRef.current = [];
    setFrequentQueries([]);
    writeFrequentQueries(frequentQueriesStorageKey, []);
    markReaderDataChanged();
  }, [frequentQueriesStorageKey, markReaderDataChanged]);

  const handleSaveTranslationHistory = useCallback((
    kind: TranslationHistoryKind,
    query: string,
    response: string,
    provider?: AiProvider,
    data?: DictionaryHistoryData,
  ) => {
    const previousId = translationHistoryRef.current[0]?.id;
    const next = saveTranslationHistoryEntry(
      translationHistoryStorageKey,
      translationHistoryRef.current,
      {
        kind,
        query,
        response,
        ...(kind === 'ai' && provider ? { provider } : {}),
        ...(data ? { data } : {}),
      }
    );
    translationHistoryRef.current = next;
    setTranslationHistory(next);
    if (next[0]?.id && next[0].id !== previousId) markReaderDataChanged();
  }, [markReaderDataChanged, translationHistoryStorageKey]);

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
    markReaderDataChanged();
  }, [markReaderDataChanged, translationHistoryStorageKey]);

  const handleClearTranslationHistory = useCallback(() => {
    translationHistoryRef.current = [];
    setTranslationHistory([]);
    try {
      localStorage.removeItem(translationHistoryStorageKey);
    } catch {
      // Keep the in-memory history available when storage is unavailable.
    }
    markReaderDataChanged();
  }, [markReaderDataChanged, translationHistoryStorageKey]);

  const handleToggleTranslationFavorite = useCallback((
    candidate: TranslationFavoriteCandidate,
  ) => {
    const next = toggleTranslationFavorite(
      translationFavoritesStorageKey,
      translationFavoritesRef.current,
      candidate,
    );
    translationFavoritesRef.current = next;
    setTranslationFavorites(next);
    markReaderDataChanged();
  }, [markReaderDataChanged, translationFavoritesStorageKey]);

  const handleClearTranslationFavorites = useCallback(() => {
    translationFavoritesRef.current = [];
    setTranslationFavorites([]);
    writeTranslationFavorites(translationFavoritesStorageKey, []);
    markReaderDataChanged();
  }, [markReaderDataChanged, translationFavoritesStorageKey]);

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
    const iframe = iframeRef.current;
    const scroller = iframe?.contentDocument?.getElementById('reader-scroller');
    if (scroller) {
      positionLocatorRef.current = null;
      applyTextAnnotations(
        scroller,
        textAnnotations.filter((annotation) => annotation.spineIndex === currentSpineRef.current)
      );
    }
  }, [annotationsStorageKey, textAnnotations]);

  const isCurrentBookmarked = bookmarks.some((item) =>
    item.spineIndex === currentSpineIndex
      && mapPageToLayout(item.page, item.pageCount, totalPagesRef.current) === currentPage
  );

  const handleToggleBookmark = useCallback(() => {
    markReaderDataChanged();
    const currentPosition = {
      spineIndex: currentSpineRef.current,
      page: currentPageRef.current,
      pageCount: Math.max(1, totalPagesRef.current),
      textOffset: getTextOffsetForPage(currentSpineRef.current, currentPageRef.current),
    };
    setBookmarks((existing) => {
      const alreadySaved = existing.some((item) =>
        item.spineIndex === currentPosition.spineIndex
        && mapPageToLayout(item.page, item.pageCount, currentPosition.pageCount) === currentPosition.page
      );
      return alreadySaved
        ? existing.filter((item) =>
          item.spineIndex !== currentPosition.spineIndex
          || mapPageToLayout(item.page, item.pageCount, currentPosition.pageCount) !== currentPosition.page
        )
        : [...existing, currentPosition].sort((a, b) =>
          a.spineIndex - b.spineIndex || a.page - b.page
        );
    });
  }, [getTextOffsetForPage, markReaderDataChanged]);

  const handleRemoveBookmark = useCallback((position: ReadingPosition) => {
    markReaderDataChanged();
    const currentCount = chapterPageCountsRef.current[position.spineIndex] || position.pageCount || 1;
    const targetPage = position.page;
    setBookmarks((existing) => existing.filter((item) => {
      if (item.spineIndex !== position.spineIndex) return true;
      const currentPage = mapPageToLayout(item.page, item.pageCount, currentCount);
      return currentPage !== targetPage
        && item.page !== position.originalPage;
    }));
  }, [markReaderDataChanged]);

  const handleRemoveTextAnnotation = useCallback((annotation: TextAnnotation) => {
    markReaderDataChanged();
    const next = textAnnotationsRef.current.filter((item) => item.id !== annotation.id);
    textAnnotationsRef.current = next;
    setTextAnnotations(next);
  }, [markReaderDataChanged]);

  const themeColors = useMemo(() => ({
    light: { bg: '#ffffff', text: '#18181b' },
    paper: { bg: '#faf7f0', text: '#2c2825' },
    sepia: { bg: '#f4ede4', text: '#433428' },
    dark: { bg: '#18181b', text: '#e4e4e7' },
  }[settings.theme]), [settings.theme]);

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
    
    // Move furigana text into a data attribute to render it via CSS ::after.
    // This makes it completely invisible to the native text selection engine,
    // solving both the "empty selection" bug and the interleaved text copy issues
    // without needing fragile user-select workarounds.
    const rts = parsed.querySelectorAll('rt');
    rts.forEach((rt) => {
      const text = rt.textContent;
      if (text) {
        rt.setAttribute('data-rt', text);
        rt.textContent = '';
      }
    });

    const bodyContent = parsed.body.innerHTML;
    const fontCss = getFontFamilyCss(settings.fontFamily);
    const mobile = window.innerWidth < 640;
    const sidePad = mobile ? 16 : 44;
    // Keep only a small permanent margin. The outer reader viewport
    // reserves the larger header/footer areas only while the UI is open.
    const pageColumnWidth = `calc(100vw - ${sidePad * 2}px)`;
    const pageColumnGap = `${sidePad * 2}px`;
    const padTop = isVertical ? (mobile ? 18 : 32) : (mobile ? 18 : 32);
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
    const fontSize = settings.fontSize;

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
    ${isVertical ? `
    #reader-scroller > *:not([data-page-word-separators]) {
      padding-top: ${padTop}px;
      padding-bottom: ${padBottom}px;
      margin-top: -${padTop}px;
      margin-bottom: -${padBottom}px;
    }
    ` : ''}
    ::selection { background: #818cf8; color: #fff; }
    #reader-scroller { text-shadow: 0 0 0.35px currentColor; }
    img, svg { max-height: ${imgMaxH}; max-width: ${imgMaxW}; object-fit: contain;
      break-inside: avoid-column; page-break-inside: avoid;
      margin: 0.4rem auto; display: inline-block; vertical-align: top; }
    .vertical-punctuation {
      text-orientation: upright; -webkit-text-orientation: upright;
      display: inline-block; line-height: 1;
    }
    ::highlight(reader-annotation) {
      background-color: rgba(129, 140, 248, 0.35);
      color: inherit;
    }
    ::highlight(reader-word-noun) { background-color: rgba(56, 189, 248, 0.20); color: inherit; }
    ::highlight(reader-word-verb) { background-color: rgba(251, 191, 36, 0.22); color: inherit; }
    ::highlight(reader-word-adjective) { background-color: rgba(52, 211, 153, 0.20); color: inherit; }
    ::highlight(reader-word-particle) { background-color: rgba(167, 139, 250, 0.18); color: inherit; }
    ::highlight(reader-word-other) { background-color: rgba(161, 161, 170, 0.16); color: inherit; }
    p  { margin: 0; padding: ${isVertical ? '0 0 0 0.5rem' : '0 0 0.5rem 0'}; }
    h1,h2,h3,h4 { font-weight:700; break-after:avoid; }
    ruby {
      break-inside: avoid;
      page-break-inside: avoid;
      -webkit-column-break-inside: avoid;
      unicode-bidi: isolate;
    }
    ruby rt {
      font-size: 0.52em;
      line-height: 1;
      opacity: 0.85;
      font-weight: 400;
      pointer-events: none;
    }
    #reader-scroller.hide-furigana ruby rt {
      visibility: hidden;
    }
    ruby rt::after {
      content: attr(data-rt);
    }
    ::highlight(reader-annotation) rt {
      background-color: transparent !important;
      color: inherit;
    }
    .tate-chu-yoko, [class*="tcy"], [class*="tate-ch"] {
      text-combine-upright: all; -webkit-text-combine: horizontal; }
    a { color: inherit; text-decoration: none; }
  </style>
</head>
<body>
  <div id="reader-viewport">
    <div id="reader-scroller" class="${settings.showFurigana ? '' : 'hide-furigana'}">${bodyContent}</div>
  </div>
</body>
</html>`;
    return { html, sidePad, fontSize, padTop };
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
        positionLocatorRef.current = null;
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
    const anchor = scroller && !pointerActiveRef.current
      ? captureTextAnnotation(range, scroller, currentSpineRef.current)
      : null;
    if (!pointerActiveRef.current) {
      selectionRangeRef.current = range.cloneRange();
      selectionAnnotationRef.current = anchor;
    }
    const selectedTextStr = sel.toString().trim();
    const currentSpine = currentSpineRef.current;
    const matchingAnnotation = anchor && textAnnotationsRef.current.find((annotation) =>
      annotation.spineIndex === currentSpine &&
      (
        (annotation.quote === anchor.quote && annotation.prefix === anchor.prefix) ||
        annotation.quote.includes(selectedTextStr) ||
        selectedTextStr.includes(annotation.quote)
      )
    );
    const annotationId = matchingAnnotation?.id || null;
    selectedTextAnnotationIdRef.current = annotationId || null;
    setIsSelectionUnderlined(Boolean(annotationId));

    const text = sel.toString().trim();
    const rect = range.getBoundingClientRect();
    const iRect = iframe.getBoundingClientRect();
    if (selectedTextRef.current !== text) {
      setFrequentSearchToken((token) => token + 1);
    }
    selectedTextRef.current = text;

    lastSelectionTime.current = Date.now();
    // Fold the menu away while the selection is being made, and only bring it
    // back once the finger is off the screen and the selection has settled.
    // A time-only rule revealed the menu in the pause between the long-press
    // and grabbing a handle, which is exactly when it gets in the way.
    // Dragging a native handle produces selection changes but no pointerdown,
    // so a change while the native selection owns the pointer means the finger
    // is on screen again, even if a previous silence had marked it released.
    if (nativeSelectionTookOverRef.current && !isNativeAndroid) {
      pointerActiveRef.current = true;
    }
    if (!isNativeAndroid || pointerActiveRef.current) {
      setIsSelectionAdjusting(true);
    }
    if (selectionSettleRef.current !== undefined) window.clearTimeout(selectionSettleRef.current);
    lastPointerActivityRef.current = Date.now();
    const revealWhenReleased = () => {
      if (!pointerActiveRef.current) {
        logDebugRef.current('selection menu revealed after release');
        setIsSelectionAdjusting(false);
        return;
      }
      if (isNativeAndroid) return;
      const releaseFallbackSilence = 1500;
      if (Date.now() - lastPointerActivityRef.current >= releaseFallbackSilence) {
        logDebugRef.current('selection menu revealed after web fallback');
        pointerActiveRef.current = false;
        setIsSelectionAdjusting(false);
        return;
      }
      selectionSettleRef.current = window.setTimeout(revealWhenReleased, 50);
    };
    logDebugRef.current('selection menu waiting for release');
    if (!isNativeAndroid) {
      selectionSettleRef.current = window.setTimeout(revealWhenReleased, 50);
    }
    setSelectedText(text);
    setSelectionPos({
      x: iRect.left + rect.left,
      y: iRect.top + rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, [isNativeAndroid]);

  handleSelectionRef.current = handleSelection;

  const selectPageWord = useCallback((token: PageWordToken) => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const scroller = doc?.getElementById('reader-scroller');
    const selection = iframe?.contentWindow?.getSelection();
    if (
      !iframe ||
      !doc ||
      !scroller ||
      !selection ||
      !scroller.contains(token.range.startContainer) ||
      !scroller.contains(token.range.endContainer)
    ) return false;

    try {
      const range = token.range.cloneRange();
      setIsPageGlossaryOpen(false);
      setIsSelectionAdjusting(false);
      pointerActiveRef.current = false;
      nativeSelectionTookOverRef.current = false;
      selectedTextRef.current = '';
      setSelectedText('');
      setSelectionPos(null);
      setIsSelectionUnderlined(false);
      programmaticWordSelectionRef.current = true;
      selection.removeAllRanges();
      selection.addRange(range);
      handleSelectionRef.current();
      window.setTimeout(() => {
        programmaticWordSelectionRef.current = false;
      }, 500);
      return true;
    } catch {
      showWordAnalysisError(t('reader.selectWordError', settings.language));
      return false;
    }
  }, [showWordAnalysisError]);

  const handleToggleUnderline = useCallback(() => {
    const anchor = selectionAnnotationRef.current;
    const iframe = iframeRef.current;
    const scroller = iframe?.contentDocument?.getElementById('reader-scroller');
    if (!scroller) return;

    const selectedTextStr = iframe?.contentWindow?.getSelection()?.toString().trim() || '';
    const currentSpine = currentSpineRef.current;

    const existing = textAnnotationsRef.current.find((annotation) =>
      annotation.spineIndex === currentSpine &&
      (
        annotation.id === selectedTextAnnotationIdRef.current ||
        (anchor && annotation.quote === anchor.quote && annotation.prefix === anchor.prefix) ||
        (selectedTextStr && (annotation.quote.includes(selectedTextStr) || selectedTextStr.includes(annotation.quote)))
      )
    );

    if (existing) {
      removeTextAnnotationMarkup(scroller, existing.id);
      markReaderDataChanged();
      const next = textAnnotationsRef.current.filter((annotation) => annotation.id !== existing.id);
      textAnnotationsRef.current = next;
      setTextAnnotations(next);
      selectedTextAnnotationIdRef.current = null;
      setIsSelectionUnderlined(false);
      return;
    }

    if (!anchor) return;
    const range = selectionRangeRef.current;
    if (!range || range.startContainer.ownerDocument !== scroller.ownerDocument) return;
    const annotation: TextAnnotation = {
      ...anchor,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    };
    markReaderDataChanged();
    const next = [...textAnnotationsRef.current, annotation];
    textAnnotationsRef.current = next;
    setTextAnnotations(next);
    selectedTextAnnotationIdRef.current = annotation.id;
    setIsSelectionUnderlined(true);
  }, [markReaderDataChanged]);

  // ─── PAGE ACTIONS ─────────────────────────────────────────────────────────────
  // We use refs so that callbacks registered inside the iframe closure stay fresh.
  const doNextPage = useCallback(() => {
    markReaderDataChanged();
    const page = currentPageRef.current;
    const spine = currentSpineRef.current;
    const pages = totalPagesRef.current;

    if (page < pages - 1) {
      pageNudgeRef.current = 0;
      currentPageRef.current = page + 1;
      saveReadingPosition({
        spineIndex: spine,
        page: page + 1,
        pageCount: pages,
        textOffset: getTextOffsetForPage(spine, page + 1),
      });
      setCurrentPage(page + 1);
      updatePagination();
    } else if (spine < epub.spine.length - 1) {
      loadChapter(spine + 1, 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    epub.spine.length,
    getTextOffsetForPage,
    markReaderDataChanged,
    saveReadingPosition,
    updatePagination,
  ]);

  const doPrevPage = useCallback(() => {
    markReaderDataChanged();
    const page = currentPageRef.current;
    const spine = currentSpineRef.current;

    if (page > 0) {
      pageNudgeRef.current = 0;
      currentPageRef.current = page - 1;
      saveReadingPosition({
        spineIndex: spine,
        page: page - 1,
        pageCount: totalPagesRef.current,
        textOffset: getTextOffsetForPage(spine, page - 1),
      });
      setCurrentPage(page - 1);
      updatePagination();
    } else if (spine > 0) {
      // Going back from the first page opens the end of the previous chapter,
      // not its first page.
      loadChapter(spine - 1, -1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    getTextOffsetForPage,
    markReaderDataChanged,
    saveReadingPosition,
    updatePagination,
  ]);

  const doNextRef = useRef(doNextPage);
  const doPrevRef = useRef(doPrevPage);
  useEffect(() => { doNextRef.current = doNextPage; }, [doNextPage]);
  useEffect(() => { doPrevRef.current = doPrevPage; }, [doPrevPage]);
  useEffect(() => {
    let nativeTouchActive = false;
    let nativeTouchIsSelection = false;
    let edgeActivation: {
      direction: 'next' | 'previous';
      startedAt: number;
      interval: number;
    } | null = null;

    const cancelEdgeActivation = () => {
      if (!edgeActivation) return;
      window.clearInterval(edgeActivation.interval);
      edgeActivation = null;
      setSelectionEdgeActivation(null);
    };

    const startEdgeActivation = (direction: 'next' | 'previous') => {
      if (edgeActivation?.direction === direction) return;
      cancelEdgeActivation();
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const progress = Math.min(1, (Date.now() - startedAt) / 2000);
        setSelectionEdgeActivation({ direction, progress });
        if (progress < 1) return;
        window.clearInterval(interval);
        edgeActivation = null;
        setSelectionEdgeActivation(null);
        logDebugRef.current(`edge activated ${direction}`);
        selectionEdgeTurnRef.current(direction);
      }, 40);
      edgeActivation = { direction, startedAt, interval };
      setSelectionEdgeActivation({ direction, progress: 0 });
    };

    startEdgeActivationRef.current = startEdgeActivation;
    cancelEdgeActivationRef.current = cancelEdgeActivation;

    const onNativeTouchTrace = (event: Event) => {
      const { action, x, y, inside } = (event as CustomEvent<{
        action: string;
        x: number;
        y: number;
        inside: boolean;
      }>).detail;
      nativeTouchPositionRef.current = { x, y };

      if (action === 'DOWN') {
        cancelEdgeActivation();
        nativeTouchActive = true;
        const selectionMenuTarget = document.elementFromPoint(x, y)?.closest('[data-selection-menu]');
        const iframeRect = iframeRef.current?.getBoundingClientRect();
        const startsInsideReader = Boolean(
          iframeRect &&
          x >= iframeRect.left &&
          x <= iframeRect.right &&
          y >= iframeRect.top &&
          y <= iframeRect.bottom
        );
        nativeTouchIsSelection = !selectionMenuTarget &&
          (startsInsideReader || Boolean(selectedTextRef.current));
        pointerActiveRef.current = true;
        if (nativeTouchIsSelection && selectionSettleRef.current !== undefined) {
          window.clearTimeout(selectionSettleRef.current);
          selectionSettleRef.current = undefined;
        }
        if (nativeTouchIsSelection) setIsSelectionAdjusting(true);
        return;
      }
      if (action === 'UP') {
        cancelEdgeActivation();
        nativeTouchActive = false;
        pointerActiveRef.current = false;
        nativeSelectionTookOverRef.current = false;
        selectionEdgeClearRef.current();
        if (nativeTouchIsSelection) {
          window.setTimeout(() => {
            handleSelectionRef.current();
            setIsSelectionAdjusting(false);
            if (selectedTextRef.current) {
              logDebugRef.current('selection menu revealed after native up');
            }
          }, 0);
        }
        nativeTouchIsSelection = false;
        return;
      }
      if (action === 'CANCEL') {
        cancelEdgeActivation();
        nativeSelectionTookOverRef.current = true;
        return;
      }
      if (action !== 'MOVE' || !nativeTouchActive || !nativeTouchIsSelection) return;
      if (!inside || !selectedTextRef.current) {
        cancelEdgeActivation();
        return;
      }
    };

    const handleWindowContextMenu = () => {
      cancelEdgeActivation();
      selectionEdgeClearRef.current();
    };

    window.addEventListener('ereader-native-touch', onNativeTouchTrace);
    window.addEventListener('contextmenu', handleWindowContextMenu, { capture: true });
    return () => {
      cancelEdgeActivation();
      startEdgeActivationRef.current = () => {};
      cancelEdgeActivationRef.current = () => {};
      window.removeEventListener('ereader-native-touch', onNativeTouchTrace);
      window.removeEventListener('contextmenu', handleWindowContextMenu, { capture: true });
    };
  }, []);
  // ─── LOAD CHAPTER ─────────────────────────────────────────────────────────────
  const loadChapter = useCallback(
    async (
      spineIndex: number,
      targetPage = 0,
      targetPageCount?: number,
      targetTextOffset?: number,
    ) => {
      if (spineIndex < 0 || spineIndex >= epub.spine.length) return;
      selectionEdgeIndicatorRef.current = null;
      setSelectionEdgeIndicator(null);
      setIsLoadingChapter(true);
      selectedTextRef.current = '';
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

        const { html: fullHtml, padTop } = buildChapterDocument(rawHtml);

        doc.open();
        doc.write(fullHtml);
        doc.close();

        if (isVertical) wrapVerticalPunctuation(doc);

        const scroller = doc.getElementById('reader-scroller');
        if (scroller) {
          applyTextAnnotations(
            scroller,
            textAnnotationsRef.current.filter((annotation) => annotation.spineIndex === spineIndex)
          );
        }

        // ── Gesture & tap handlers attached inside the iframe ──
        const gestureAdjustmentEnabled = true;
        const vw = iframe.clientWidth || window.innerWidth;
        const vh = iframe.clientHeight || window.innerHeight;
        const nudgeLimit = vw;
        const pageSwipeThreshold = 96;
        const threshold = Math.max(pageSwipeThreshold, vw * 0.22);

        let sx = 0, sy = 0, st = 0, moved = false, selecting = false;
        let lastTouchEndAt = 0;
        let gestureNudgeStart = 0;
        let selectionStringAtStart = '';
        let selectionOrOverlayAtStart = false;

        const clearSelectionEdgeIndicator = () => {
          selectionEdgeIndicatorRef.current = null;
          setSelectionEdgeIndicator(null);
          cancelEdgeActivationRef.current();
        };
        selectionEdgeClearRef.current = clearSelectionEdgeIndicator;
        let activeSelectionEdge: { node: Node; offset: number; selectedForward: boolean } | null = null;
        let lastSelectionEndpoints: {
          startNode: Node | null;
          startOffset: number;
          endNode: Node | null;
          endOffset: number;
        } | null = null;
        const selectionTextWalker = doc.createTreeWalker(
          doc.getElementById('reader-scroller') || doc.body,
          NodeFilter.SHOW_TEXT,
          {
          acceptNode: (candidate) =>
            (candidate.nodeValue || '').trim() && !(candidate.parentElement?.closest('rt'))
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT,
          },
        );
        const getAdjacentCharRect = (node: Node | null, offset: number, forward: boolean) => {
          const scroller = doc.getElementById('reader-scroller');
          if (!node || node.nodeType !== Node.TEXT_NODE || !scroller?.contains(node)) return null;
          selectionTextWalker.currentNode = node;
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
            cursor = forward ? selectionTextWalker.nextNode() : selectionTextWalker.previousNode();
            if (!cursor) return null;
            index = forward ? 0 : (cursor.nodeValue || '').length - 1;
          }
          return null;
        };
        const getSelectionEdgeDirection = (): 'next' | 'previous' | null => {
          if (Date.now() - lastPageTurnTimeRef.current < 600) return null;
          const selection = iframe.contentWindow?.getSelection();
          if (!selection?.rangeCount || !selection.toString()) return null;
          activeSelectionEdge = null;

          const range = selection.getRangeAt(0);
          const startNode = range.startContainer;
          const startOffset = range.startOffset;
          const endNode = range.endContainer;
          const endOffset = range.endOffset;

          const pageWidth = iframe.clientWidth || window.innerWidth;
          const pageHeight = iframe.clientHeight || window.innerHeight;

          const canGoNext = currentPageRef.current < totalPagesRef.current - 1 || currentSpineRef.current < epub.spine.length - 1;
          const canGoPrev = currentPageRef.current > 0 || currentSpineRef.current > 0;

          // 1. Comprobar si el extremo final está en el borde final de la página (next)
          let isAtNextEdge = false;
          let nextSelectedCharRect: DOMRect | null = null;
          if (canGoNext) {
            nextSelectedCharRect = getAdjacentCharRect(endNode, endOffset, false);
            if (nextSelectedCharRect) {
              const inVisiblePage = isVertical
                ? (nextSelectedCharRect.top >= 0 && nextSelectedCharRect.top < pageHeight)
                : (nextSelectedCharRect.left >= 0 && nextSelectedCharRect.left < pageWidth);

              if (inVisiblePage) {
                const nextNeighbor = getAdjacentCharRect(endNode, endOffset, true);
                if (nextNeighbor) {
                  const forward = isVertical
                    ? nextNeighbor.top >= pageHeight - 1
                    : nextNeighbor.left >= pageWidth - 1;
                  if (forward) isAtNextEdge = true;
                } else {
                  isAtNextEdge = true;
                }
              }
            }
          }

          // 2. Comprobar si el extremo inicial está en el borde inicial de la página (previous)
          let isAtPrevEdge = false;
          let prevSelectedCharRect: DOMRect | null = null;
          if (canGoPrev) {
            prevSelectedCharRect = getAdjacentCharRect(startNode, startOffset, true);
            if (prevSelectedCharRect) {
              const inVisiblePage = isVertical
                ? (prevSelectedCharRect.top >= 0 && prevSelectedCharRect.top < pageHeight)
                : (prevSelectedCharRect.left >= 0 && prevSelectedCharRect.left < pageWidth);

              if (inVisiblePage) {
                const prevNeighbor = getAdjacentCharRect(startNode, startOffset, false);
                let backward = false;
                if (prevNeighbor) {
                  backward = isVertical ? prevNeighbor.bottom <= 1 : prevNeighbor.right <= 1;
                } else {
                  backward = true;
                }

                if (backward) isAtPrevEdge = true;
              }
            }
          }

          const startChanged = !lastSelectionEndpoints ||
            lastSelectionEndpoints.startNode !== startNode ||
            lastSelectionEndpoints.startOffset !== startOffset;
          const endChanged = !lastSelectionEndpoints ||
            lastSelectionEndpoints.endNode !== endNode ||
            lastSelectionEndpoints.endOffset !== endOffset;

          lastSelectionEndpoints = {
            startNode,
            startOffset,
            endNode,
            endOffset,
          };

          let chosenDirection: 'next' | 'previous' | null = null;

          if (startChanged && !endChanged) {
            // El usuario está moviendo exclusivamente el tirador de INICIO
            if (isAtPrevEdge) chosenDirection = 'previous';
          } else if (endChanged && !startChanged) {
            // El usuario está moviendo exclusivamente el tirador de FIN
            if (isAtNextEdge) chosenDirection = 'next';
          } else {
            // Ambos extremos cambiaron o la selección está sostenida en reposo
            const isBackwards = (sel: Selection) => {
              const { anchorNode: aNode, focusNode: fNode, anchorOffset: aOff, focusOffset: fOff } = sel;
              if (!aNode || !fNode) return false;
              if (aNode === fNode) return fOff < aOff;
              return Boolean(aNode.compareDocumentPosition(fNode) & Node.DOCUMENT_POSITION_PRECEDING);
            };
            const backwards = isBackwards(selection);
            if (backwards) {
              if (isAtPrevEdge) chosenDirection = 'previous';
              else if (isAtNextEdge) chosenDirection = 'next';
            } else {
              if (isAtNextEdge) chosenDirection = 'next';
              else if (isAtPrevEdge) chosenDirection = 'previous';
            }
          }

          if (chosenDirection === 'next' && nextSelectedCharRect) {
            activeSelectionEdge = { node: endNode, offset: endOffset, selectedForward: false };
            return 'next';
          }
          if (chosenDirection === 'previous' && prevSelectedCharRect) {
            activeSelectionEdge = { node: startNode, offset: startOffset, selectedForward: true };
            return 'previous';
          }

          activeSelectionEdge = null;
          return null;
        };
        const placeSelectionEdgeIndicator = (direction: 'next' | 'previous') => {
          if (!activeSelectionEdge) return;
          const selectedCharRect = getAdjacentCharRect(
            activeSelectionEdge.node,
            activeSelectionEdge.offset,
            activeSelectionEdge.selectedForward,
          );
          if (!selectedCharRect) return;
          const frame = iframe.getBoundingClientRect();
          const scaleX = frame.width / Math.max(1, iframe.clientWidth);
          const scaleY = frame.height / Math.max(1, iframe.clientHeight);
          const advance = direction === 'next' ? 1 : -1;
          const focusX = (selectedCharRect.left + selectedCharRect.right) / 2;
          const focusY = (selectedCharRect.top + selectedCharRect.bottom) / 2;
          const x = isVertical
            ? focusX
            : Math.max(20, Math.min(iframe.clientWidth - 20, focusX - advance * 42));
          const y = isVertical
            ? direction === 'previous'
              ? Math.max(24, padTop / 2)
              : Math.max(24, Math.min(iframe.clientHeight - 24, focusY + 48))
            : focusY;
          const indicator = {
            direction,
            x: frame.left + x * scaleX,
            y: frame.top + y * scaleY,
          };
          selectionEdgeIndicatorRef.current = indicator;
          setSelectionEdgeIndicator(indicator);
          logDebugRef.current(
            `selection edge ${direction} indicator=${Math.round(indicator.x)},${Math.round(indicator.y)}`,
          );
        };
        selectionEdgeTurnRef.current = (direction) => {
          clearSelectionEdgeIndicator();
          cancelEdgeActivationRef.current();
          lastPageTurnTimeRef.current = Date.now();
          if (direction === 'next') doNextRef.current();
          else doPrevRef.current();
        };

        const handleIframeSelectionChange = () => {
          if (programmaticWordSelectionRef.current) {
            setIsSelectionAdjusting(false);
            return;
          }

          const selection = iframe.contentWindow?.getSelection();
          if (selection && selection.rangeCount > 0) {
            const node = selection.anchorNode;
            if (node && node.parentElement?.closest('rt')) {
              // Android WebView selection handle snapped to an rt element; collapse or shift to parent/base text
              const ruby = node.parentElement.closest('ruby');
              if (ruby) {
                const textNode = Array.from(ruby.childNodes).find(
                  (c) => c.nodeType === Node.TEXT_NODE && !c.parentElement?.closest('rt')
                );
                if (textNode) {
                  try {
                    const r = doc.createRange();
                    r.setStart(textNode, 0);
                    r.setEnd(textNode, Math.min(1, textNode.nodeValue?.length || 1));
                    selection.removeAllRanges();
                    selection.addRange(r);
                  } catch {
                    // Ignore range adjustment failure
                  }
                }
              }
            }
          }

          if (!selection?.rangeCount || !selection.toString()) {
            cancelEdgeActivationRef.current();
            clearSelectionEdgeIndicator();
            selectedTextRef.current = '';
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
            cancelEdgeActivationRef.current();
            clearSelectionEdgeIndicator();
            return;
          }

          const range = selection.getRangeAt(0);
          if (range) {
            selectionRangeRef.current = range.cloneRange();
          }

          if (isNativeAndroid) {
            setIsSelectionAdjusting(true);
          }
          handleSelection();
          const edgeDirection = getSelectionEdgeDirection();
          if (edgeDirection) {
            setIsSelectionAdjusting(true);
            placeSelectionEdgeIndicator(edgeDirection);
            startEdgeActivationRef.current(edgeDirection);
          } else {
            cancelEdgeActivationRef.current();
            clearSelectionEdgeIndicator();
          }
        };

        const onStart = (cx: number, cy: number) => {
          sx = cx; sy = cy; st = Date.now(); moved = false; selecting = false;
          gestureNudgeStart = pageNudgeRef.current;
          const currentSel = iframe.contentWindow?.getSelection();
          selectionStringAtStart = currentSel?.toString() || '';
          selectionOrOverlayAtStart = Boolean(
            selectedTextRef.current.trim() ||
            openOverlayRef.current ||
            selectionStringAtStart.trim()
          );
        };
        const onMove = (cx: number, cy: number) => {
          const dx = cx - sx;
          const dy = cy - sy;
          if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;

          const selection = iframe.contentWindow?.getSelection();
          const currentSelectionString = selection?.toString() || '';
          const isExtendingSelection = currentSelectionString.trim() !== selectionStringAtStart.trim();

          if (gestureAdjustmentEnabled && !isExtendingSelection && !selecting && Math.abs(dx) > 6) {
            // Hide selection menu if we start dragging the page
            setSelectionPos(null);

            const nudge = Math.max(-nudgeLimit, Math.min(nudgeLimit, gestureNudgeStart + dx));
            pageNudgeRef.current = nudge;
            const page = currentPageRef.current;
            const scroller = doc.getElementById('reader-scroller');
            if (scroller) {
              scroller.style.transition = 'none';
              scroller.style.transform = isVertical
                ? `translate(${nudge}px, ${-page * vh}px)`
                : `translateX(${-page * vw + nudge}px)`;
            }
          }

          if (isExtendingSelection) {
            selecting = true;
          }
        };

        const selectWordAtPoint = (cx: number, cy: number) => {
          const caretDocument = doc as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
            caretPositionFromPoint?: (x: number, y: number) => {
              offsetNode: Node;
              offset: number;
            } | null;
          };
          const caretRange = caretDocument.caretRangeFromPoint?.(cx, cy);
          const fallbackPosition = caretRange ? null : caretDocument.caretPositionFromPoint?.(cx, cy);
          const caretPosition = caretRange
            ? { node: caretRange.startContainer, offset: caretRange.startOffset }
            : fallbackPosition
              ? { node: fallbackPosition.offsetNode, offset: fallbackPosition.offset }
              : null;
          if (!caretPosition || caretPosition.node.nodeType !== Node.TEXT_NODE) return false;

          const token = pageWordsRef.current.find(({ range }) =>
            range.isPointInRange(caretPosition.node, caretPosition.offset)
          );
          return token ? selectPageWord(token) : false;
        };

        const onEnd = (cx: number, cy: number, allowTapNavigation = true) => {
          const dt = Date.now() - st;
          const dx = cx - sx;

          if (gestureAdjustmentEnabled && moved && Math.abs(dx) >= threshold) {
            pageNudgeRef.current = 0;
            // Clear selection when turning page
            const win = iframe.contentWindow;
            if (win) {
              const sel = win.getSelection();
              if (sel) {
                sel.removeAllRanges();
                selectedTextRef.current = '';
                setSelectedText('');
                setSelectionPos(null);
              }
            }

            if (isRtl) {
              if (dx > 0) doNextRef.current(); else doPrevRef.current();
            } else {
              if (dx < 0) doNextRef.current(); else doPrevRef.current();
            }
            return;
          }

          if (gestureAdjustmentEnabled && moved) {
            pageNudgeRef.current = 0;
            const scroller = doc.getElementById('reader-scroller');
            if (scroller) {
              scroller.style.transition = 'transform 0.22s cubic-bezier(0.25, 1, 0.5, 1)';
            }
            updatePagination();
            setTimeout(() => { moved = false; }, 50);
            return;
          }

          const sel = iframe.contentWindow?.getSelection()?.toString().trim();
          const isTap = (allowTapNavigation || wordSelectionModeRef.current) && !moved && dt < 300;
          if (isTap && wordSelectionModeRef.current && !openOverlayRef.current) {
            if (selectWordAtPoint(cx, cy)) return;
          }
          if (isTap && (selectionOrOverlayAtStart || sel || selectedTextRef.current.trim() || openOverlayRef.current)) {
            iframe.contentWindow?.getSelection()?.removeAllRanges();
            selectedTextRef.current = '';
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

          if (isTap) {
            if (Date.now() - lastSelectionTime.current < 400) return;
            const vw = iframe.clientWidth || window.innerWidth;
            const ratio = cx / vw;
            if (ratio >= 0.28 && ratio <= 0.72) {
              setShowUi(p => !p);
            }
          }
        };

        logDebugRef.current('listeners ok');
        let lastIframeMoveTraceAt = 0;
        const traceInputEvent = (scope: string, event: Event) => {
          const isMove = event.type.endsWith('move') || event.type === 'pointerrawupdate';
          const now = Date.now();
          if (isMove && now - lastIframeMoveTraceAt < 100) return;
          if (isMove) lastIframeMoveTraceAt = now;
          const target = event.target && 'tagName' in event.target
            ? String(event.target.tagName).toLowerCase()
            : 'unknown';
          const targetId = event.target && 'id' in event.target && typeof event.target.id === 'string' && event.target.id
            ? `#${event.target.id}`
            : '';
          const pointerEvent = event as PointerEvent;
          const pointer = 'pointerType' in event
            ? ` pointer=${pointerEvent.pointerType}:${pointerEvent.pointerId} pressure=${pointerEvent.pressure}`
            : '';
          const mouseEvent = event as MouseEvent;
          const mouse = 'clientX' in event
            ? ` xy=${Math.round(mouseEvent.clientX)},${Math.round(mouseEvent.clientY)} buttons=${mouseEvent.buttons}`
            : '';
          const touchEvent = event as TouchEvent;
          const touches = event.type.startsWith('touch')
            ? ` touches=${touchEvent.touches.length} changed=${touchEvent.changedTouches.length}`
            : '';
          const selection = doc.getSelection();
          const selectionInfo = event.type === 'selectionchange'
            ? ` range=${selection?.rangeCount || 0} chars=${selection?.toString().length || 0}`
            : '';
          logDebugRef.current(
            `${scope}.${event.type} target=${target}${targetId}${pointer}${mouse}${touches}${selectionInfo} trusted=${event.isTrusted ? 1 : 0} active=${pointerActiveRef.current ? 1 : 0}`,
          );
        };
        const inputEvents = [
          'pointerover', 'pointerenter', 'pointerdown', 'pointermove', 'pointerrawupdate',
          'pointerup', 'pointercancel', 'pointerout', 'pointerleave',
          'gotpointercapture', 'lostpointercapture',
          'touchstart', 'touchmove', 'touchend', 'touchcancel',
          'mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'mouseout', 'mouseleave',
          'click', 'auxclick', 'dblclick', 'contextmenu',
          'dragstart', 'drag', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop',
          'selectstart', 'selectionchange', 'focus', 'blur', 'focusin', 'focusout',
          'keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate',
          'compositionend', 'visibilitychange',
        ];
        inputEvents.forEach((type) => {
          doc.addEventListener(type, (event) => traceInputEvent('iframe', event), {
            capture: true,
            passive: true,
          });
        });
        let pendingSelectionFrame = 0;
        const onSelectionChange = () => {
          countDebugRef.current('selchg');
          if (pendingSelectionFrame) return;
          pendingSelectionFrame = window.requestAnimationFrame(() => {
            pendingSelectionFrame = 0;
            if (iframe.contentDocument === doc) handleIframeSelectionChange();
          });
        };
        doc.addEventListener('selectionchange', onSelectionChange);
        // The native selection handles report through pointer events, so this is
        // the stream the selection paging has to run on.
        doc.addEventListener('pointerdown', () => {
          countDebugRef.current('pdown');
          programmaticWordSelectionRef.current = false;
          pointerActiveRef.current = true;
          nativeSelectionTookOverRef.current = false;
          lastPointerActivityRef.current = Date.now();
        }, { passive: true });
        doc.addEventListener('pointermove', () => {
          countDebugRef.current('pmove');
          lastPointerActivityRef.current = Date.now();
        }, { passive: true });
        doc.addEventListener('pointerup', () => {
          countDebugRef.current('pup');
          if (!isNativeAndroid) pointerActiveRef.current = false;
        }, { passive: true });
        // The browser cancels the pointer as soon as a long-press turns into a
        // native selection. That must not be read as "the finger left the
        // screen": doing so let the menu pop up mid-selection, and swallowed
        // the end of swipe gestures.
        doc.addEventListener('pointercancel', () => {
          countDebugRef.current('pcancel');
          nativeSelectionTookOverRef.current = true;
          lastPointerActivityRef.current = Date.now();
        }, { passive: true });
        document.addEventListener('selectionchange', onSelectionChange);
        doc.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          cancelEdgeActivationRef.current();
          clearSelectionEdgeIndicator();
          if (!isNativeAndroid || !e.isTrusted || !selectedTextRef.current) return;

          if (selectionSettleRef.current !== undefined) {
            window.clearTimeout(selectionSettleRef.current);
            selectionSettleRef.current = undefined;
          }
          window.setTimeout(() => {
            handleSelectionRef.current();
            setIsSelectionAdjusting(false);
            logDebugRef.current('selection menu revealed after native contextmenu');
          }, 0);
        });
        doc.addEventListener('mousedown', (e) => {
          pointerActiveRef.current = true;
          onStart(e.clientX, e.clientY);
        });
        doc.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
        doc.addEventListener('mouseup', (e) => {
          pointerActiveRef.current = false;
          if (Date.now() - lastTouchEndAt < 700) return;
          onEnd(e.clientX, e.clientY);
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
          programmaticWordSelectionRef.current = false;
          pointerActiveRef.current = true;
          nativeSelectionTookOverRef.current = false;
          lastPointerActivityRef.current = Date.now();
          if (e.touches[0]) onStart(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        doc.addEventListener('touchmove', (e) => {
          countDebugRef.current('tmove');
          lastPointerActivityRef.current = Date.now();
          if (e.touches[0]) {
            onMove(e.touches[0].clientX, e.touches[0].clientY);
          }
        }, { passive: true });
        doc.addEventListener('touchend', (e) => {
          countDebugRef.current('tend');
          lastTouchEndAt = Date.now();
          if (!isNativeAndroid) pointerActiveRef.current = false;
          if (e.changedTouches[0]) {
            onEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
          }
        }, { passive: true });
        doc.addEventListener('touchcancel', () => {
          countDebugRef.current('tcancel');
          nativeSelectionTookOverRef.current = true;
          lastPointerActivityRef.current = Date.now();
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

        const applyTargetPosition = (allowEmptyChapter = false) => {
          updatePagination();
          const measuredPageCount = totalPagesRef.current;
          const knownPageCount = chapterPageCountsRef.current[spineIndex] || 0;
          const fallbackPageCount = Math.max(knownPageCount, targetPageCount || 0);
          if (
            !wantsLastPage &&
            targetPage > 0 &&
            measuredPageCount <= 1 &&
            fallbackPageCount <= 1 &&
            !allowEmptyChapter
          ) {
            return false;
          }
          const resolvedPageCount = measuredPageCount > 1
            ? measuredPageCount
            : Math.max(1, fallbackPageCount);

          currentSpineRef.current = spineIndex;
          pageNudgeRef.current = 0;
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
            const hasMatchingPagination = targetPageCount === resolvedPageCount;
            const anchoredPage = targetTextOffset === undefined || hasMatchingPagination
              ? null
              : getPageForTextOffset(spineIndex, targetTextOffset);
            const resolvedPage = Math.min(
              anchoredPage ?? mapPageToLayout(targetPage, targetPageCount, resolvedPageCount),
              Math.max(0, resolvedPageCount - 1),
            );
            currentPageRef.current = resolvedPage;
            setCurrentPage(resolvedPage);
          }
          updatePagination();
          if (lastPageResolved) setIsLoadingChapter(false);
          return true;
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
            logDebugRef.current('target fallback');
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
          if (lastPageResolved && targetApplied) setIsLoadingChapter(false);
        }, lastPageDeadline + 300);

        // Poll for pagination rather than relying only on layout events, which
        // may fire before a slow device has finished laying out the chapter.
        if (wantsLastPage || targetPage > 0) {
          const retryLastPage = () => {
            if (
              (wantsLastPage ? lastPageResolved : targetApplied) ||
              currentSpineRef.current !== spineIndex
            ) return;
            updatePagination();
            if (wantsLastPage) {
              resolveLastPage();
            } else {
              const elapsed = Date.now() - loadedAt;
              const allowEmptyChapter = elapsed >= lastPageDeadline + 1000;
              targetApplied = applyTargetPosition(allowEmptyChapter);
              if (targetApplied) setIsLoadingChapter(false);
            }
            if (wantsLastPage ? !lastPageResolved : !targetApplied) {
              window.setTimeout(retryLastPage, 120);
            }
          };
          window.setTimeout(retryLastPage, 80);
        }

      } catch (err) {
        console.error(err);
        setIsLoadingChapter(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epub, settings, isVertical, isRtl, isNativeAndroid, themeColors, updatePagination, handleSelection, selectPageWord]
  );

  useEffect(() => {
    logDebugRef.current = (line: string) => {
      if (!debugEnabled) return;
      const stamp = new Date().toISOString().slice(17, 23);
      debugBufferRef.current = [...debugBufferRef.current.slice(-39), `${stamp} ${line}`];
    };
    countDebugRef.current = (key: string) => {
      if (!debugEnabled) return;
      debugCountsRef.current[key] = (debugCountsRef.current[key] || 0) + 1;
    };
  }, [debugEnabled]);

  useEffect(() => {
    if (!debugEnabled) return;

    const onNativeTouchTrace = (event: Event) => {
      const {
        action, x, y, pointers, inside, rawX, rawY,
        actionIndex, tool, source, buttons, device, eventTime,
      } = (event as CustomEvent<{
        action: string;
        x: number;
        y: number;
        pointers: number;
        inside: boolean;
        rawX: number;
        rawY: number;
        actionIndex: number;
        tool: number;
        source: number;
        buttons: number;
        device: number;
        eventTime: number;
      }>).detail;
      logDebugRef.current(
        `native.${action} css=${Math.round(x)},${Math.round(y)} in=${inside ? 1 : 0} raw=${Math.round(rawX)},${Math.round(rawY)} p=${pointers} idx=${actionIndex} tool=${tool} src=${source} btn=${buttons} dev=${device} t=${eventTime}`,
      );
    };
    const onNativeWebViewTouchTrace = (event: Event) => {
      const {
        action, x, y, pointers, actionIndex, tool, source, buttons, device, eventTime,
      } = (event as CustomEvent<{
        action: string;
        x: number;
        y: number;
        pointers: number;
        actionIndex: number;
        tool: number;
        source: number;
        buttons: number;
        device: number;
        eventTime: number;
      }>).detail;
      logDebugRef.current(
        `webview.${action} css=${Math.round(x)},${Math.round(y)} p=${pointers} idx=${actionIndex} tool=${tool} src=${source} btn=${buttons} dev=${device} t=${eventTime}`,
      );
    };
    const onNativeSelectionEvent = (event: Event) => {
      const {
        eventType, eventName, action, actionName, invocation, start, end, eventIndex, eventTime,
      } = (event as CustomEvent<{
        eventType: number;
        eventName: string;
        action: number;
        actionName: string;
        invocation: number;
        start: number;
        end: number;
        eventIndex: number;
        eventTime: number;
      }>).detail;
      logDebugRef.current(
        `classifier.${eventName}/${actionName} type=${eventType} action=${action} invoke=${invocation} range=${start}-${end} index=${eventIndex} t=${eventTime}`,
      );
    };
    let lastParentMoveTraceAt = 0;
    const traceInputEvent = (event: Event) => {
      const isMove = event.type.endsWith('move') || event.type === 'pointerrawupdate';
      const now = Date.now();
      if (isMove && now - lastParentMoveTraceAt < 100) return;
      if (isMove) lastParentMoveTraceAt = now;
      const target = event.target && 'tagName' in event.target
        ? String(event.target.tagName).toLowerCase()
        : 'unknown';
      const targetId = event.target && 'id' in event.target && typeof event.target.id === 'string' && event.target.id
        ? `#${event.target.id}`
        : '';
      const pointerEvent = event as PointerEvent;
      const pointer = 'pointerType' in event
        ? ` pointer=${pointerEvent.pointerType}:${pointerEvent.pointerId} pressure=${pointerEvent.pressure}`
        : '';
      const mouseEvent = event as MouseEvent;
      const mouse = 'clientX' in event
        ? ` xy=${Math.round(mouseEvent.clientX)},${Math.round(mouseEvent.clientY)} buttons=${mouseEvent.buttons}`
        : '';
      const touchEvent = event as TouchEvent;
      const touches = event.type.startsWith('touch')
        ? ` touches=${touchEvent.touches.length} changed=${touchEvent.changedTouches.length}`
        : '';
      const selection = window.getSelection();
      const selectionInfo = event.type === 'selectionchange'
        ? ` range=${selection?.rangeCount || 0} chars=${selection?.toString().length || 0}`
        : '';
      logDebugRef.current(
        `parent.${event.type} target=${target}${targetId}${pointer}${mouse}${touches}${selectionInfo} trusted=${event.isTrusted ? 1 : 0} active=${pointerActiveRef.current ? 1 : 0}`,
      );
    };
    const inputEvents = [
      'pointerover', 'pointerenter', 'pointerdown', 'pointermove', 'pointerrawupdate',
      'pointerup', 'pointercancel', 'pointerout', 'pointerleave',
      'gotpointercapture', 'lostpointercapture',
      'touchstart', 'touchmove', 'touchend', 'touchcancel',
      'mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'mouseout', 'mouseleave',
      'click', 'auxclick', 'dblclick', 'contextmenu',
      'dragstart', 'drag', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop',
      'selectstart', 'selectionchange', 'focus', 'blur', 'focusin', 'focusout',
      'keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate',
      'compositionend', 'visibilitychange',
    ];
    inputEvents.forEach((type) => {
      document.addEventListener(type, traceInputEvent, { capture: true, passive: true });
    });
    window.addEventListener('ereader-native-touch', onNativeTouchTrace);
    window.addEventListener('ereader-native-webview-touch', onNativeWebViewTouchTrace);
    window.addEventListener('ereader-native-selection-event', onNativeSelectionEvent);
    const traceWindowEvent = (event: Event) => traceInputEvent(event);
    window.addEventListener('blur', traceWindowEvent);
    window.addEventListener('focus', traceWindowEvent);
    document.addEventListener('visibilitychange', traceInputEvent);

    return () => {
      inputEvents.forEach((type) => {
        document.removeEventListener(type, traceInputEvent, { capture: true });
      });
      window.removeEventListener('ereader-native-touch', onNativeTouchTrace);
      window.removeEventListener('ereader-native-webview-touch', onNativeWebViewTouchTrace);
      window.removeEventListener('ereader-native-selection-event', onNativeSelectionEvent);
      window.removeEventListener('blur', traceWindowEvent);
      window.removeEventListener('focus', traceWindowEvent);
      document.removeEventListener('visibilitychange', traceInputEvent);
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
    pageAnalysisRequestRef.current += 1;
    clearPageWordHighlights(iframeRef.current?.contentDocument);
    pageWordsRef.current = [];
    setPageWords([]);
    wordSelectionModeRef.current = false;
    setIsWordSelectionMode(false);
    setIsAnalyzingPage(false);
    setIsPageGlossaryOpen(false);
  }, [currentPage, currentSpineIndex]);
  useEffect(() => {
    wordSelectionModeRef.current = isWordSelectionMode;
  }, [isWordSelectionMode]);
  useEffect(() => {
    const wasEnabled = previousAutoAnalyzePageRef.current;
    previousAutoAnalyzePageRef.current = settings.autoAnalyzePage;
    if (!wasEnabled || settings.autoAnalyzePage) return;

    pageAnalysisRequestRef.current += 1;
    automaticPageAnalysisRequestRef.current = 0;
    wordSelectionModeRef.current = false;
    setIsWordSelectionMode(false);
    setIsAnalyzingPage(false);
    pageWordsRef.current = [];
    setPageWords([]);
    setIsPageGlossaryOpen(false);
    clearPageWordHighlights(iframeRef.current?.contentDocument);
  }, [settings.autoAnalyzePage]);
  useEffect(() => () => {
    if (wordAnalysisErrorTimerRef.current !== undefined) {
      window.clearTimeout(wordAnalysisErrorTimerRef.current);
    }
    clearPageWordHighlights(iframeRef.current?.contentDocument);
  }, []);
  useEffect(() => {
    selectedTextRef.current = selectedText;
    openOverlayRef.current = isBookmarksOpen || isSearchOpen || isTranslationHistoryOpen || isPageGlossaryOpen || isTocOpen || isSettingsOpen || isTranslateOpen || Boolean(imageViewerSrc);
  }, [imageViewerSrc, isBookmarksOpen, isPageGlossaryOpen, isSearchOpen, isSettingsOpen, isTocOpen, isTranslateOpen, isTranslationHistoryOpen, selectedText]);

  useEffect(() => {
    const query = selectedText.trim();
    if (isSelectionAdjusting || isTranslationHistoryOpen || !query || Array.from(query).length > 32) {
      setDictionaryPreview(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getDictionarySearchTerms(query, settings.language)
        .then((lookup) => {
          if (cancelled) return;
          const hasEntries = lookup.entries.length > 0;
          setDictionaryPreview(hasEntries ? lookup : null);
          if (hasEntries && lookup.hasCompleteMatch) {
            handleRecordFrequentQuery(query, frequentSearchToken);
            const { response, data } = buildDictionaryHistoryResponse(
              lookup.baseForm,
              lookup.searchTerms,
              lookup.entries,
            );
            handleSaveTranslationHistory('dictionary', query, response, undefined, data);
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
  }, [frequentSearchToken, handleRecordFrequentQuery, handleSaveTranslationHistory, isSelectionAdjusting, isTranslationHistoryOpen, selectedText]);
  useEffect(() => {
    if (!isLoadingChapter) {
      saveReadingPosition({
        spineIndex: currentSpineIndex,
        page: currentPage,
        pageCount: Math.max(1, totalPagesRef.current),
        textOffset: getTextOffsetForPage(currentSpineIndex, currentPage),
      });
    }
  }, [
    currentPage,
    currentSpineIndex,
    getTextOffsetForPage,
    isLoadingChapter,
    saveReadingPosition,
  ]);

  useEffect(() => {
    if (!onBookDataChange || !backupDirtyRef.current || isLoadingChapter || !isReaderPositioned) return;
    const backup: ReaderBookBackup = {
      bookKey: bookStorageKey,
      title: epub.metadata.title,
      creator: epub.metadata.creator,
      position: {
        spineIndex: currentSpineIndex,
        page: currentPage,
        pageCount: Math.max(1, totalPagesRef.current),
        textOffset: getTextOffsetForPage(currentSpineIndex, currentPage),
      },
      bookmarks: bookmarks.map((bookmark) => ({
        ...bookmark,
        pageCount: bookmark.pageCount || chapterPageCountsRef.current[bookmark.spineIndex],
      })),
      annotations: textAnnotations,
      translationHistory,
      favorites: translationFavorites,
      frequentQueries,
      frequentQueriesVersion: FREQUENT_QUERIES_VERSION,
    };
    pendingReaderBackupRef.current = backup;
    const timer = window.setTimeout(() => {
      onBookDataChange(backup);
      pendingReaderBackupRef.current = null;
      backupDirtyRef.current = false;
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    bookStorageKey,
    bookmarks,
    currentPage,
    currentSpineIndex,
    epub.metadata.creator,
    epub.metadata.title,
    getTextOffsetForPage,
    frequentQueries,
    isLoadingChapter,
    isReaderPositioned,
    onBookDataChange,
    textAnnotations,
    translationFavorites,
    translationHistory,
  ]);

  useEffect(() => () => {
    const pendingBackup = pendingReaderBackupRef.current;
    if (pendingBackup) {
      onBookDataChangeRef.current?.(pendingBackup);
      pendingReaderBackupRef.current = null;
      backupDirtyRef.current = false;
    }
  }, []);

  // Expose page-turn handlers to React world (footer buttons, keyboard)
  const handleNextPage = useCallback(() => doNextRef.current(), []);
  const handlePrevPage = useCallback(() => doPrevRef.current(), []);
  const handleSeekPage = useCallback((requestedPage: number) => {
    if (!isBookPaginationReady || !bookTotalPages) return;
    markReaderDataChanged();
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
  }, [bookTotalPages, isBookPaginationReady, loadChapter, markReaderDataChanged, updatePagination]);

  const handleSelectBookmark = useCallback((position: ReadingPosition) => {
    if (position.spineIndex < 0 || position.spineIndex >= epub.spine.length || position.page < 0) return;
    markReaderDataChanged();
    const pageCount = Math.max(
      1,
      position.spineIndex === currentSpineRef.current
        ? totalPagesRef.current
        : chapterPageCountsRef.current[position.spineIndex] || 1,
    );
    const targetPage = Math.min(
      position.textOffset === undefined || position.pageCount === pageCount
        ? mapPageToLayout(position.page, position.pageCount, pageCount)
        : getPageForTextOffset(position.spineIndex, position.textOffset)
          ?? mapPageToLayout(position.page, position.pageCount, pageCount),
      pageCount - 1,
    );
    if (position.spineIndex === currentSpineRef.current) {
      currentPageRef.current = targetPage;
      setCurrentPage(targetPage);
      updatePagination();
    } else {
      loadChapter(position.spineIndex, targetPage, pageCount, position.textOffset);
    }
    setIsBookmarksOpen(false);
  }, [
    epub.spine.length,
    getPageForTextOffset,
    loadChapter,
    markReaderDataChanged,
    updatePagination,
  ]);

  const bookmarkItems = bookmarks.map((position) => {
    const currentCount = chapterPageCountsRef.current[position.spineIndex] || 0;
    const page = currentCount
      ? mapPageToLayout(position.page, position.pageCount, currentCount)
      : position.page;
    const chapterIndex = epub.toc.findIndex(
      (item) => resolveSpineIndex(item.href) === position.spineIndex
    );
    const chapterLabel = chapterIndex >= 0
      ? epub.toc[chapterIndex].label
      : `${t('common.chapter', settings.language)} ${getDisplayChapter(position.spineIndex)}`;
    const chapterTotal = currentCount || position.pageCount || 1;
    const bookPage = getGlobalPage(position.spineIndex, page) + 1;
    const chapterPageDisplay = formatChapterPageDisplay(page, chapterTotal, settings.paginationMode, printedPages, bookTotalPages, settings.language, chapterLabel);
    const pageDisplay = formatPageDisplay(bookPage - 1, bookTotalPages, settings.paginationMode, printedPages, settings.language);
    return {
      ...position,
      page,
      originalPage: position.page,
      ...(currentCount ? { pageCount: currentCount } : {}),
      chapterLabel,
      bookPage,
      pageDisplay,
      chapterPageDisplay,
    };
  }).filter((bookmark, index, items) =>
    items.findIndex((candidate) =>
      candidate.spineIndex === bookmark.spineIndex && candidate.page === bookmark.page
    ) === index
  );
  // Load the morphological dictionary in its worker while the book is read, so
  // the first word selected already finds it ready.
  useEffect(() => {
    const timer = window.setTimeout(warmUpDictionary, 2500);
    return () => window.clearTimeout(timer);
  }, []);

  // ─── SEARCH IN BOOK ───────────────────────────────────────────────────────────
  useEffect(() => {
    chapterSearchTextRef.current.clear();
  }, [epub]);

  const getChapterSearchText = useCallback((spineIndex: number) => {
    const cache = chapterSearchTextRef.current;
    let pending = cache.get(spineIndex);
    if (!pending) {
      pending = epub.getChapterContent(epub.spine[spineIndex].href).then((rawHtml) => {
        const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
        return extractSearchText(parsed.body, parsed);
      });
      cache.set(spineIndex, pending);
      pending.catch(() => cache.delete(spineIndex));
    }
    return pending;
  }, [epub]);

  // Label shown above each group of hits: the nearest table-of-contents entry
  // at or before the chapter file the hit lives in.
  const spineLabels = useMemo(() => {
    const labels: string[] = new Array(epub.spine.length).fill('');
    const visit = (items: typeof epub.toc) => {
      items.forEach((item) => {
        const index = resolveSpineIndex(item.href);
        if (index >= 0 && !labels[index]) labels[index] = item.label;
        if (item.subitems) visit(item.subitems);
      });
    };
    visit(epub.toc);
    let carried = '';
    return labels.map((label, index) => {
      if (label) carried = label;
      return carried || `Sección ${index + 1}`;
    });
  }, [epub.spine.length, epub.toc, resolveSpineIndex]);

  const openSearch = useCallback((text = '') => {
    setSearchSeed((seed) => ({ text: text.trim().slice(0, 100), token: seed.token + 1 }));
    setIsSearchOpen(true);
  }, []);

  const handleRememberSearch = useCallback((query: string) => {
    setRecentSearches((list) => addRecentSearch(recentSearchesStorageKey, list, query));
  }, [recentSearchesStorageKey]);

  const handleRemoveRecentSearch = useCallback((query: string) => {
    setRecentSearches((list) => removeRecentSearch(recentSearchesStorageKey, list, query));
  }, [recentSearchesStorageKey]);

  const handleClearRecentSearches = useCallback(() => {
    setRecentSearches(clearRecentSearches(recentSearchesStorageKey));
  }, [recentSearchesStorageKey]);

  // Lays a chapter out in a hidden frame, exactly as the reader would, and
  // hands the laid-out document to `measure` before throwing the frame away.
  const withHiddenChapter = useCallback(async <T,>(
    spineIndex: number,
    measure: (scroller: HTMLElement, doc: Document, vw: number, vh: number) => T,
    fallback: T,
  ): Promise<T> => {
    const host = iframeRef.current;
    if (!host) return fallback;
    const vw = host.clientWidth || window.innerWidth;
    const vh = host.clientHeight || window.innerHeight;
    const frame = document.createElement('iframe');
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${vw}px;height:${vh}px;visibility:hidden;pointer-events:none;border:0;`;
    document.body.appendChild(frame);
    try {
      const rawHtml = await epub.getChapterContent(epub.spine[spineIndex].href);
      const doc = frame.contentDocument;
      if (!doc) return fallback;
      doc.open();
      doc.write(buildChapterDocument(rawHtml).html);
      doc.close();
      if (isVertical) wrapVerticalPunctuation(doc);
      await Promise.all([
        Promise.race([
          doc.fonts?.ready?.catch(() => undefined),
          new Promise<void>((resolve) => window.setTimeout(resolve, 1200)),
        ]),
        Promise.race([
          Promise.all(Array.from(doc.images).map((image) => image.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
              image.addEventListener('load', () => resolve(), { once: true });
              image.addEventListener('error', () => resolve(), { once: true });
            }))),
          new Promise<void>((resolve) => window.setTimeout(resolve, 1200)),
        ]),
      ]);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
      const scroller = doc.getElementById('reader-scroller');
      if (!scroller) return fallback;
      return measure(scroller, doc, vw, vh);
    } finally {
      frame.remove();
    }
  }, [buildChapterDocument, epub, isVertical]);

  // Pages (0-based, within the chapter) of several hits of one chapter, from a
  // single layout pass.
  const getHitPages = useCallback((spineIndex: number, hits: Array<{ start: number; length: number }>) =>
    withHiddenChapter(
      spineIndex,
      (scroller, doc, vw, vh) => {
        const locator = createSearchLocator(scroller, doc);
        const pages = countScrollerPages(doc, scroller, isVertical, vw, vh);
        return hits.map((hit) => {
          const range = locator.locate(hit.start, hit.length);
          return range ? Math.min(pages - 1, pageOfRange(range, scroller, isVertical, vw, vh)) : 0;
        });
      },
      hits.map(() => 0),
    ), [isVertical, withHiddenChapter]);

  useEffect(() => {
    if (!isBookmarksOpen || !textAnnotations.length) return;
    let cancelled = false;
    const annotationsBySpine = new Map<number, TextAnnotation[]>();
    textAnnotations.forEach((annotation) => {
      const chapterAnnotations = annotationsBySpine.get(annotation.spineIndex) || [];
      chapterAnnotations.push(annotation);
      annotationsBySpine.set(annotation.spineIndex, chapterAnnotations);
    });

    const measureAnnotations = async () => {
      for (const [spineIndex, annotations] of annotationsBySpine) {
        try {
          const locations = await withHiddenChapter(
            spineIndex,
            (scroller, doc, vw, vh) => {
              const pageCount = countScrollerPages(doc, scroller, isVertical, vw, vh);
              return annotations.map((annotation) => {
                const range = findTextAnnotationRange(scroller, annotation);
                return range
                  ? {
                    id: annotation.id,
                    page: Math.min(pageCount - 1, pageOfRange(range, scroller, isVertical, vw, vh)),
                    pageCount,
                  }
                  : null;
              });
            },
            annotations.map(() => null),
          );
          if (cancelled) return;
          const chapterPages = new Map<string, { page: number; pageCount: number } | null>();
          locations.forEach((location, index) => {
            chapterPages.set(
              annotations[index].id,
              location ? { page: location.page, pageCount: location.pageCount } : null,
            );
          });
          setAnnotationPages((existing) => new Map([...existing, ...chapterPages]));
        } catch (error) {
          console.error(`No se pudo calcular la página de los subrayados de la sección ${spineIndex + 1}.`, error);
          if (cancelled) return;
          setAnnotationPages((existing) => {
            const next = new Map(existing);
            annotations.forEach((annotation) => next.set(annotation.id, null));
            return next;
          });
        }
      }
    };

    setAnnotationPages(new Map());
    void measureAnnotations();
    return () => {
      cancelled = true;
    };
  }, [isBookmarksOpen, isVertical, textAnnotations, withHiddenChapter]);

  const annotationItems = textAnnotations.map((annotation) => {
    const location = annotationPages.get(annotation.id);
    const currentCount = chapterPageCountsRef.current[annotation.spineIndex] || 0;
    const chapterPage = location ? (currentCount ? mapPageToLayout(location.page, location.pageCount, currentCount) : location.page) : 0;
    const chapterTotal = currentCount || location?.pageCount || 1;
    const gPage = location ? getGlobalPage(annotation.spineIndex, chapterPage) : 0;
    const chapterName = spineLabels[annotation.spineIndex];
    const chapterPageDisplay = formatChapterPageDisplay(chapterPage, chapterTotal, settings.paginationMode, printedPages, bookTotalPages, settings.language, chapterName);
    const bookPageDisplay = formatPageDisplay(gPage, bookTotalPages, settings.paginationMode, printedPages, settings.language);

    const pageLabel = !isBookmarksOpen
      ? undefined
      : location === undefined
        ? t('reader.calculatingPage', settings.language)
        : location === null
          ? t('reader.locatePageError', settings.language)
          : isBookPaginationReady
            ? `${chapterPageDisplay} · ${bookPageDisplay}`
            : chapterPageDisplay;
    return {
      ...annotation,
      chapterLabel: chapterName || `${t('common.section', settings.language)} ${annotation.spineIndex + 1}`,
      pageLabel,
    };
  });

  const findHitPage = useCallback(async (hit: SearchHit): Promise<number> => {
    const [page] = await getHitPages(hit.spineIndex, [hit]);
    return page ?? 0;
  }, [getHitPages]);

  const handleSelectTextAnnotation = useCallback(async (annotation: TextAnnotation) => {
    markReaderDataChanged();
    setIsBookmarksOpen(false);
    try {
      const target = await withHiddenChapter(
        annotation.spineIndex,
        (scroller, doc, vw, vh) => {
          const range = findTextAnnotationRange(scroller, annotation);
          if (!range) return null;
          const pageCount = countScrollerPages(doc, scroller, isVertical, vw, vh);
          return {
            page: Math.min(pageCount - 1, pageOfRange(range, scroller, isVertical, vw, vh)),
            pageCount,
          };
        },
        null,
      );
      if (!target) {
        showWordAnalysisError(t('reader.locateAnnotationError', settings.language));
        return;
      }

      await loadChapter(annotation.spineIndex, target.page, target.pageCount);
      window.setTimeout(() => {
        if (currentSpineRef.current !== annotation.spineIndex) return;
        const iframe = iframeRef.current;
        const scroller = iframe?.contentDocument?.getElementById('reader-scroller');
        const range = scroller && findTextAnnotationRange(scroller, annotation);
        if (!iframe || !scroller || !range) return;
        const actualPage = pageOfRange(
          range,
          scroller,
          isVertical,
          iframe.clientWidth || window.innerWidth,
          iframe.clientHeight || window.innerHeight,
        );
        if (actualPage === currentPageRef.current || actualPage >= totalPagesRef.current) return;
        currentPageRef.current = actualPage;
        setCurrentPage(actualPage);
        updatePagination();
      }, 1300);
    } catch (error) {
      console.error('No se pudo abrir el subrayado guardado.', error);
      showWordAnalysisError(t('reader.openAnnotationError', settings.language));
    }
  }, [
    isVertical,
    loadChapter,
    markReaderDataChanged,
    showWordAnalysisError,
    updatePagination,
    withHiddenChapter,
  ]);

  // "p. 123" counting the whole book once its pagination is known, otherwise
  // the page within the chapter.
  const getSearchPageLabel = useCallback((spineIndex: number, page: number) => {
    return isBookPaginationReady
      ? `p. ${getGlobalPage(spineIndex, page) + 1}`
      : `p. ${page + 1} del cap.`;
  }, [getGlobalPage, isBookPaginationReady]);

  // Page the hit currently sits on in the live reader, or null when it cannot
  // be found there.
  const getLiveHitPage = useCallback((hit: SearchHit): number | null => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const scroller = doc?.getElementById('reader-scroller');
    if (!iframe || !doc || !scroller) return null;
    const range = locateSearchRange(scroller, doc, hit.start, hit.length);
    if (!range) return null;
    const vw = iframe.clientWidth || window.innerWidth;
    const vh = iframe.clientHeight || window.innerHeight;
    return pageOfRange(range, scroller, isVertical, vw, vh);
  }, [isVertical]);

  // Marks the hit on the page for a few seconds so it is easy to spot. Uses the
  // CSS Custom Highlight API, which paints over the text without touching the
  // DOM (and so without disturbing the layout); where it is missing the reader
  // still lands on the right page, just without the marker.
  const highlightSearchHit = useCallback((hit: SearchHit) => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const scroller = doc?.getElementById('reader-scroller');
    const win = iframe?.contentWindow as (Window & {
      Highlight?: new (...ranges: Range[]) => unknown;
      CSS?: { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } };
    }) | null | undefined;
    const registry = win?.CSS?.highlights;
    const HighlightClass = win?.Highlight;
    if (!doc || !scroller || !registry || !HighlightClass) return;
    const range = locateSearchRange(scroller, doc, hit.start, hit.length);
    if (!range) return;
    if (!doc.getElementById('search-hit-style')) {
      const style = doc.createElement('style');
      style.id = 'search-hit-style';
      style.textContent = '::highlight(search-hit){background-color:rgba(250,204,21,0.7);color:inherit;}';
      doc.head.appendChild(style);
    }
    registry.set('search-hit', new HighlightClass(range));
    window.clearTimeout(searchHighlightTimerRef.current);
    searchHighlightTimerRef.current = window.setTimeout(() => registry.delete('search-hit'), 8000);
  }, []);

  const handleSelectSearchHit = useCallback(async (hit: SearchHit) => {
    markReaderDataChanged();
    setIsSearchOpen(false);
    let page: number;
    if (hit.spineIndex === currentSpineRef.current) {
      page = Math.min(
        Math.max(0, totalPagesRef.current - 1),
        getLiveHitPage(hit) ?? currentPageRef.current,
      );
      currentPageRef.current = page;
      setCurrentPage(page);
      updatePagination();
    } else {
      page = await findHitPage(hit);
      await loadChapter(hit.spineIndex, page);
    }
    highlightSearchHit(hit);
    // Fonts and images can still shift the layout after the chapter appears,
    // so once it has settled, re-check that the hit really is on the page
    // shown and correct it if the page moved. Skipped if the reader has turned
    // the page or left the chapter in the meantime.
    window.setTimeout(() => {
      if (currentSpineRef.current !== hit.spineIndex || currentPageRef.current !== page) return;
      const actual = getLiveHitPage(hit);
      if (actual === null || actual === page || actual >= totalPagesRef.current) return;
      currentPageRef.current = actual;
      setCurrentPage(actual);
      updatePagination();
    }, 1300);
  }, [findHitPage, getLiveHitPage, highlightSearchHit, loadChapter, markReaderDataChanged, updatePagination]);

  const bookmarkPageMarkers = isBookPaginationReady
    ? bookmarkItems.map((bookmark) => getGlobalPage(bookmark.spineIndex, bookmark.page))
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

  useLayoutEffect(() => {
    const scroller = iframeRef.current?.contentDocument?.getElementById('reader-scroller');
    scroller?.classList.toggle('hide-furigana', !settings.showFurigana);
  }, [settings.showFurigana]);

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
          position = {
            spineIndex: savedSpineIndex,
            page: savedPage,
            ...(Number.isInteger(parsed.pageCount) && (parsed.pageCount || 0) > 0
              ? { pageCount: parsed.pageCount }
              : {}),
            ...(Number.isInteger(parsed.textOffset) && (parsed.textOffset || 0) >= 0
              ? { textOffset: parsed.textOffset }
              : {}),
          };
        }
      }
    } catch {
      // Ignore malformed or unavailable persisted position.
    }
    loadChapter(position.spineIndex, position.page, position.pageCount, position.textOffset);
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
      markReaderDataChanged();
      loadChapter(currentSpineRef.current + 1, 0);
    }
  };
  const handlePrevChapter = () => {
    if (currentSpineRef.current > 0) {
      markReaderDataChanged();
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
      setTocError(t('reader.tocNotAvailable', settings.language));
      window.setTimeout(() => setTocError(null), 3000);
      return;
    }
    setTocError(null);
    markReaderDataChanged();
    loadChapter(index, 0);
  };

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSearchOpen) {
        // The search box owns the keyboard: space, j and k must type, not turn pages.
        if (e.key === 'Escape') setIsSearchOpen(false);
        return;
      }
      if (isSettingsOpen || isTocOpen || isTranslateOpen) return;
      if (isPageGlossaryOpen) {
        if (e.key === 'Escape') setIsPageGlossaryOpen(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch(selectedTextRef.current);
        return;
      }
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
        selectedTextRef.current = '';
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
  }, [imageViewerSrc, isBookmarksOpen, isPageGlossaryOpen, isRtl, isSearchOpen, isSettingsOpen, isTocOpen, isTranslateOpen, isTranslationHistoryOpen, handleNextPage, handlePrevPage, onCloseBook, openSearch]);

  useEffect(() => {
    let cancelled = false;
    let removeListener: (() => Promise<void>) | undefined;
    void CapacitorApp.addListener('backButton', () => {
      if (cancelled) return;
      if (imageViewerSrc) setImageViewerSrc(null);
      else if (isPageGlossaryOpen) setIsPageGlossaryOpen(false);
      else if (isTranslationHistoryOpen) setIsTranslationHistoryOpen(false);
      else if (isSearchOpen) setIsSearchOpen(false);
      else if (isBookmarksOpen) setIsBookmarksOpen(false);
      else onCloseBook();
    }).then((listener) => {
      removeListener = () => listener.remove();
    });
    return () => {
      cancelled = true;
      if (removeListener) void removeListener();
    };
  }, [imageViewerSrc, isBookmarksOpen, isPageGlossaryOpen, isSearchOpen, isTranslationHistoryOpen, onCloseBook]);

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

  const analyzeCurrentPage = useCallback(async (openGlossary: boolean, automatic = false) => {
    const request = pageAnalysisRequestRef.current + 1;
    pageAnalysisRequestRef.current = request;
    automaticPageAnalysisRequestRef.current = automatic ? request : 0;
    const spineIndex = currentSpineRef.current;
    const page = currentPageRef.current;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const scroller = doc?.getElementById('reader-scroller');
    if (!iframe || !doc || !scroller) {
      showWordAnalysisError(t('reader.pageAccessError', settings.language));
      return;
    }

    setIsAnalyzingPage(true);
    setWordAnalysisError(null);
    clearPageWordHighlights(doc);
    try {
      const segments: Array<{ node: Text; start: number; end: number }> = [];
      let pageText = '';
      let previousBlock: Element | null = null;
      const walker = doc.createTreeWalker(scroller, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const textNode = node as Text;
        const text = textNode.nodeValue || '';
        if (
          !text.trim() ||
          textNode.parentElement?.closest('rt, script, style, noscript, svg')
        ) continue;

        const range = doc.createRange();
        range.selectNodeContents(textNode);
        const visible = Array.from(range.getClientRects()).some((rect) =>
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < iframe.clientWidth &&
          rect.top < iframe.clientHeight
        );
        if (!visible) continue;

        const block = textNode.parentElement?.closest(
          'p, h1, h2, h3, h4, h5, h6, div, li, blockquote, pre, section, article, td, th, caption'
        ) || null;
        if (pageText && block !== previousBlock) pageText += '\n';
        const start = pageText.length;
        segments.push({ node: textNode, start, end: start + text.length });
        pageText += text;
        previousBlock = block;
      }

      if (!pageText.trim()) {
        throw new Error(t('reader.noVisibleText', settings.language));
      }

      const morphology = await tokenizeJapanese(pageText);
      if (
        request !== pageAnalysisRequestRef.current ||
        spineIndex !== currentSpineRef.current ||
        page !== currentPageRef.current
      ) return;

      const locatedTokens: Array<{
        token: JapaneseMorphologicalToken;
        start: number;
        end: number;
      }> = [];
      let searchFrom = 0;
      for (const token of morphology) {
        const start = pageText.indexOf(token.surface_form, searchFrom);
        if (start < 0) continue;
        const end = start + token.surface_form.length;
        searchFrom = end;
        locatedTokens.push({ token, start, end });
      }

      const mergedTokens: Array<{
        token: JapaneseMorphologicalToken & {
          joinedSuffix?: boolean;
          joinedConjugation?: boolean;
          joinedTeForm?: boolean;
        };
        start: number;
        end: number;
      }> = [];
      const auxiliaryTeFormVerbs = new Set(['いる', 'おる', 'おく', 'しまう', 'くる', 'いく', 'みる', 'ある']);
      const contractedTeRuForms = new Set(['てる', 'でる']);
      locatedTokens.forEach(({ token, start, end }) => {
        if (!token.surface_form.trim() || token.pos === '記号') return;
        const previous = mergedTokens[mergedTokens.length - 1];
        const adjacent = previous?.end === start;
        const isSuffix = token.pos_detail_1 === '接尾';
        const previousIsAdjectivalNoun =
          previous?.token.pos === '名詞' &&
          previous.token.pos_detail_1 === '形容動詞語幹';
        const isAuxiliary = token.pos === '助動詞' &&
          (
            ['動詞', '形容詞', '形容動詞', '助動詞'].includes(previous?.token.pos || '') ||
            previousIsAdjectivalNoun
          );
        const isTeFormConnector = token.pos === '助詞' &&
          token.pos_detail_1 === '接続助詞' &&
          ['て', 'で'].includes(token.surface_form) &&
          previous?.token.pos === '動詞';
        const isTeFormAuxiliary = token.pos === '動詞' &&
          previous?.token.joinedTeForm === true &&
          auxiliaryTeFormVerbs.has(token.basic_form || token.surface_form);
        const isContractedTeRu = token.pos === '動詞' &&
          token.pos_detail_1 === '非自立' &&
          contractedTeRuForms.has(token.surface_form) &&
          previous?.token.pos === '動詞';

        if (adjacent && previous && (
          isSuffix ||
          isAuxiliary ||
          isTeFormConnector ||
          isTeFormAuxiliary ||
          isContractedTeRu
        )) {
          const mergedSurface = previous.token.surface_form + token.surface_form;
          previous.token = {
            ...previous.token,
            surface_form: mergedSurface,
            reading: previous.token.reading && token.reading
              ? previous.token.reading + token.reading
              : previous.token.reading || token.reading,
            basic_form: isSuffix
              ? mergedSurface
              : previous.token.basic_form,
            joinedSuffix: Boolean(previous.token.joinedSuffix || isSuffix),
            joinedConjugation: Boolean(
              previous.token.joinedConjugation ||
              isTeFormAuxiliary ||
              isContractedTeRu
            ),
            joinedTeForm: Boolean(
              isTeFormConnector ||
              (previous.token.joinedTeForm && !isTeFormAuxiliary)
            ),
            conjugated_type: token.conjugated_type || previous.token.conjugated_type,
            conjugated_form: token.conjugated_form || previous.token.conjugated_form,
          };
          previous.end = end;
          return;
        }

        mergedTokens.push({
          token: { ...token },
          start,
          end,
        });
      });

      const visibleWords: PageWordToken[] = [];
      for (const { token, start, end } of mergedTokens) {
        const startSegment = segments.find((candidate) =>
          start >= candidate.start && start < candidate.end
        );
        const endSegment = segments.find((candidate) =>
          end > candidate.start && end <= candidate.end
        );
        if (!startSegment || !endSegment) continue;
        const range = doc.createRange();
        range.setStart(startSegment.node, start - startSegment.start);
        range.setEnd(endSegment.node, end - endSegment.start);
        const isVisible = Array.from(range.getClientRects()).some((rect) =>
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < iframe.clientWidth &&
          rect.top < iframe.clientHeight
        );
        if (isVisible) visibleWords.push({
          ...token,
          range: range.cloneRange(),
        });
      }

      if (visibleWords.length === 0) {
        throw new Error('Kuromoji no ha encontrado palabras seleccionables en esta página.');
      }

      pageWordsRef.current = visibleWords;
      setPageWords(visibleWords);
      applyPageWordHighlights(
        doc,
        visibleWords,
        isVertical,
      );
      wordSelectionModeRef.current = true;
      setIsWordSelectionMode(true);
      if (openGlossary) {
        setIsPageGlossaryOpen(true);
      }
    } catch (error) {
      if (request !== pageAnalysisRequestRef.current) return;
      showWordAnalysisError(
        error instanceof Error
          ? t('reader.analysisError', settings.language).replace('{message}', error.message)
          : t('reader.analysisGenericError', settings.language)
      );
    } finally {
      if (request === pageAnalysisRequestRef.current) setIsAnalyzingPage(false);
      if (automaticPageAnalysisRequestRef.current === request) {
        automaticPageAnalysisRequestRef.current = 0;
      }
    }
  }, [isVertical, showWordAnalysisError]);

  const handleToggleAutoAnalysis = useCallback(() => {
    if (!settings.autoAnalyzePage && isWordSelectionMode) {
      wordSelectionModeRef.current = false;
      setIsWordSelectionMode(false);
      pageWordsRef.current = [];
      setPageWords([]);
      clearPageWordHighlights(iframeRef.current?.contentDocument);
      setIsPageGlossaryOpen(false);
      return;
    }
    onUpdateSettings({ autoAnalyzePage: !settings.autoAnalyzePage });
  }, [isWordSelectionMode, onUpdateSettings, settings.autoAnalyzePage]);

  const handleOpenPageGlossary = useCallback(() => {
    if (pageWordsRef.current.length > 0) {
      wordSelectionModeRef.current = true;
      setIsWordSelectionMode(true);
      setIsPageGlossaryOpen(true);
      return;
    }
    void analyzeCurrentPage(true);
  }, [analyzeCurrentPage]);

  const handleToggleReaderFullscreen = useCallback(async () => {
    if (!isReaderFullscreenRef.current) {
      const iframe = iframeRef.current;
      if (!iframe) return;

      const size = {
        width: iframe.clientWidth || window.innerWidth,
        height: iframe.clientHeight || window.innerHeight,
      };
      setFullscreenFrameSize(size);
      isReaderFullscreenRef.current = true;
      setIsReaderFullscreen(true);
      setFullscreenError(null);
      try {
        await setReaderFullscreen(true);
      } catch (error) {
        isReaderFullscreenRef.current = false;
        setIsReaderFullscreen(false);
        setFullscreenFrameSize(null);
        setFullscreenError(error instanceof Error ? error.message : 'No se pudo activar la pantalla completa.');
      }
      return;
    }

    try {
      await setReaderFullscreen(false);
      isReaderFullscreenRef.current = false;
      setIsReaderFullscreen(false);
      if (fullscreenExitTimerRef.current !== undefined) {
        window.clearTimeout(fullscreenExitTimerRef.current);
      }
      fullscreenExitTimerRef.current = window.setTimeout(() => {
        setFullscreenFrameSize(null);
        fullscreenExitTimerRef.current = undefined;
      }, 300);
      setFullscreenError(null);
    } catch (error) {
      setFullscreenError(error instanceof Error ? error.message : 'No se pudo salir de pantalla completa.');
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (Capacitor.isNativePlatform() || document.fullscreenElement || !isReaderFullscreenRef.current) return;
      isReaderFullscreenRef.current = false;
      setIsReaderFullscreen(false);
      if (fullscreenExitTimerRef.current !== undefined) {
        window.clearTimeout(fullscreenExitTimerRef.current);
      }
      fullscreenExitTimerRef.current = window.setTimeout(() => {
        setFullscreenFrameSize(null);
        fullscreenExitTimerRef.current = undefined;
      }, 300);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => () => {
    if (fullscreenExitTimerRef.current !== undefined) {
      window.clearTimeout(fullscreenExitTimerRef.current);
    }
    if (isReaderFullscreenRef.current) {
      void setReaderFullscreen(false);
    }
  }, []);

  useEffect(() => {
    if (!settings.autoAnalyzePage || isLoadingChapter) return;

    const spineIndex = currentSpineIndex;
    const page = currentPage;
    const timeout = window.setTimeout(() => {
      if (
        spineIndex !== currentSpineRef.current ||
        page !== currentPageRef.current ||
        wordSelectionModeRef.current ||
        pageWordsRef.current.length > 0
      ) return;

      void analyzeCurrentPage(false, true);
    }, 1200);

    return () => {
      window.clearTimeout(timeout);
      const activeRequest = automaticPageAnalysisRequestRef.current;
      if (activeRequest && activeRequest === pageAnalysisRequestRef.current) {
        pageAnalysisRequestRef.current += 1;
        automaticPageAnalysisRequestRef.current = 0;
        setIsAnalyzingPage(false);
      }
    };
  }, [
    analyzeCurrentPage,
    currentPage,
    currentSpineIndex,
    isLoadingChapter,
    settings.autoAnalyzePage,
  ]);

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

      const fitWidth = fullscreenFrameSize?.width || width;
      const fitHeight = fullscreenFrameSize?.height || height;
      const margin = 12;
      const headerHeight = header.getBoundingClientRect().height;
      const footerHeight = footer.getBoundingClientRect().height;
      const heightScale = (fitHeight - headerHeight - footerHeight - margin * 2) / fitHeight;
      const widthScale = (fitWidth - margin * 2) / fitWidth;
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
  }, [fullscreenFrameSize, showUi]);

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
        onOpenSearch={() => openSearch()}
        bookmarkCount={bookmarkItems.length}
        annotationCount={textAnnotations.length}
        onOpenHistory={() => setIsTranslationHistoryOpen(true)}
        historyCount={translationHistory.length}
        favoriteCount={translationFavorites.length}
        frequentCount={frequentQueries.filter((entry) => entry.count >= 2).length}
        onToggleSettings={() => setIsSettingsOpen(true)}
        onOpenFile={onCloseBook}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        isAnalyzingPage={isAnalyzingPage}
        isWordSelectionMode={isWordSelectionMode}
        onToggleAutoAnalysis={handleToggleAutoAnalysis}
        onOpenPageGlossary={handleOpenPageGlossary}
        googleDriveSession={googleDriveSession}
        isDriveBusy={isDriveBusy}
        syncError={syncError}
        onRetry={onRetry}
        lastSyncedDate={lastSyncedDate}
        isBookUploaded={isBookUploaded}
        onUploadBook={onUploadBook}
        language={settings.language}
      />

      {selectionEdgeIndicator && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed z-[75] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-white transition-[background-color,transform,box-shadow] duration-150 ${
            selectionEdgeActivation?.direction === selectionEdgeIndicator.direction
              ? 'scale-[2] bg-amber-500 shadow-[0_0_24px_rgba(245,158,11,0.95)]'
              : 'bg-indigo-600 shadow-[0_0_18px_rgba(79,70,229,0.85)]'
          }`}
          style={{ left: selectionEdgeIndicator.x, top: selectionEdgeIndicator.y }}
        >
          {selectionEdgeActivation?.direction === selectionEdgeIndicator.direction && (
            <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 44 44">
              <circle
                cx="22"
                cy="22"
                r="19.5"
                fill="none"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="2.5"
              />
              <circle
                cx="22"
                cy="22"
                r="19.5"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeDasharray="122.52"
                strokeDashoffset={122.52 * (1 - selectionEdgeActivation.progress)}
                strokeLinecap="round"
              />
            </svg>
          )}
          {(() => {
            const pointsLeft = (isVertical || isRtl)
              ? selectionEdgeIndicator.direction === 'next'
              : selectionEdgeIndicator.direction === 'previous';
            const isActivating = selectionEdgeActivation?.direction === selectionEdgeIndicator.direction;
            const arrowClass = `h-5 w-5 ${isActivating ? '' : pointsLeft ? 'selection-edge-arrow-left' : 'selection-edge-arrow-right'}`;
            return pointsLeft
              ? <ArrowLeft className={arrowClass} />
              : <ArrowRight className={arrowClass} />;
          })()}
        </div>
      )}

      {/* Compact progress stays available without opening the full controls. */}
      <div
        className={`fixed bottom-[max(env(safe-area-inset-bottom,0px),8px)] left-1/2 -translate-x-1/2 z-[45] rounded-full px-3 py-1 bg-black/45 text-white/90 backdrop-blur-md text-[10px] tabular-nums pointer-events-none transition-opacity ${
          showUi ? 'opacity-0' : 'opacity-100'
        }`}
        aria-live="polite"
      >
        {isBookPaginationReady && isReaderPositioned
          ? `${formatPageDisplay(globalPage, bookTotalPages, settings.paginationMode, printedPages, settings.language)} · ${t('footer.chapter', settings.language)}${displayChapter}/${displayChapterCount}`
          : isReaderPositioned
            ? t('reader.calculatingPage', settings.language)
            : t('common.loading', settings.language)}
      </div>

      {/* Menu toggle & Sync badge in bottom-left when UI is hidden (!showUi), hidden when UI appears */}
      <div 
        className={`fixed z-[999] flex items-center gap-2 bottom-[max(env(safe-area-inset-bottom,8px),8px)] left-3 transition-opacity pointer-events-auto ${
          showUi ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
        onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
        onTouchStart={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
        onTouchEnd={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
        onPointerDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
      >
        <button
          onClick={() => setShowUi(true)}
          onContextMenu={(event) => {
            event.preventDefault();
            setDebugEnabled((enabled) => !enabled);
          }}
          className="tap-area-free p-2 rounded-full backdrop-blur-md shadow-md transition-colors bg-zinc-900/40 text-white/80"
          title={t('nav.open', settings.language)}
          aria-label={t('nav.open', settings.language)}
        >
          <Menu className="w-4 h-4" />
        </button>

        {googleDriveSession && onRetry && (
          <SyncStatusBadge
            googleDriveSession={googleDriveSession}
            isDriveBusy={isDriveBusy}
            syncError={syncError}
            onRetry={onRetry}
            lastSyncedDate={lastSyncedDate}
            isBookUploaded={isBookUploaded}
            onUploadBook={onUploadBook}
            align="left"
            language={settings.language}
          />
        )}
      </div>

      {/* Close button when UI is shown */}
      {showUi && (
        <button
          onClick={() => setShowUi(false)}
          className="tap-area-free fixed z-[55] p-2 rounded-full backdrop-blur-md shadow-md transition-colors right-3 bottom-[118px] bg-white/90 text-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-200"
          title={t('nav.close', settings.language)}
          aria-label={t('nav.close', settings.language)}
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {!showUi && (
        <button
          type="button"
          onClick={() => void handleToggleReaderFullscreen()}
          className={`tap-area fixed z-[55] flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
            isReaderFullscreen
              ? 'bg-indigo-500/70 text-white'
              : 'bg-black/25 text-white/65 hover:bg-black/45 hover:text-white/90'
          }`}
          style={{
            bottom: 'max(env(safe-area-inset-bottom, 4px), 4px)',
            right: 'max(calc(env(safe-area-inset-right, 4px) + 48px), 48px)',
          }}
          title={isReaderFullscreen ? t('nav.exitFullscreen', settings.language) : t('nav.fullscreen', settings.language)}
          aria-label={isReaderFullscreen ? t('nav.exitFullscreen', settings.language) : t('nav.fullscreen', settings.language)}
          aria-pressed={isReaderFullscreen}
        >
          {isReaderFullscreen
            ? <Minimize2 className="h-4 w-4" />
            : <Maximize2 className="h-4 w-4" />}
        </button>
      )}

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
          title={isCurrentBookmarked ? t('reader.removeBookmark', settings.language) : t('reader.addBookmark', settings.language)}
          aria-label={isCurrentBookmarked ? t('reader.removeBookmark', settings.language) : t('reader.addBookmark', settings.language)}
          aria-pressed={isCurrentBookmarked}
        >
          {isCurrentBookmarked
            ? <BookmarkCheck className="h-4 w-4" />
            : <Bookmark className="h-4 w-4" />}
        </button>
      )}

      {/* Keep the viewport fixed so showing the controls never changes pagination. */}
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
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
        <div
          className="relative shrink-0 overflow-hidden"
          style={fullscreenFrameSize
            ? { width: `${fullscreenFrameSize.width}px`, height: `${fullscreenFrameSize.height}px` }
            : { width: '100%', height: '100%' }}
        >
          <iframe
            ref={iframeRef}
            title="EPUB Page View"
            className="block h-full w-full border-0"
            sandbox="allow-same-origin allow-scripts"
          />
          {isLoadingChapter && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-[2px] pointer-events-none">
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/90 dark:bg-zinc-800/90 shadow-lg text-xs font-medium text-zinc-700 dark:text-zinc-200">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                <span>{t('common.loading', settings.language)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {debugEnabled && (
        <div className="fixed top-2 left-2 z-[95] max-w-[78vw] rounded-lg bg-black/75 px-2 py-1.5 pointer-events-none">
          <div className="font-mono text-[9px] leading-[1.35] text-lime-200 whitespace-pre-wrap select-text">
            {debugLines.length ? debugLines.slice(-12).join('\n') : 'diagnóstico activo · selecciona texto…'}
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
      {wordAnalysisError && (
        <div
          role="alert"
          className="fixed bottom-24 left-1/2 z-[85] max-w-[90vw] -translate-x-1/2 rounded-xl bg-rose-950/95 px-4 py-2 text-center text-xs text-white shadow-lg"
        >
          {wordAnalysisError}
        </div>
      )}
      {fullscreenError && (
        <div
          role="alert"
          className="fixed bottom-24 left-1/2 z-[85] max-w-[90vw] -translate-x-1/2 rounded-xl bg-rose-950/95 px-4 py-2 text-center text-xs text-white shadow-lg"
        >
          {fullscreenError}
        </div>
      )}

      <TextSelectionMenu
        selectedText={selectedText}
        position={selectionPos}
        // The menu sits at z-60, above the translation modal (z-50), so with a
        // panel open it covered the bottom of the dictionary result. Fold it
        // away while any overlay is on screen, as it is already folded away
        // while the selection is being dragged.
        isAdjusting={isSelectionAdjusting || isTranslateOpen || isBookmarksOpen || isSearchOpen || isTranslationHistoryOpen || isPageGlossaryOpen || isTocOpen || isSettingsOpen || Boolean(imageViewerSrc)}
        dictionaryPreview={dictionaryPreview}
        isUnderlined={isSelectionUnderlined}
        language={settings.language}
        onToggleUnderline={handleToggleUnderline}
        onClose={() => {
          selectedTextRef.current = '';
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
        onSearchInBook={() => openSearch(selectedText)}
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
        openRouterModel={settings.openRouterModel}
        availableAiProviders={configuredAiProviders}
        aiApiKeys={settings.aiApiKeys}
        favorites={translationFavorites}
        frequentSearchToken={frequentSearchToken}
        language={settings.language}
        onSaveHistory={handleSaveTranslationHistory}
        onRecordFrequentQuery={handleRecordFrequentQuery}
        onToggleFavorite={handleToggleTranslationFavorite}
      />

      <TranslationHistoryModal
        isOpen={isTranslationHistoryOpen}
        entries={translationHistory}
        favorites={translationFavorites}
        frequentQueries={frequentQueries}
        language={settings.language}
        onClose={() => setIsTranslationHistoryOpen(false)}
        onRemove={handleRemoveTranslationHistoryEntry}
        onClear={handleClearTranslationHistory}
        onToggleFavorite={handleToggleTranslationFavorite}
        onClearFavorites={handleClearTranslationFavorites}
        onClearFrequentQueries={handleClearFrequentQueries}
      />

      <PageGlossaryModal
        isOpen={isPageGlossaryOpen}
        tokens={pageWords}
        favorites={translationFavorites}
        language={settings.language}
        onClose={() => setIsPageGlossaryOpen(false)}
        onSelectWord={selectPageWord}
        onToggleFavorite={handleToggleTranslationFavorite}
      />

      <BookSearchModal
        isOpen={isSearchOpen}
        initialQuery={searchSeed.text}
        openToken={searchSeed.token}
        spineCount={epub.spine.length}
        getChapterText={getChapterSearchText}
        getHitPages={getHitPages}
        getPageLabel={getSearchPageLabel}
        getChapterLabel={(spineIndex) => spineLabels[spineIndex] || `Sección ${spineIndex + 1}`}
        recentSearches={recentSearches}
        language={settings.language}
        onRememberSearch={handleRememberSearch}
        onRemoveRecent={handleRemoveRecentSearch}
        onClearRecents={handleClearRecentSearches}
        onClose={() => setIsSearchOpen(false)}
        onSelectHit={handleSelectSearchHit}
      />

      <BookmarksModal
        isOpen={isBookmarksOpen}
        bookmarks={bookmarkItems}
        annotations={annotationItems}
        language={settings.language}
        onClose={() => setIsBookmarksOpen(false)}
        onSelect={handleSelectBookmark}
        onRemove={handleRemoveBookmark}
        onSelectAnnotation={handleSelectTextAnnotation}
        onRemoveAnnotation={handleRemoveTextAnnotation}
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
        language={settings.language}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
        onSeekPage={handleSeekPage}
        onPrevChapter={handlePrevChapter}
        onNextChapter={handleNextChapter}
        bookmarkPages={bookmarkPageMarkers}
        paginationMode={settings.paginationMode}
        printedPages={printedPages}
        onTogglePaginationMode={handleTogglePaginationMode}
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
        resolveSpineIndex={resolveSpineIndex}
        getGlobalPage={getGlobalPage}
        bookTotalPages={bookTotalPages}
        paginationMode={settings.paginationMode}
        printedPages={printedPages}
        isBookPaginationReady={isBookPaginationReady}
      />

      <ReaderSettings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        selectedTheme={selectedTheme}
        onUpdateSettings={onUpdateSettings}
        printedPages={printedPages}
        onUpdatePrintedPages={handleUpdatePrintedPages}
      />
    </div>
  );
};
