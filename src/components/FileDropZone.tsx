import React, { useEffect, useState } from 'react';
import { UploadCloud, BookOpen, Sparkles, FileText, CheckCircle2, Clock3 } from 'lucide-react';
import { createSampleJapaneseEpub } from '../utils/sampleBook';
import { RecentBook } from '../utils/recentBooks';
import { GoogleDriveBook, GoogleDriveSession } from '../utils/googleDriveBackup';
import { GoogleDriveBackupPanel } from './GoogleDriveBackupPanel';

interface Props {
  onFileLoaded: (file: File | Blob) => void;
  onOpenRecent: (book: RecentBook) => void;
  recentBooks: RecentBook[];
  isLoading: boolean;
  googleDriveConfigured: boolean;
  googleDriveSession: GoogleDriveSession | null;
  googleDriveSettingsDate: string | null;
  googleDriveBooks: GoogleDriveBook[];
  isDriveBusy: boolean;
  onGoogleDriveSignIn: () => void;
  onGoogleDriveSignOut: () => void;
  onRestoreDriveSettings: () => void;
  onUploadDriveBook: (book: RecentBook) => void;
  onDownloadDriveBook: (book: GoogleDriveBook) => void;
  onRefreshDriveBooks: () => void;
}

const RecentBookCover: React.FC<{ cover?: Blob; title: string }> = ({ cover, title }) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!cover) {
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(cover);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  return (
    <span className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
      {src ? (
        <img src={src} alt={`Portada de ${title}`} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-indigo-600 dark:text-indigo-400">
          <BookOpen className="h-4 w-4" />
        </span>
      )}
    </span>
  );
};

export const FileDropZone: React.FC<Props> = ({
  onFileLoaded,
  onOpenRecent,
  recentBooks,
  isLoading,
  googleDriveConfigured,
  googleDriveSession,
  googleDriveSettingsDate,
  googleDriveBooks,
  isDriveBusy,
  onGoogleDriveSignIn,
  onGoogleDriveSignOut,
  onRestoreDriveSettings,
  onUploadDriveBook,
  onDownloadDriveBook,
  onRefreshDriveBooks,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.epub') || file.type.includes('epub') || file.type.includes('zip')) {
        onFileLoaded(file);
      } else {
        alert('Por favor, selecciona un archivo con extensión .epub');
      }
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileLoaded(e.target.files[0]);
    }
  };

  const handleLoadSample = async () => {
    const sampleBlob = await createSampleJapaneseEpub();
    onFileLoaded(sampleBlob);
  };

  return (
    <div className="h-full overflow-y-auto overscroll-y-contain bg-gradient-to-br from-stone-50 via-zinc-100 to-stone-200 dark:from-zinc-950 dark:via-zinc-900 dark:to-stone-950 flex flex-col items-center justify-start p-4 pb-8 sm:p-6 text-zinc-800 dark:text-zinc-200">
      <div className="w-full max-w-xl shrink-0 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800/80 p-6 sm:p-10 text-center">
        {/* Brand & Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-semibold mb-6">
          <BookOpen className="w-3.5 h-3.5" />
          <span>Lector EPUB • 縦書き (Japonés Vertical)</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-white font-mincho mb-3">
          Lector de Libros EPUB
        </h1>
        <p className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400 mb-8 max-w-md mx-auto">
          Compatible con libros digitales estándar y lectura en vertical tradicional japonesa (<ruby>縦書き<rt>たてがき</rt></ruby>) con soporte de furigana y paginación.
        </p>

        <GoogleDriveBackupPanel
          configured={googleDriveConfigured}
          session={googleDriveSession}
          settingsDate={googleDriveSettingsDate}
          localBooks={recentBooks}
          cloudBooks={googleDriveBooks}
          busy={isDriveBusy}
          onSignIn={onGoogleDriveSignIn}
          onSignOut={onGoogleDriveSignOut}
          onRestoreSettings={onRestoreDriveSettings}
          onUploadBook={onUploadDriveBook}
          onDownloadBook={onDownloadDriveBook}
          onRefreshBooks={onRefreshDriveBooks}
        />

        {/* Drop Zone */}
        <div
          className={`relative mt-6 border-2 border-dashed rounded-2xl p-4 transition-all cursor-pointer flex flex-col items-center justify-center sm:p-8 ${
            isDragOver
              ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 scale-[1.02]'
              : 'border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-600 bg-zinc-50/50 dark:bg-zinc-800/30'
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('epub-file-input')?.click()}
        >
          <input
            id="epub-file-input"
            type="file"
            accept=".epub,application/epub+zip"
            className="hidden"
            onChange={handleFileInput}
          />

          <div className="w-16 h-16 rounded-2xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 shadow-sm">
            <UploadCloud className="w-8 h-8" />
          </div>

          <div className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
            Arrastra tu archivo <span className="text-indigo-600 dark:text-indigo-400">.epub</span> aquí
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            o haz clic para buscarlo en tu equipo
          </div>

          <button
            type="button"
            className="flex min-h-11 w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-center text-xs font-semibold text-white shadow-md transition-all hover:bg-indigo-700 active:scale-95"
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="min-w-0">Seleccionar archivo EPUB</span>
          </button>
        </div>

        {/* Sample Book Divider & Action */}
        <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-left">
            <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              ¿No tienes un libro a mano?
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Prueba con «走れメロス» (Dazai Osamu) en vertical con furigana
            </div>
          </div>

          <button
            type="button"
            onClick={handleLoadSample}
            disabled={isLoading}
            className="flex min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-stone-100 px-3 py-2.5 text-center text-xs font-semibold text-zinc-800 shadow-sm transition-all hover:bg-stone-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 sm:w-auto sm:max-w-full"
          >
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span className="min-w-0">Cargar libro de prueba japonés</span>
          </button>
        </div>

        {recentBooks.length > 0 && (
          <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-800 text-left">
            <div className="flex items-center gap-2 mb-3">
              <Clock3 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Libros recientes</h2>
            </div>
            <div className="space-y-2">
              {recentBooks.map((book) => (
                <button
                  key={book.id}
                  type="button"
                  onClick={() => onOpenRecent(book)}
                  disabled={isLoading}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-800/60 px-3 py-2.5 text-left hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <RecentBookCover cover={book.cover} title={book.title} />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">{book.title}</span>
                      <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{book.creator} · {book.name}</span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Features Checklist */}
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-3 text-left text-xs text-zinc-600 dark:text-zinc-400">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Texto vertical (縦書き)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Furigana / Ruby tags</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Imágenes & Estilos</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Paginación fluida</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Temas blanco / sepia / noche</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>100% Local y privado</span>
          </div>
        </div>
      </div>
    </div>
  );
};
