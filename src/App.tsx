import React, { useState, useEffect } from 'react';
import { ParsedEpub, ReaderSettingsState } from './types/epub';
import { parseEpub } from './utils/epubParser';
import { FileDropZone } from './components/FileDropZone';
import { EpubReader } from './components/EpubReader';
import { createBookId, getLastBookId, getRecentBook, listRecentBooks, RecentBook, saveRecentBook, setLastBookId } from './utils/recentBooks';
import {
  downloadGoogleDriveBook,
  getGoogleDriveSettingsDate,
  GoogleDriveBook,
  GoogleDriveSession,
  googleDriveConfigured,
  pickGoogleDriveBook,
  listGoogleDriveBooks,
  ReaderBookBackup,
  applyGoogleDriveReaderData,
  restoreGoogleDriveReaderData,
  restoreGoogleDriveSession,
  restoreGoogleDriveSettings,
  refreshGoogleDriveSession,
  saveGoogleDriveReaderData,
  saveGoogleDriveSettings,
  signInToGoogleDrive,
  signOutGoogleDrive,
  uploadGoogleDriveBook,
} from './utils/googleDriveBackup';

const SETTINGS_STORAGE_KEY = 'ereader_settings_v1';

const DEFAULT_SETTINGS: ReaderSettingsState = {
  writingMode: 'vertical-rl',
  progressionDirection: 'rtl',
  fontSize: 18,
  lineHeight: 1.9,
  fontFamily: 'mincho',
  theme: 'paper',
  autoNightMode: false,
  letterSpacing: 0.05,
  aiApiKeys: {},
  openRouterModel: 'openrouter/free',
};

const isNightTime = () => {
  const hour = new Date().getHours();
  return hour >= 20 || hour < 8;
};

