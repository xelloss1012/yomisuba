import React, { useState, useEffect } from 'react';
import { ParsedEpub, ReaderSettingsState } from './types/epub';
import { parseEpub } from './utils/epubParser';
import { FileDropZone } from './components/FileDropZone';
import { EpubReader } from './components/EpubReader';
import { createBookId, getLastBookId, getRecentBook, listRecentBooks, RecentBook, saveRecentBook, setLastBookId } from './utils/recentBooks';

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
        />
      ) : (
        <FileDropZone
          onFileLoaded={handleFileLoaded}
          onOpenRecent={handleOpenRecent}
          recentBooks={recentBooks}
          isLoading={isLoading}
        />
      )}
    </div>
  );
};

export default App;
