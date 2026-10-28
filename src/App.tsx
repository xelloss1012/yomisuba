import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { ParsedEpub, ReaderSettingsState } from './types/epub';
import { extractEpubCoverBlob, parseEpub } from './utils/epubParser';
import { FileDropZone } from './components/FileDropZone';
import { EpubReader } from './components/EpubReader';
import { LanguageProvider } from './i18n/LanguageContext';
import { AVAILABLE_LANGUAGES, setActiveLanguage, t } from './utils/i18n';
import { SharedPayload, sharedToBook, watchSharedContent, checkPendingShared } from './utils/sharedContent';
import { setReaderAutoRotate } from './utils/readerOrientation';
import { createBookId, deleteRecentBook, getLastBookId, getRecentBook, listRecentBooks, loadRecentBook, MAX_SHELF_BOOKS, migrateBooksToNativeStorage, RecentBook, requestPersistentStorage, saveRecentBook, setLastBookId } from './utils/recentBooks';
import {
  deleteGoogleDriveBook,
  downloadGoogleDriveBook,
  findGoogleDriveBookForRecentBook,
  getGoogleDriveSettingsDate,
  GoogleDriveBook,
  GoogleDriveSession,
  googleDriveConfigured,
  listGoogleDriveBooks,
  loadGoogleDriveBookCover,
  createCoverThumbnailDataUrl,
  updateGoogleDriveBookCover,
  ReaderBookBackup,
  applyGoogleDriveReaderData,
  claimGoogleDriveWriter,
  clearPendingGoogleDriveReaderDataQueue,
  DriveWriter,
  getGoogleDriveLastWriter,
  getGoogleDriveReadingPosition,
  restoreGoogleDriveReaderData,
  restoreGoogleDriveSession,
  restoreGoogleDriveSettings,
  refreshGoogleDriveSession,
  queueGoogleDriveReaderData,
  syncPendingGoogleDriveReaderData,
  saveGoogleDriveReaderData,
  saveGoogleDriveSettings,
  signInToGoogleDrive,
  signOutGoogleDrive,
  uploadGoogleDriveBook,
} from './utils/googleDriveBackup';
import { getGoogleDriveAuthDiagnostics } from './utils/googleDriveDiagnostics';
import { writeClipboardText } from './utils/readerClipboard';
import { bookPage, BookPosition, describeDevice, getDeviceId } from './utils/driveDevice';
import { DriveConflict, DriveConflictModal } from './components/DriveConflictModal';

const SETTINGS_STORAGE_KEY = 'yomisuba_settings_v1';

const DEFAULT_SETTINGS: ReaderSettingsState = {
  writingMode: 'vertical-rl',
  progressionDirection: 'rtl',
  fontSize: 18,
  lineHeight: 1.9,
  fontFamily: 'mincho',
  showFurigana: true,
  autoAnalyzePage: false,
  autoRotate: false,
  theme: 'paper',
  autoNightMode: false,
  letterSpacing: 0.05,
  aiApiKeys: {},
  openRouterModel: 'openrouter/free',
  paginationMode: 'device',
  language: 'es',
};

// A device that had never been used: nothing of its own can be lost by loading what Drive has.
const FRESH_DEVICE = (() => {
  try {
    return !localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return false;
  }
})();

// How often, at most, saving checks whether another device has written to Drive in between.
const WRITER_CHECK_INTERVAL_MS = 2 * 60 * 1000;

const isNightTime = () => {
  const hour = new Date().getHours();
  return hour >= 20 || hour < 8;
};

// The offline notice in any language, so it is cleared once the connection is back.
const OFFLINE_MESSAGES = AVAILABLE_LANGUAGES.map(({ code }) => t('sync.offline', code));