export const App: React.FC = () => {
  const [currentEpub, setCurrentEpub] = useState<ParsedEpub | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recentBooks, setRecentBooks] = useState<RecentBook[]>([]);
  const [googleDriveSession, setGoogleDriveSession] = useState<GoogleDriveSession | null>(null);
  const googleDriveSessionRef = React.useRef<GoogleDriveSession | null>(null);
  const [googleDriveSettingsDate, setGoogleDriveSettingsDate] = useState<string | null>(null);
  const [googleDriveBooks, setGoogleDriveBooks] = useState<GoogleDriveBook[]>([]);
  const [isDriveBusy, setIsDriveBusy] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [driveSettingsReady, setDriveSettingsReady] = useState(false);
  const driveSessionRestorePromiseRef = React.useRef<Promise<GoogleDriveSession | null> | null>(null);
  const driveSessionRefreshPromiseRef = React.useRef<Promise<void> | null>(null);
  googleDriveSessionRef.current = googleDriveSession;

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
    if (!googleDriveSession || !driveSettingsReady || settingsRevision === 0) return;
    const timer = window.setTimeout(() => {
      void saveGoogleDriveSettings(googleDriveSession.accessToken, settings)
        .then(setGoogleDriveSettingsDate)
        .catch((error: unknown) => {
          setErrorMessage(`No se pudieron guardar los ajustes en Google Drive: ${error instanceof Error ? error.message : String(error)}`);
        });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [googleDriveSession, driveSettingsReady, settings, settingsRevision]);

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
    let cancelled = false;
    const initializeDriveSession = async (session: GoogleDriveSession): Promise<void> => {
      setDriveSettingsReady(false);
      setGoogleDriveSession(session);
      driveSessionRestorePromiseRef.current = Promise.resolve(session);
      const [settingsDate, books] = await Promise.all([
        getGoogleDriveSettingsDate(session.accessToken),
        listGoogleDriveBooks(session.accessToken),
      ]);
      if (cancelled) return;
      setGoogleDriveSettingsDate(settingsDate);
      setGoogleDriveBooks(books);
      if (settingsDate) {
        const restored = await restoreGoogleDriveSettings(session.accessToken);
        if (cancelled) return;
        setSettings({ ...DEFAULT_SETTINGS, ...restored });
      }
      setDriveSettingsReady(true);
      setSettingsRevision((revision) => revision + 1);
    };
    const restoreDriveSession = async (): Promise<GoogleDriveSession | null> => {
      try {
        const session = await restoreGoogleDriveSession();
        if (!session || cancelled) return null;
        await initializeDriveSession(session);
        return session;
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(`No se pudieron cargar los datos de Google Drive: ${error instanceof Error ? error.message : String(error)}`);
        }
        return null;
      }
    };
    driveSessionRestorePromiseRef.current = restoreDriveSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !googleDriveSessionRef.current || driveSessionRefreshPromiseRef.current) return;
      const refresh = refreshGoogleDriveSession()
        .then((session) => {
          if (session) {
            googleDriveSessionRef.current = session;
            driveSessionRestorePromiseRef.current = Promise.resolve(session);
            setGoogleDriveSession(session);
          } else {
            googleDriveSessionRef.current = null;
            setGoogleDriveSession(null);
            setDriveSettingsReady(false);
            setGoogleDriveSettingsDate(null);
            setGoogleDriveBooks([]);
          }
        })
        .catch((error: unknown) => {
          setErrorMessage(`No se pudo renovar la sesión de Google: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          driveSessionRefreshPromiseRef.current = null;
        });
      driveSessionRefreshPromiseRef.current = refresh;
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

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
    setSettingsRevision((revision) => revision + 1);
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
      const driveSession = googleDriveSession || await driveSessionRestorePromiseRef.current;
      if (driveSession) {
        const bookKey = `ereader_book_${encodeURIComponent(`${parsed.metadata.title}|${parsed.metadata.creator}`)}`;
        try {
          const readerData = await restoreGoogleDriveReaderData(driveSession.accessToken, bookKey);
          if (readerData) applyGoogleDriveReaderData(readerData);
        } catch (error) {
          setErrorMessage(`El libro se abrirá con los datos locales; no se pudo actualizar la lectura desde Drive: ${error instanceof Error ? error.message : String(error)}`);
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
      };
      try {
        await saveRecentBook(recentBook);
        setLastBookId(id);
      } catch (err) {
        console.warn('No se pudo guardar el libro en la biblioteca local:', err);
      }
      setRecentBooks((books) => [recentBook, ...books.filter((book) => book.id !== id)].slice(0, 8));

      // Auto-detect Japanese or RTL metadata
      const isJapanese =
        parsed.metadata.language?.toLowerCase().startsWith('ja') ||
        parsed.metadata.direction === 'rtl';

      if (isJapanese) {
        handleUpdateSettings({
          writingMode: 'vertical-rl',
          progressionDirection: 'rtl',
          fontFamily: 'mincho',
        });
      }

      setCurrentEpub(parsed);
    } catch (err: any) {
      console.error('Error al abrir el archivo EPUB:', err);
      setErrorMessage(
        err?.message || 'No se pudo leer el archivo EPUB. Comprueba que sea un archivo válido.'
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
        const books = await listRecentBooks();
        if (cancelled) return;
        setRecentBooks(books.slice(0, 8));
        const lastBookId = getLastBookId();
        if (lastBookId) {
          const lastBook = books.find((book) => book.id === lastBookId) || await getRecentBook(lastBookId);
          if (lastBook && !cancelled) {
            await openBook(lastBook.blob, lastBook.id, lastBook.name);
          }
        }
      } catch (err) {
        console.warn('No se pudo restaurar la biblioteca local:', err);
      }
    };
    void restoreLibrary();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenRecent = (book: RecentBook) => {
    void openBook(book.blob, book.id, book.name);
  };

  const handleCloseBook = () => {
    if (currentEpub) {
      currentEpub.close();
      setCurrentEpub(null);
    }
  };

  const runDriveAction = async (action: () => Promise<void>) => {
    setIsDriveBusy(true);
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDriveBusy(false);
    }
  };

  const handleGoogleDriveSignIn = () => {
    void runDriveAction(async () => {
      const session = await signInToGoogleDrive();
      setDriveSettingsReady(false);
      setGoogleDriveSession(session);
      googleDriveSessionRef.current = session;
      driveSessionRestorePromiseRef.current = Promise.resolve(session);
      const [settingsDate, books] = await Promise.all([
        getGoogleDriveSettingsDate(session.accessToken),
        listGoogleDriveBooks(session.accessToken),
      ]);
      setGoogleDriveSettingsDate(settingsDate);
      setGoogleDriveBooks(books);
      if (settingsDate) {
        const restored = await restoreGoogleDriveSettings(session.accessToken);
        setSettings({ ...DEFAULT_SETTINGS, ...restored });
      }
      setDriveSettingsReady(true);
      setSettingsRevision((revision) => revision + 1);
    });
  };

  const handleGoogleDriveSignOut = () => {
    void runDriveAction(async () => {
      await signOutGoogleDrive();
      driveSessionRestorePromiseRef.current = Promise.resolve(null);
      googleDriveSessionRef.current = null;
      setGoogleDriveSession(null);
      setDriveSettingsReady(false);
      setGoogleDriveSettingsDate(null);
      setGoogleDriveBooks([]);
    });
  };

  const handleRestoreDriveSettings = () => {
    if (!googleDriveSession || !window.confirm('¿Reemplazar los ajustes locales por los ajustes guardados en tu Google Drive?')) return;
    void runDriveAction(async () => {
      const restored = await restoreGoogleDriveSettings(googleDriveSession.accessToken);
      setSettings({ ...DEFAULT_SETTINGS, ...restored });
      setDriveSettingsReady(true);
      setSettingsRevision((revision) => revision + 1);
    });
  };

  const handleUploadDriveBook = (book: RecentBook) => {
    if (!googleDriveSession) return;
    void runDriveAction(async () => {
      await uploadGoogleDriveBook(googleDriveSession.accessToken, book);
      setGoogleDriveBooks(await listGoogleDriveBooks(googleDriveSession.accessToken));
    });
  };

  const handleDownloadDriveBook = (cloudBook: GoogleDriveBook) => {
    if (!googleDriveSession || !window.confirm(
      `Descargar «${cloudBook.title}» y restaurar sus datos de lectura locales?`
    )) return;
    void runDriveAction(async () => {
      const book = recentBooks.find((item) =>
        item.title === cloudBook.title && item.creator === cloudBook.creator
      ) || await downloadGoogleDriveBook(googleDriveSession.accessToken, cloudBook);
      setRecentBooks((books) => [book, ...books.filter((item) => item.id !== book.id)].slice(0, 8));
      await openBook(book.blob, book.id, book.name);
    });
  };

  const handleImportDriveBook = () => {
    if (!googleDriveSession) return;
    void runDriveAction(async () => {
      const selected = await pickGoogleDriveBook(googleDriveSession.accessToken);
      if (!selected) return;
      const book = await downloadGoogleDriveBook(googleDriveSession.accessToken, selected);
      setGoogleDriveBooks(await listGoogleDriveBooks(googleDriveSession.accessToken));
      setRecentBooks((books) => [book, ...books.filter((item) => item.id !== book.id)].slice(0, 8));
      await openBook(book.blob, book.id, book.name);
    });
  };

  const handleBookDataChange = (data: ReaderBookBackup) => {
    if (!googleDriveSession) return;
    void saveGoogleDriveReaderData(googleDriveSession.accessToken, data).catch((error: unknown) => {
      setErrorMessage(`No se pudo guardar el progreso en Google Drive: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const handleRefreshDriveBooks = () => {
    if (!googleDriveSession) return;
    void runDriveAction(async () => {
      setGoogleDriveBooks(await listGoogleDriveBooks(googleDriveSession.accessToken));
      setGoogleDriveSettingsDate(await getGoogleDriveSettingsDate(googleDriveSession.accessToken));
    });
  };

  return (
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
        />
      ) : (
        <FileDropZone
          onFileLoaded={handleFileLoaded}
          onOpenRecent={handleOpenRecent}
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
          onImportDriveBook={handleImportDriveBook}
          onRefreshDriveBooks={handleRefreshDriveBooks}
        />
      )}
    </div>
  );
};

export default App;
