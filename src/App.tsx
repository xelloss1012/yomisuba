import React, { useState, useEffect } from 'react';
import { ParsedEpub, ReaderSettingsState } from './types/epub';
import { parseEpub } from './utils/epubParser';
import { FileDropZone } from './components/FileDropZone';
import { EpubReader } from './components/EpubReader';

const SETTINGS_STORAGE_KEY = 'ereader_settings_v1';

const DEFAULT_SETTINGS: ReaderSettingsState = {
  writingMode: 'vertical-rl',
  progressionDirection: 'rtl',
  fontSize: 18,
  lineHeight: 1.9,
  fontFamily: 'mincho',
  theme: 'paper',
  letterSpacing: 0.05,
};

export const App: React.FC = () => {
  const [currentEpub, setCurrentEpub] = useState<ParsedEpub | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [settings, setSettings] = useState<ReaderSettingsState>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS;
  });

  // Save settings changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }

    // Apply dark class to html document if dark theme
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings]);

  const handleUpdateSettings = (newSettings: Partial<ReaderSettingsState>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  };

  const handleFileLoaded = async (fileOrBlob: File | Blob) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (currentEpub) {
        currentEpub.close();
      }

      const buffer = await fileOrBlob.arrayBuffer();
      const parsed = await parseEpub(buffer);

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
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
        />
      ) : (
        <FileDropZone onFileLoaded={handleFileLoaded} isLoading={isLoading} />
      )}
    </div>
  );
};

export default App;