export const App: React.FC = () => {
  const [currentEpub, setCurrentEpub] = useState<ParsedEpub | null>(null);
  const [currentBookId, setCurrentBookId] = useState<string | null>(null);
  const openBookRequestIdRef = React.useRef(0);
  const isOpeningSharedRef = React.useRef(false);
  // Nothing is loaded from or saved to Drive automatically until it is settled whose data Drive keeps:
  // this device's, or what another device saved (the person is asked).
  const driveDecidedRef = React.useRef(false);
  const driveDecisionRef = React.useRef<Promise<void> | null>(null);
  const lastWriterCheckRef = React.useRef(0);
  const [driveConflict, setDriveConflict] = useState<DriveConflict | null>(null);
  const driveConflictAnswerRef = React.useRef<((choice: 'load' | 'keep') => void) | null>(null);
  const currentEpubRef = React.useRef<ParsedEpub | null>(null);
  const currentBookIdRef = React.useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isGoogleDriveSignInPending, setIsGoogleDriveSignInPending] = useState(false);
  const [recentBooks, setRecentBooks] = useState<RecentBook[]>([]);
  const [googleDriveSession, setGoogleDriveSession] = useState<GoogleDriveSession | null>(null);
  const googleDriveSessionRef = React.useRef<GoogleDriveSession | null>(null);
  const [googleDriveSettingsDate, setGoogleDriveSettingsDate] = useState<string | null>(null);
  const [googleDriveBooks, setGoogleDriveBooks] = useState<GoogleDriveBook[]>([]);
  const recentBooksRef = React.useRef<RecentBook[]>([]);
  const cloudCoverAttemptsRef = React.useRef<Set<string>>(new Set());
  const [isDriveBusy, setIsDriveBusy] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const settingsRevisionRef = React.useRef(0);
  const [driveSettingsReady, setDriveSettingsReady] = useState(false);
  const driveSessionRefreshPromiseRef = React.useRef<Promise<void> | null>(null);
  googleDriveSessionRef.current = googleDriveSession;
  recentBooksRef.current = recentBooks;
  currentEpubRef.current = currentEpub;
  currentBookIdRef.current = currentBookId;

  const [settings, setSettings] = useState<ReaderSettingsState>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS;
  });
  const settingsRef = React.useRef(settings);
  settingsRef.current = settings;
  const [nightTime, setNightTime] = useState(isNightTime);
  // Errors thrown by the utilities are written in this language.
  setActiveLanguage(settings.language);
  const effectiveSettings = settings.autoNightMode && nightTime
    ? { ...settings, theme: 'dark' as const }
    : settings;

  // Save settings changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    void setReaderAutoRotate(settings.autoRotate).catch((error: unknown) => {
      setErrorMessage(t('sync.orientationError', settings.language, { message: error instanceof Error ? error.message : String(error) }));
    });
  }, [settings.autoRotate]);

  useEffect(() => {
    if (!googleDriveSession || !driveSettingsReady || settingsRevision === 0 || !isOnline) return;
    const timer = window.setTimeout(() => {
      setIsDriveBusy(true);
      void checkDriveWriter(googleDriveSession)
        .then((stillWriter) => (stillWriter ? saveGoogleDriveSettings(googleDriveSession.accessToken, settings) : null))
        .then((date) => {
          if (date === null) return;
          setGoogleDriveSettingsDate(date);
          setSyncError(null);
        })
        .catch((error: unknown) => {
          setSyncError(t('sync.saveSettingsError', settings.language, { message: error instanceof Error ? error.message : String(error) }));
        })
        .finally(() => {
          setIsDriveBusy(false);
        });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [googleDriveSession, driveSettingsReady, settings, settingsRevision, isOnline]);

  useEffect(() => {
    if (effectiveSettings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [effectiveSettings.theme]);

  useEffect(() => {
    const updateNightTime = () => setNightTime(isNightTime());
    const intervalId = window.setInterval(updateNightTime, 60_000);
    document.addEventListener('visibilitychange', updateNightTime);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', updateNightTime);
    };
  }, []);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    if (!isOnline && googleDriveSession) {
      setSyncError(t('sync.offline', settings.language));
    } else if (isOnline && syncError && OFFLINE_MESSAGES.includes(syncError)) {
      setSyncError(null);
    }
  }, [isOnline, googleDriveSession, syncError, settings.language]);

  const thisDevice = (): DriveWriter => ({
    deviceId: getDeviceId(),
    deviceName: describeDevice(navigator.userAgent),
    savedAt: new Date().toISOString(),
  });

  const describeBookPosition = (position: BookPosition, chapterPageCounts: number[] | undefined): string => {
    const language = settingsRef.current.language;
    const whole = bookPage(position, chapterPageCounts);
    return whole
      ? t('driveConflict.page', language, whole)
      : t('driveConflict.chapterPage', language, { page: position.page + 1, chapter: position.spineIndex + 1 });
  };

  /** Asks whether what another device saved replaces this device's data, saying where the book being read would go. */
  const askDriveConflict = async (session: GoogleDriveSession, writer: DriveWriter | null): Promise<'load' | 'keep'> => {
    let book: DriveConflict['book'];
    try {
      const epub = currentEpubRef.current;
      const lastBookId = getLastBookId();
      const last = lastBookId ? recentBooksRef.current.find((item) => item.id === lastBookId) : undefined;
      const identity = epub
        ? { title: epub.metadata.title, creator: epub.metadata.creator }
        : last ? { title: last.title, creator: last.creator } : null;
      if (identity) {
        const bookKey = `yomisuba_book_${encodeURIComponent(`${identity.title}|${identity.creator}`)}`;
        const remote = await getGoogleDriveReadingPosition(session.accessToken, { bookKey, ...identity });
        let local: BookPosition | null = null;
        try {
          const stored: unknown = JSON.parse(localStorage.getItem(`${bookKey}_position`) || 'null');
          if (stored && typeof stored === 'object' && typeof (stored as BookPosition).spineIndex === 'number'
            && typeof (stored as BookPosition).page === 'number') local = stored as BookPosition;
        } catch {
          // Without a position here the question only says where Drive's is.
        }
        const counts = remote?.chapterPageCounts;
        book = {
          title: identity.title,
          to: remote ? describeBookPosition(remote.position, counts) : null,
          from: local ? describeBookPosition(local, counts) : null,
        };
      }
    } catch {
      // The question still makes sense without the page.
    }
    return new Promise((resolve) => {
      driveConflictAnswerRef.current = resolve;
      setDriveConflict({ deviceName: writer?.deviceName ?? null, savedAt: writer?.savedAt ?? null, book });
    });
  };

  const answerDriveConflict = (choice: 'load' | 'keep') => {
    setDriveConflict(null);
    const answer = driveConflictAnswerRef.current;
    driveConflictAnswerRef.current = null;
    answer?.(choice);
  };

  /**
   * Whose data Drive keeps. The same device, or a device that has nothing yet, loads it as always;
   * after another device (or an older version that did not say which) the person decides.
   */
  const decideDriveSync = async (
    session: GoogleDriveSession,
    writer: DriveWriter | null,
    driveHasData: boolean,
  ): Promise<'load' | 'keep'> => {
    if (writer?.deviceId === getDeviceId()) return 'load';
    if (!writer && (FRESH_DEVICE || !driveHasData)) return 'load';
    return askDriveConflict(session, writer);
  };

  /** Opens again the book being read, so that it shows the data just taken from Drive. */
  const reopenCurrentBook = async () => {
    const id = currentBookIdRef.current;
    if (!id) return;
    const book = await getRecentBook(id);
    if (book) await openBookRef.current(book.blob, book.id, book.name, true);
  };

  const loadDriveData = async (session: GoogleDriveSession, restoreSettings = true): Promise<void> => {
    setIsDriveBusy(true);
    try {
      const [settingsDateResult, booksResult, writerResult] = await Promise.allSettled([
        getGoogleDriveSettingsDate(session.accessToken),
        listGoogleDriveBooks(session.accessToken),
        getGoogleDriveLastWriter(session.accessToken),
      ]);

      if (settingsDateResult.status === 'fulfilled') {
        setGoogleDriveSettingsDate(settingsDateResult.value);
      }
      if (booksResult.status === 'fulfilled') {
        setGoogleDriveBooks(booksResult.value);
      }

      const writer = writerResult.status === 'fulfilled' ? writerResult.value : null;
      // Another device has written since this one settled it: ask again before loading or saving anything.
      const anotherWriter = Boolean(writer && writer.deviceId !== getDeviceId());
      const mustDecide = restoreSettings || !driveDecidedRef.current || anotherWriter;
      if (mustDecide && settingsDateResult.status === 'fulfilled' && writerResult.status === 'fulfilled') {
        if (driveDecisionRef.current) {
          await driveDecisionRef.current;
        } else {
          const settingsDate = settingsDateResult.value;
          const decision = (async () => {
            driveDecidedRef.current = false;
            setDriveSettingsReady(false);
            const choice = await decideDriveSync(session, writer, Boolean(settingsDate));
            let settingsLoaded = choice === 'keep' || !settingsDate;
            if (choice === 'load') {
              clearPendingGoogleDriveReaderDataQueue();
              if (settingsDate) {
                try {
                  const restored = await restoreGoogleDriveSettings(session.accessToken);
                  // The direction of the text comes from the book being read, not from the other device.
                  setSettings((current) => ({
                    ...DEFAULT_SETTINGS,
                    ...restored,
                    ...(currentEpubRef.current
                      ? { writingMode: current.writingMode, progressionDirection: current.progressionDirection }
                      : {}),
                  }));
                  settingsLoaded = true;
                } catch (error) {
                  if (navigator.onLine) {
                    setSyncError(t('sync.restoreSettingsError', settingsRef.current.language, { message: error instanceof Error ? error.message : String(error) }));
                  }
                }
              }
            }
            // Undecided, nothing is loaded and nothing is saved: the next attempt asks again.
            if (!settingsLoaded) return;
            try {
              await claimGoogleDriveWriter(session.accessToken, thisDevice());
            } catch {
              // Saving still works; the next check simply finds no claim of this device.
            }
            lastWriterCheckRef.current = Date.now();
            if (choice === 'load') {
              await reopenCurrentBook();
              // What the closed reader left queued is older than what was just loaded.
              clearPendingGoogleDriveReaderDataQueue();
            }
            driveDecidedRef.current = true;
            setDriveSettingsReady(true);
            // Saves the settings now in use, so that Drive holds this device's after "keep".
            settingsRevisionRef.current += 1;
            setSettingsRevision(settingsRevisionRef.current);
            if (choice === 'keep') {
              void syncPendingGoogleDriveReaderData(session.accessToken).catch(() => undefined);
            }
          })();
          driveDecisionRef.current = decision;
          try {
            await decision;
          } finally {
            driveDecisionRef.current = null;
          }
        }
      }

      if (navigator.onLine) {
        const failures = [settingsDateResult, booksResult, writerResult].filter((result) => result.status === 'rejected');
        if (failures.length) {
          const reason = failures[0].status === 'rejected' ? failures[0].reason : null;
          setSyncError(t('sync.driveUnavailable', settingsRef.current.language, { message: reason instanceof Error ? reason.message : String(reason) }));
        } else {
          setSyncError(null);
        }
      }
    } finally {
      setIsDriveBusy(false);
    }
  };

  /**
   * Before saving: whether this device is still the one whose data Drive keeps. Checked at most every
   * few minutes; when another device has written meanwhile, the question comes up and nothing is saved.
   */
  const checkDriveWriter = async (session: GoogleDriveSession): Promise<boolean> => {
    if (!driveDecidedRef.current) return false;
    if (Date.now() - lastWriterCheckRef.current < WRITER_CHECK_INTERVAL_MS) return true;
    lastWriterCheckRef.current = Date.now();
    try {
      const writer = await getGoogleDriveLastWriter(session.accessToken);
      if (!writer || writer.deviceId === getDeviceId()) return true;
    } catch {
      return true;
    }
    driveDecidedRef.current = false;
    void loadDriveData(session, true);
    return false;
  };

  const handleRetrySync = () => {
    setSyncError(null);
    const session = googleDriveSessionRef.current;
    if (session) {
      void loadDriveData(session).catch((error: unknown) => {
        setSyncError(error instanceof Error ? error.message : String(error));
      });
    }
  };

  useEffect(() => {
    let cancelled = false;
    let restoring: Promise<void> | null = null;
    const restoreDriveSession = (): Promise<void> => {
      if (!navigator.onLine || restoring) return restoring || Promise.resolve();
      const currentRestore = (async () => {
        const session = await restoreGoogleDriveSession();
        if (cancelled) return;
        googleDriveSessionRef.current = session;
        setGoogleDriveSession(session);
        if (!session) {
          setDriveSettingsReady(false);
          setGoogleDriveSettingsDate(null);
          setGoogleDriveBooks([]);
          setSyncError(null);
          return;
        }
        await loadDriveData(session);
      })();
      restoring = currentRestore;
      driveSessionRefreshPromiseRef.current = currentRestore;
      void currentRestore.catch((error: unknown) => {
        if (!cancelled && navigator.onLine) {
          setSyncError(t('sync.connectError', settings.language, { message: error instanceof Error ? error.message : String(error) }));
        }
      }).finally(() => {
        if (restoring === currentRestore) restoring = null;
        if (driveSessionRefreshPromiseRef.current === currentRestore) driveSessionRefreshPromiseRef.current = null;
      });
      return currentRestore;
    };
    const handleOnline = () => {
      const session = googleDriveSessionRef.current;
      if (session) {
        void loadDriveData(session, false).catch((error: unknown) => {
          if (navigator.onLine) {
            setSyncError(t('sync.connectError', settings.language, { message: error instanceof Error ? error.message : String(error) }));
          }
        });
      } else {
        void restoreDriveSession();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !googleDriveSessionRef.current) {
        void restoreDriveSession();
      }
    };
    if (navigator.onLine) void restoreDriveSession();
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!googleDriveSession || !isOnline || !driveDecidedRef.current) return;
    setIsDriveBusy(true);
    void syncPendingGoogleDriveReaderData(googleDriveSession.accessToken)
      .then(() => setSyncError(null))
      .catch((error: unknown) => {
        if (navigator.onLine) {
          setSyncError(t('sync.pending', settings.language, { message: error instanceof Error ? error.message : String(error) }));
        }
      })
      .finally(() => {
        setIsDriveBusy(false);
      });
  }, [googleDriveSession, isOnline]);

  // When Google Drive session becomes active while a book is open, check if reader data can be synced
  useEffect(() => {
    if (!googleDriveSession || !currentEpub || !currentBookId || !navigator.onLine || !driveDecidedRef.current) return;
    const title = currentEpub.metadata.title;
    const creator = currentEpub.metadata.creator;
    const bookKey = `yomisuba_book_${encodeURIComponent(`${title}|${creator}`)}`;
    const pos = localStorage.getItem(`${bookKey}_position`);
    const bm = localStorage.getItem(`${bookKey}_bookmark`);
    const an = localStorage.getItem(`${bookKey}_annotations`);
    const fav = localStorage.getItem(`${bookKey}_translation_favorites`);
    const isLocalEmpty = (!pos || (pos.includes('"page":0') && pos.includes('"spineIndex":0'))) && !bm && !an && !fav;

    if (isLocalEmpty) {
      void restoreGoogleDriveReaderData(googleDriveSession.accessToken, {
        bookKey,
        title,
        creator,
      }).then((readerData) => {
        if (readerData) {
          applyGoogleDriveReaderData(readerData);
          setSettingsRevision((rev) => rev + 1);
        }
      }).catch(() => undefined);
    }
  }, [googleDriveSession, currentEpub, currentBookId]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!navigator.onLine || document.visibilityState !== 'visible' || !googleDriveSessionRef.current || driveSessionRefreshPromiseRef.current) return;
      const refresh = refreshGoogleDriveSession()
        .then((session) => {
          if (session) {
            googleDriveSessionRef.current = session;
            setGoogleDriveSession(session);
            void loadDriveData(session, false);
          } else {
            googleDriveSessionRef.current = null;
            setGoogleDriveSession(null);
            setDriveSettingsReady(false);
            setGoogleDriveSettingsDate(null);
            setGoogleDriveBooks([]);
            setSyncError(null);
          }
        })
        .catch((error: unknown) => {
          setSyncError(t('sync.renewError', settings.language, { message: error instanceof Error ? error.message : String(error) }));
        })
        .finally(() => {
          driveSessionRefreshPromiseRef.current = null;
        });
      driveSessionRefreshPromiseRef.current = refresh;
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Books managed by the app normally include their cover in metadata. If an older
  // managed book does not, load it once and cache the thumbnail on the Drive file.
  useEffect(() => {
    if (!googleDriveSession) return;
    const pending = googleDriveBooks.filter(
      (book) => !book.coverDataUrl && !cloudCoverAttemptsRef.current.has(book.id),
    );
    if (!pending.length) return;
    let cancelled = false;
    const hydrateDriveCovers = async () => {
      for (const cloudBook of pending) {
        if (cancelled) return;
        cloudCoverAttemptsRef.current.add(cloudBook.id);
        const localBook = recentBooksRef.current.find(
          (book) => book.cover && book.title === cloudBook.title && book.creator === cloudBook.creator,
        );
        const localCover = localBook?.cover;
        try {
          const coverDataUrl = localCover
            ? await createCoverThumbnailDataUrl(localCover)
            : await loadGoogleDriveBookCover(googleDriveSession.accessToken, cloudBook);
          if (cancelled || !coverDataUrl) continue;
          if (localCover) {
            void updateGoogleDriveBookCover(googleDriveSession.accessToken, cloudBook, coverDataUrl)
              .catch(() => undefined);
          }
          setGoogleDriveBooks((books) =>
            books.map((item) => (item.id === cloudBook.id ? { ...item, coverDataUrl } : item)),
          );
        } catch {
          // Keep the placeholder icon when a cover cannot be read from Drive.
        }
      }
    };
    void hydrateDriveCovers();
    return () => { cancelled = true; };
  }, [googleDriveSession, googleDriveBooks]);

  // Screen Wake Lock to keep screen awake while app is active
  useEffect(() => {
    let wakeLock: any = null;
    let isReleased = false;

    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !isReleased) {
        try {
          wakeLock = await (navigator as any).wakeLock.request('screen');
          wakeLock?.addEventListener('release', () => {
            wakeLock = null;
          });
        } catch (err) {
          // Wake lock request might fail (e.g. low battery, tab not active)
        }
      }
    };

    void requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock();
      } else {
        if (wakeLock) {
          void wakeLock.release();
          wakeLock = null;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isReleased = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) {
        void wakeLock.release();
        wakeLock = null;
      }
    };
  }, []);

  const handleUpdateSettings = (newSettings: Partial<ReaderSettingsState>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
    settingsRevisionRef.current += 1;
    setSettingsRevision(settingsRevisionRef.current);
  };

  const openBook = async (fileOrBlob: File | Blob, preferredId?: string, preferredName?: string, forceDriveRestore = false) => {
    const requestId = ++openBookRequestIdRef.current;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (currentEpub) {
        currentEpub.close();
        setCurrentEpub(null);
        setCurrentBookId(null);
      }

      const buffer = await fileOrBlob.arrayBuffer();
      if (requestId !== openBookRequestIdRef.current) return;
      const parsed = await parseEpub(buffer);
      if (requestId !== openBookRequestIdRef.current) return;

      let driveSession = googleDriveSession;
      if (!driveSession && driveSessionRefreshPromiseRef.current && navigator.onLine) {
        try {
          await driveSessionRefreshPromiseRef.current;
          driveSession = googleDriveSessionRef.current;
        } catch {
          // continue with local data
        }
      }
      if (requestId !== openBookRequestIdRef.current) return;

      // Drive's reading data is only taken once it is settled that Drive's data is wanted.
      if (driveSession && navigator.onLine && (driveDecidedRef.current || forceDriveRestore)) {
        try {
          const readerData = await restoreGoogleDriveReaderData(driveSession.accessToken, {
            bookKey: `yomisuba_book_${encodeURIComponent(`${parsed.metadata.title}|${parsed.metadata.creator}`)}`,
            title: parsed.metadata.title,
            creator: parsed.metadata.creator,
          });
          if (readerData) applyGoogleDriveReaderData(readerData);
        } catch (error) {
          if (navigator.onLine) {
            setSyncError(t('sync.readingUpdateError', settings.language, { message: error instanceof Error ? error.message : String(error) }));
          }
        }
      }
      if (requestId !== openBookRequestIdRef.current) return;

      const name = preferredName || (fileOrBlob instanceof File ? fileOrBlob.name : `${parsed.metadata.title}.epub`);
      const id = preferredId || createBookId(name, parsed.metadata.title, parsed.metadata.creator);
      const recentBook: RecentBook = {
        id,
        name,
        title: parsed.metadata.title,
        creator: parsed.metadata.creator,
        lastOpened: Date.now(),
        blob: new Blob([buffer], { type: 'application/epub+zip' }),
        cover: parsed.coverBlob,
      };
      try {
        await saveRecentBook(recentBook);
        if (requestId !== openBookRequestIdRef.current) return;
        // Read it back: a write that did not stick would only show up at the next launch, as a missing book.
        if (!(await getRecentBook(id))) throw new Error('The book was not found after saving it.');
        setLastBookId(id);
        void requestPersistentStorage();
      } catch (err) {
        console.warn('No se pudo guardar el libro en la biblioteca local:', err);
        setErrorMessage(t('shelf.saveFailed', settings.language));
      }
      if (requestId !== openBookRequestIdRef.current) return;
      setRecentBooks((books) => [recentBook, ...books.filter((book) => book.id !== id)].slice(0, MAX_SHELF_BOOKS));

      // Auto-detect writing mode and progression direction based on language and metadata
      const lang = parsed.metadata.language?.toLowerCase() || '';
      const isJapaneseOrRtl =
        lang.startsWith('ja') ||
        lang.startsWith('zh') ||
        parsed.metadata.direction === 'rtl';

      if (isJapaneseOrRtl) {
        handleUpdateSettings({
          writingMode: 'vertical-rl',
          progressionDirection: 'rtl',
          fontFamily: 'mincho',
        });
      } else {
        handleUpdateSettings({
          writingMode: 'horizontal-tb',
          progressionDirection: 'ltr',
          fontFamily: 'serif',
        });
      }
      setCurrentBookId(id);
      setCurrentEpub(parsed);
    } catch (err: any) {
      if (requestId !== openBookRequestIdRef.current) return;
      console.error('Error al abrir el archivo EPUB:', err);
      setErrorMessage(
        err?.message || t('drive.alertReadEpubError', settings.language)
      );
    } finally {
      if (requestId === openBookRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  const openBookRef = React.useRef(openBook);
  openBookRef.current = openBook;

  const handleFileLoaded = (fileOrBlob: File | Blob) => {
    void openBook(fileOrBlob);
  };

  // What other apps share with Yomisuba (text, an address, a file) opens as a book.
  const openSharedRef = React.useRef<(payload: SharedPayload) => void>(() => undefined);
  openSharedRef.current = (payload) => {
    isOpeningSharedRef.current = true;
    const language = settings.language;
    setIsLoading(true);
    const failed = (message: string) => setErrorMessage(t('import.sharedFailed', language, { message }));
    if (payload.error) { setIsLoading(false); failed(payload.error); return; }
    sharedToBook(payload, {
      textAuthor: t('import.textFileAuthor', language),
      htmlAuthor: t('import.htmlFileAuthor', language),
      fallbackAuthor: t('import.htmlFileAuthor', language),
      pastedAuthor: t('import.pastedAuthor', language),
    }).then((file) => openBook(file), (error) => {
      setIsLoading(false);
      failed(error instanceof Error ? error.message : String(error));
    });
  };
  useEffect(() => watchSharedContent((payload) => openSharedRef.current(payload)), []);

  useEffect(() => {
    let cancelled = false;
    const restoreLibrary = async () => {
      try {
        const books = await listRecentBooks(MAX_SHELF_BOOKS);
        if (cancelled) return;
        const visibleBooks = books.slice(0, MAX_SHELF_BOOKS);
        setRecentBooks(visibleBooks);
        // Books that an earlier version left in the WebView's storage move to the app's own files,
        // in the background: they are listed meanwhile.
        void migrateBooksToNativeStorage();

        const hydrateCovers = async () => {
          for (const book of visibleBooks) {
            if (book.cover) continue;
            let full: RecentBook;
            try {
              full = await loadRecentBook(book);
            } catch {
              continue;
            }
            const cover = await extractEpubCoverBlob(full.blob);
            if (cancelled || !cover) continue;
            try {
              const stored = await getRecentBook(book.id);
              await saveRecentBook({ ...(stored || full), cover: stored?.cover || cover });
            } catch {
              // Cover display still works from memory if persistence fails.
            }
            if (cancelled) return;
            setRecentBooks((current) =>
              current.map((item) => (item.id === book.id && !item.cover ? { ...item, cover } : item))
            );
          }
        };
        void hydrateCovers();

        // If the app was launched by a share action from another app, do not restore the last book;
        // the shared content will open as its own book instead.
        const pendingShared = await checkPendingShared();
        if (pendingShared || isOpeningSharedRef.current || cancelled) return;

        const lastBookId = getLastBookId();
        if (lastBookId) {
          const listed = books.find((book) => book.id === lastBookId);
          const lastBook = listed && listed.blobLoaded !== false ? listed : await getRecentBook(lastBookId);
          if (lastBook && !cancelled && !isOpeningSharedRef.current) {
            await openBook(lastBook.blob, lastBook.id, lastBook.name);
          }
        }
      } catch (err) {
        console.warn('No se pudo restaurar la biblioteca local:', err);
        setErrorMessage(t('shelf.restoreFailed', settings.language));
      }
    };
    void requestPersistentStorage();
    void restoreLibrary();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenRecent = (book: RecentBook) => {
    void (async () => {
      try {
        const full = await loadRecentBook(book);
        await openBook(full.blob, full.id, full.name);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  const handleRemoveRecentBook = async (book: RecentBook) => {
    setIsDriveBusy(true);
    setErrorMessage(null);
    try {
      let cloudBook: GoogleDriveBook | null = null;
      if (googleDriveSession) {
        cloudBook = await findGoogleDriveBookForRecentBook(googleDriveSession.accessToken, book);
      }

      // Cancelling must cancel: the first question is only about this device, the second (when the book
      // has a copy in Drive) about Drive, and refusing it keeps that copy.
      const confirmed = window.confirm(t(
        googleDriveSession ? 'drive.confirmRemoveRecent' : 'drive.confirmRemoveRecentNoSession',
        settings.language,
        { title: book.title },
      ));
      if (!confirmed) return;
      const deleteDriveCopy = Boolean(cloudBook) && window.confirm(
        t('drive.confirmDeleteBook', settings.language, { title: book.title }),
      );

      if (deleteDriveCopy && cloudBook && googleDriveSession) {
        await deleteGoogleDriveBook(googleDriveSession.accessToken, cloudBook);
        setGoogleDriveBooks(await listGoogleDriveBooks(googleDriveSession.accessToken));
      }
      await deleteRecentBook(book.id);
      setRecentBooks((books) => books.filter((item) => item.id !== book.id));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDriveBusy(false);
    }
  };

  const handleCloseBook = () => {
    if (currentEpub) {
      currentEpub.close();
      setCurrentEpub(null);
    }
    setCurrentBookId(null);
  };

  const runDriveAction = async (action: () => Promise<void>) => {
    setIsDriveBusy(true);
    try {
      await action();
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDriveBusy(false);
    }
  };

  const handleGoogleDriveSignIn = () => {
    setSyncError(null);
    setIsGoogleDriveSignInPending(true);
    void runDriveAction(async () => {
      const session = await signInToGoogleDrive();
      setGoogleDriveSession(session);
      googleDriveSessionRef.current = session;
      void loadDriveData(session);
    }).finally(() => setIsGoogleDriveSignInPending(false));
  };

  const handleCopyGoogleDriveDiagnostics = async () => {
    await writeClipboardText(getGoogleDriveAuthDiagnostics());
  };

  const handleGoogleDriveSignOut = () => {
    void runDriveAction(async () => {
      await signOutGoogleDrive();
      driveDecidedRef.current = false;
      googleDriveSessionRef.current = null;
      setGoogleDriveSession(null);
      setDriveSettingsReady(false);
      setGoogleDriveSettingsDate(null);
      setGoogleDriveBooks([]);
    });
  };

  const handleRestoreDriveSettings = () => {
    if (!googleDriveSession || !window.confirm(t('drive.confirmRestoreSettings', settings.language))) return;
    void runDriveAction(async () => {
      const restored = await restoreGoogleDriveSettings(googleDriveSession.accessToken);
      setSettings({ ...DEFAULT_SETTINGS, ...restored });
      await claimGoogleDriveWriter(googleDriveSession.accessToken, thisDevice()).catch(() => undefined);
      lastWriterCheckRef.current = Date.now();
      driveDecidedRef.current = true;
      setDriveSettingsReady(true);
      settingsRevisionRef.current += 1;
      setSettingsRevision(settingsRevisionRef.current);
    });
  };

  const handleUploadDriveBook = (book: RecentBook) => {
    if (!googleDriveSession) return;
    void runDriveAction(async () => {
      await uploadGoogleDriveBook(googleDriveSession.accessToken, await loadRecentBook(book));
      setGoogleDriveBooks(await listGoogleDriveBooks(googleDriveSession.accessToken));
    });
  };

  const handleDeleteDriveBook = (cloudBook: GoogleDriveBook) => {
    if (!googleDriveSession || !window.confirm(
      t('drive.confirmDeleteBook', settings.language, { title: cloudBook.title }),
    )) return;
    void runDriveAction(async () => {
      await deleteGoogleDriveBook(googleDriveSession.accessToken, cloudBook);
      setGoogleDriveBooks(await listGoogleDriveBooks(googleDriveSession.accessToken));
    });
  };

  const handleDownloadDriveBook = (cloudBook: GoogleDriveBook) => {
    if (!googleDriveSession || !window.confirm(
      t('drive.confirmDownloadBook', settings.language, { title: cloudBook.title }),
    )) return;
    void runDriveAction(async () => {
      const book = await downloadGoogleDriveBook(googleDriveSession.accessToken, cloudBook);
      setRecentBooks((books) => [book, ...books.filter((item) => item.id !== book.id)].slice(0, MAX_SHELF_BOOKS));
      await openBook(book.blob, book.id, book.name);
    });
  };

  const handleBookDataChange = (data: ReaderBookBackup) => {
    queueGoogleDriveReaderData(data);
    if (!googleDriveSession || !navigator.onLine || !driveDecidedRef.current) return;
    void checkDriveWriter(googleDriveSession).then((stillWriter) => {
      if (stillWriter) return saveGoogleDriveReaderData(googleDriveSession.accessToken, data);
      return undefined;
    }).catch((error: unknown) => {
      if (navigator.onLine) {
        setSyncError(t('sync.saveProgressError', settings.language, { message: error instanceof Error ? error.message : String(error) }));
      }
    });
  };

  const handleRefreshDriveBooks = () => {
    if (!googleDriveSession) return;
    void runDriveAction(async () => {
      await loadDriveData(googleDriveSession, false);
    });
  };

  const isCurrentBookUploaded = React.useMemo(() => {
    if (!currentEpub || !googleDriveBooks.length) return false;
    const title = currentEpub.metadata.title?.toLowerCase().trim();
    return googleDriveBooks.some((b) => {
      const bTitle = b.title?.toLowerCase().trim();
      return Boolean(title && bTitle && (bTitle === title || bTitle.includes(title) || title.includes(bTitle)));
    });
  }, [currentEpub, googleDriveBooks]);

  const handleUploadCurrentBook = () => {
    if (!googleDriveSession || !currentEpub) return;
    const currentBook = recentBooks.find((b) => b.title === currentEpub.metadata.title);
    if (!currentBook) {
      alert(t('drive.alertNoLocalBook', settings.language));
      return;
    }
    handleUploadDriveBook(currentBook);
  };

  return (
    <LanguageProvider language={settings.language} translationLanguage={settings.translationLanguage}>
      <div className="fixed inset-0 w-full h-full overflow-hidden select-none bg-stone-100 dark:bg-zinc-950">
        {errorMessage && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md bg-red-600 text-white text-xs px-4 py-3 rounded-xl shadow-xl flex items-center justify-between gap-3 animate-bounce">
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-white/80 hover:text-white font-bold text-sm"
            >
              ✕
            </button>
          </div>
        )}

        {currentEpub && currentBookId ? (
          <EpubReader
            key={currentBookId}
            epub={currentEpub}
            onCloseBook={handleCloseBook}
            settings={effectiveSettings}
            selectedTheme={settings.theme}
            onUpdateSettings={handleUpdateSettings}
            onBookDataChange={handleBookDataChange}
            googleDriveSession={googleDriveSession}
            isDriveBusy={isDriveBusy}
            syncError={syncError}
            onRetry={handleRetrySync}
            lastSyncedDate={googleDriveSettingsDate}
            isBookUploaded={isCurrentBookUploaded}
            onUploadBook={handleUploadCurrentBook}
          />
        ) : (
          <FileDropZone
            onFileLoaded={handleFileLoaded}
            onOpenRecent={handleOpenRecent}
            onRemoveRecentBook={(book) => { void handleRemoveRecentBook(book); }}
            recentBooks={recentBooks}
            isLoading={isLoading}
            googleDriveConfigured={googleDriveConfigured}
            googleDriveSession={googleDriveSession}
            googleDriveSettingsDate={googleDriveSettingsDate}
            googleDriveBooks={googleDriveBooks}
            isDriveBusy={isDriveBusy}
            isGoogleDriveSignInPending={isGoogleDriveSignInPending}
            googleDriveError={syncError}
            onCopyGoogleDriveDiagnostics={handleCopyGoogleDriveDiagnostics}
            onGoogleDriveSignIn={handleGoogleDriveSignIn}
            onGoogleDriveSignOut={handleGoogleDriveSignOut}
            onRestoreDriveSettings={handleRestoreDriveSettings}
            onUploadDriveBook={handleUploadDriveBook}
            onDownloadDriveBook={handleDownloadDriveBook}
            onDeleteDriveBook={handleDeleteDriveBook}
            onRefreshDriveBooks={handleRefreshDriveBooks}
            onUpdateSettings={handleUpdateSettings}
          />
        )}
      </div>
      <DriveConflictModal
        conflict={driveConflict}
        onLoad={() => answerDriveConflict('load')}
        onKeep={() => answerDriveConflict('keep')}
      />
    </LanguageProvider>
  );
};

export default App;
