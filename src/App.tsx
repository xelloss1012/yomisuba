import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { ParsedEpub, ReaderSettingsState } from './types/epub';
import { extractEpubCoverBlob, parseEpub } from './utils/epubParser';
import { FileDropZone } from './components/FileDropZone';
import { EpubReader } from './components/EpubReader';
import { LanguageProvider } from './i18n/LanguageContext';
import { AVAILABLE_LANGUAGES, setActiveLanguage, t } from './utils/i18n';
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

const isNightTime = () => {
  const hour = new Date().getHours();
  return hour >= 20 || hour < 8;
};

// The offline notice in any language, so it is cleared once the connection is back.
const OFFLINE_MESSAGES = AVAILABLE_LANGUAGES.map(({ code }) => t('sync.offline', code));

export const App: React.FC = () => {
  const [currentEpub, setCurrentEpub] = useState<ParsedEpub | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
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

  const [settings, setSettings] = useState<ReaderSettingsState>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS;
  });
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
      void saveGoogleDriveSettings(googleDriveSession.accessToken, settings)
        .then((date) => {
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

  const loadDriveData = async (session: GoogleDriveSession, restoreSettings = true): Promise<void> => {
    setIsDriveBusy(true);
    try {
      const settingsRevisionAtStart = settingsRevisionRef.current;
      if (restoreSettings) setDriveSettingsReady(false);
      const [settingsDateResult, booksResult] = await Promise.allSettled([
        getGoogleDriveSettingsDate(session.accessToken),
        listGoogleDriveBooks(session.accessToken),
      ]);

      if (settingsDateResult.status === 'fulfilled') {
        setGoogleDriveSettingsDate(settingsDateResult.value);
      }
      if (booksResult.status === 'fulfilled') {
        setGoogleDriveBooks(booksResult.value);
      }

      let settingsLoaded = false;
      if (settingsDateResult.status === 'fulfilled') {
        if (!restoreSettings) {
          settingsLoaded = true;
        } else if (!settingsDateResult.value) {
          settingsLoaded = restoreSettings;
        } else if (restoreSettings) {
          try {
            const restored = await restoreGoogleDriveSettings(session.accessToken);
            if (settingsRevisionAtStart === settingsRevisionRef.current) {
              setSettings({ ...DEFAULT_SETTINGS, ...restored });
            }
            settingsLoaded = true;
          } catch (error) {
            if (navigator.onLine) {
              setSyncError(t('sync.restoreSettingsError', settings.language, { message: error instanceof Error ? error.message : String(error) }));
            }
          }
        }
      }

      if (settingsLoaded) {
        setDriveSettingsReady(true);
        settingsRevisionRef.current += 1;
        setSettingsRevision(settingsRevisionRef.current);
      }

      if (navigator.onLine) {
        const failures = [settingsDateResult, booksResult].filter((result) => result.status === 'rejected');
        if (failures.length) {
          const reason = failures[0].status === 'rejected' ? failures[0].reason : null;
          setSyncError(t('sync.driveUnavailable', settings.language, { message: reason instanceof Error ? reason.message : String(reason) }));
        } else {
          setSyncError(null);
        }
      }
    } finally {
      setIsDriveBusy(false);
    }
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
    if (!googleDriveSession || !isOnline) return;
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

  const openBook = async (fileOrBlob: File | Blob, preferredId?: string, preferredName?: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (currentEpub) {
        currentEpub.close();
      }

      const buffer = await fileOrBlob.arrayBuffer();
      const parsed = await parseEpub(buffer);
      const driveSession = googleDriveSession;
      if (driveSession && navigator.onLine) {
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
        // Read it back: a write that did not stick would only show up at the next launch, as a missing book.
        if (!(await getRecentBook(id))) throw new Error('The book was not found after saving it.');
        setLastBookId(id);
        void requestPersistentStorage();
      } catch (err) {
        console.warn('No se pudo guardar el libro en la biblioteca local:', err);
        setErrorMessage(t('shelf.saveFailed', settings.language));
      }
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
      setCurrentEpub(parsed);
    } catch (err: any) {
      console.error('Error al abrir el archivo EPUB:', err);
      setErrorMessage(
        err?.message || t('drive.alertReadEpubError', settings.language)
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileLoaded = (fileOrBlob: File | Blob) => {
    void openBook(fileOrBlob);
  };

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

        const lastBookId = getLastBookId();
        if (lastBookId) {
          const listed = books.find((book) => book.id === lastBookId);
          const lastBook = listed && listed.blobLoaded !== false ? listed : await getRecentBook(lastBookId);
          if (lastBook && !cancelled) {
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
    void runDriveAction(async () => {
      const session = await signInToGoogleDrive();
      setGoogleDriveSession(session);
      googleDriveSessionRef.current = session;
      void loadDriveData(session);
    });
  };

  const handleGoogleDriveSignOut = () => {
    void runDriveAction(async () => {
      await signOutGoogleDrive();
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
    if (!googleDriveSession || !navigator.onLine) return;
    void saveGoogleDriveReaderData(googleDriveSession.accessToken, data).catch((error: unknown) => {
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

        {currentEpub ? (
          <EpubReader
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
    </LanguageProvider>
  );
};

export default App;
