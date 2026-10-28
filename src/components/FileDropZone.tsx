import React, { useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { UploadCloud, Sparkles, FileText, Languages, Smartphone, Github, ShieldCheck, Library, ClipboardPaste, Globe, GraduationCap, ChevronRight } from 'lucide-react';
import { createSampleJapaneseEpub } from '../utils/sampleBook';
import { RecentBook } from '../utils/recentBooks';
import { GoogleDriveBook, GoogleDriveSession } from '../utils/googleDriveBackup';
import { GoogleDriveBackupPanel } from './GoogleDriveBackupPanel';
import { BookShelf } from './BookShelf';
import { BookLibraryModal } from './BookLibraryModal';
import { PasteTextModal } from './PasteTextModal';
import { ImportUrlModal } from './ImportUrlModal';
import { DriveStudyState, StudyDashboard } from './StudyDashboard';
import { importUrlAsEpub, UrlImportError } from '../utils/urlImport';
import { textToEpub } from '../utils/textToEpub';
import { importFileAsEpub, isImportable } from '../utils/importFile';
import { UpdateNotice } from './UpdateNotice';
import { UpdateCheckToggle } from './UpdateCheckToggle';
import { UpdateCheckNow } from './UpdateCheckNow';
import { isUpdateCheckEnabled } from '../utils/updateCheck';
import { AVAILABLE_LANGUAGES } from '../utils/i18n';
import { useLanguage, useT } from '../i18n/LanguageContext';
import { ReaderSettingsState } from '../types/epub';

const SOURCE_URL = 'https://github.com/xelloss1012/yomisuba';
// Always the APK of the latest GitHub release.
const ANDROID_DOWNLOAD_URL = `${SOURCE_URL}/releases/latest/download/yomisuba.apk`;
const PRIVACY_URL = 'https://xelloss1012.github.io/yomisuba/privacy.html';

interface Props {
  onFileLoaded: (file: File | Blob) => void;
  onOpenRecent: (book: RecentBook) => void;
  onRemoveRecentBook: (book: RecentBook) => void;
  recentBooks: RecentBook[];
  isLoading: boolean;
  googleDriveConfigured: boolean;
  googleDriveSession: GoogleDriveSession | null;
  googleDriveSettingsDate: string | null;
  googleDriveBooks: GoogleDriveBook[];
  isDriveBusy: boolean;
  isGoogleDriveSignInPending: boolean;
  googleDriveError: string | null;
  onCopyGoogleDriveDiagnostics: () => Promise<void>;
  onGoogleDriveSignIn: () => void;
  onGoogleDriveSignOut: () => void;
  onRestoreDriveSettings: () => void;
  onUploadDriveBook: (book: RecentBook) => void;
  onDownloadDriveBook: (book: GoogleDriveBook) => void;
  onDeleteDriveBook: (book: GoogleDriveBook) => void;
  onRefreshDriveBooks: () => void;
  /** Removes from this device the data of a book no longer on the shelf. */
  onDeleteBookData: (bookKey: string) => void;
  driveStudy: DriveStudyState;
  /** Reads from Drive the data of the books this device does not have; absent without a Google session. */
  onLoadDriveStudyBooks?: () => void;
  onUpdateSettings: (newSettings: Partial<ReaderSettingsState>) => void;
}

export const FileDropZone: React.FC<Props> = ({
  onFileLoaded,
  onOpenRecent,
  onRemoveRecentBook,
  recentBooks,
  isLoading,
  googleDriveConfigured,
  googleDriveSession,
  googleDriveSettingsDate,
  googleDriveBooks,
  isDriveBusy,
  isGoogleDriveSignInPending,
  googleDriveError,
  onCopyGoogleDriveDiagnostics,
  onGoogleDriveSignIn,
  onGoogleDriveSignOut,
  onRestoreDriveSettings,
  onUploadDriveBook,
  onDownloadDriveBook,
  onDeleteDriveBook,
  onRefreshDriveBooks,
  onDeleteBookData,
  driveStudy,
  onLoadDriveStudyBooks,
  onUpdateSettings,
}) => {
  const t = useT();
  const language = useLanguage();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isPasteOpen, setIsPasteOpen] = useState(false);
  const [isUrlOpen, setIsUrlOpen] = useState(false);
  const [isStudyOpen, setIsStudyOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const isNative = Capacitor.isNativePlatform();
  const [updateChecks, setUpdateChecks] = useState(isUpdateCheckEnabled);

  // An EPUB opens as it is; a text file is made into one first.
  const openFile = async (file: File) => {
    if (!isImportable(file)) {
      alert(t('dropzone.alert'));
      return;
    }
    try {
      onFileLoaded(await importFileAsEpub(file, { textAuthor: t('import.textFileAuthor'), htmlAuthor: t('import.htmlFileAuthor') }));
    } catch (error) {
      alert(t('import.failed', { message: error instanceof Error ? error.message : String(error) }));
    }
  };

  const openPastedText = async (text: string, title: string) => {
    try {
      const converted = await textToEpub(text, { title, author: t('import.pastedAuthor') });
      setIsPasteOpen(false);
      onFileLoaded(new File([converted.blob], `${converted.title}.epub`, { type: 'application/epub+zip' }));
    } catch (error) {
      throw new Error(t('import.failed', { message: error instanceof Error ? error.message : String(error) }));
    }
  };

  const openUrl = async (address: string) => {
    try {
      const file = await importUrlAsEpub(address, { fallbackAuthor: t('import.htmlFileAuthor') });
      setIsUrlOpen(false);
      onFileLoaded(file);
    } catch (error) {
      if (!(error instanceof UrlImportError)) throw new Error(t('import.urlFailed', { message: error instanceof Error ? error.message : String(error) }));
      const keys = { invalid: 'import.urlInvalid', blocked: 'import.urlBlocked', status: 'import.urlStatus', type: 'import.urlType', size: 'import.urlSize', empty: 'import.urlEmpty' } as const;
      throw new Error(error.code === 'failed'
        ? t('import.urlFailed', { message: error.detail })
        : t(keys[error.code], { status: error.detail }));
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) void openFile(e.dataTransfer.files[0]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void openFile(e.target.files[0]);
    }
    // So that choosing the same file again still fires a change.
    e.target.value = '';
  };

  const handleLoadSample = async () => {
    const sampleBlob = await createSampleJapaneseEpub();
    onFileLoaded(sampleBlob);
  };

  return (
    <div
      className="relative h-full overflow-y-auto overscroll-y-contain bg-gradient-to-br from-stone-50 via-zinc-100 to-stone-200 dark:from-zinc-950 dark:via-zinc-900 dark:to-stone-950 flex flex-col items-center justify-start p-4 pb-8 sm:p-6 text-zinc-800 dark:text-zinc-200"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setIsDragOver(true);
      }}
    >
      {/* Dropping a file anywhere works on a computer; the overlay only shows while dragging. */}
      {isDragOver && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-indigo-600/20 p-6 backdrop-blur-sm"
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="rounded-3xl border-2 border-dashed border-indigo-500 bg-white/90 px-8 py-10 text-center text-base font-semibold text-indigo-700 shadow-2xl dark:bg-zinc-900/90 dark:text-indigo-300">
            <UploadCloud className="mx-auto mb-3 h-10 w-10" />
            {t('shelf.dropHere')}
          </div>
        </div>
      )}

      <div className="w-full max-w-xl shrink-0 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800/80 p-5 sm:p-8">
        {/* Brand and language */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-left">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-white font-mincho">
              {t('app.title')}
            </h1>
            <p lang="ja" className="text-xs sm:text-sm font-mincho text-indigo-700 dark:text-indigo-300">
              {t('app.slogan')}
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
            <Languages className="h-4 w-4" aria-hidden="true" />
            <select
              value={language}
              onChange={(e) => onUpdateSettings({ language: e.target.value as ReaderSettingsState['language'] })}
              aria-label={t('language.label')}
              className="min-h-9 rounded-lg border border-indigo-100 bg-indigo-50/70 px-2 py-1 text-xs font-semibold text-indigo-700 dark:border-indigo-800/80 dark:bg-indigo-950/40 dark:text-indigo-300"
            >
              {AVAILABLE_LANGUAGES.map((langItem) => (
                <option key={langItem.code} value={langItem.code}>{langItem.label}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Only the Android app can be out of date: the web version is republished on every change. */}
        {isNative && <div className="mt-4"><UpdateNotice enabled={updateChecks} /></div>}

        <BookShelf
          recentBooks={recentBooks}
          cloudBooks={googleDriveBooks}
          signedIn={Boolean(googleDriveSession)}
          isLoading={isLoading}
          isDriveBusy={isDriveBusy}
          onOpenRecent={onOpenRecent}
          onRemoveRecentBook={onRemoveRecentBook}
          onUploadDriveBook={onUploadDriveBook}
          onDownloadDriveBook={onDownloadDriveBook}
          onDeleteDriveBook={onDeleteDriveBook}
        />

        <button
          type="button"
          onClick={() => setIsStudyOpen(true)}
          className="mt-4 flex min-h-12 w-full items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2.5 text-left transition-colors hover:bg-indigo-100 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/60"
        >
          <GraduationCap className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-indigo-900 dark:text-indigo-200">{t('study.button')}</span>
            <span className="block text-[11px] text-indigo-700/80 dark:text-indigo-300/80">{t('study.buttonHint')}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-indigo-400" />
        </button>

        {/* Adding books */}
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <input
            ref={fileInput}
            type="file"
            accept=".epub,.txt,.text,.html,.htm,.xhtml,application/epub+zip,text/plain,text/html,application/xhtml+xml"
            className="hidden"
            onChange={handleFileInput}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={isLoading}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-semibold text-white shadow-md transition-all hover:bg-indigo-700 active:scale-95 disabled:opacity-50"
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="min-w-0">{t('shelf.openEpub')}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsLibraryOpen(true)}
            disabled={isLoading}
            title={t('library.subtitle')}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-stone-100 px-3 py-2.5 text-xs font-semibold text-zinc-800 shadow-sm transition-all hover:bg-stone-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <Library className="h-4 w-4 shrink-0 text-indigo-500" />
            <span className="min-w-0">{t('library.button')}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsPasteOpen(true)}
            disabled={isLoading}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-stone-100 px-3 py-2.5 text-xs font-semibold text-zinc-800 shadow-sm transition-all hover:bg-stone-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <ClipboardPaste className="h-4 w-4 shrink-0 text-indigo-500" />
            <span className="min-w-0">{t('import.pasteButton')}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsUrlOpen(true)}
            disabled={isLoading}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-stone-100 px-3 py-2.5 text-xs font-semibold text-zinc-800 shadow-sm transition-all hover:bg-stone-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <Globe className="h-4 w-4 shrink-0 text-indigo-500" />
            <span className="min-w-0">{t('import.urlButton')}</span>
          </button>
        </div>
        {recentBooks.length === 0 && (
          <button
            type="button"
            onClick={handleLoadSample}
            disabled={isLoading}
            title={t('sample.subtitle')}
            className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-600 transition-colors hover:bg-stone-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span className="min-w-0">{t('sample.btn')}</span>
          </button>
        )}

        <GoogleDriveBackupPanel
          configured={googleDriveConfigured}
          session={googleDriveSession}
          settingsDate={googleDriveSettingsDate}
          busy={isDriveBusy}
          signingIn={isGoogleDriveSignInPending}
          error={googleDriveError}
          onCopyDiagnostics={onCopyGoogleDriveDiagnostics}
          onSignIn={onGoogleDriveSignIn}
          onSignOut={onGoogleDriveSignOut}
          onRestoreSettings={onRestoreDriveSettings}
          onRefreshBooks={onRefreshDriveBooks}
        />

        <ImportUrlModal
          isOpen={isUrlOpen}
          onClose={() => setIsUrlOpen(false)}
          onSubmit={openUrl}
        />

        <PasteTextModal
          isOpen={isPasteOpen}
          onClose={() => setIsPasteOpen(false)}
          onSubmit={openPastedText}
        />

        <StudyDashboard
          isOpen={isStudyOpen}
          recentBooks={recentBooks}
          onClose={() => setIsStudyOpen(false)}
          onOpenBook={(book) => { setIsStudyOpen(false); onOpenRecent(book); }}
          onDeleteBookData={onDeleteBookData}
          driveStudy={driveStudy}
          onLoadDriveStudyBooks={onLoadDriveStudyBooks}
        />

        <BookLibraryModal
          isOpen={isLibraryOpen}
          recentBooks={recentBooks}
          isLoading={isLoading}
          onClose={() => setIsLibraryOpen(false)}
          onOpenRecent={onOpenRecent}
          onFileLoaded={onFileLoaded}
        />

        <div className="mt-8 pt-4 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          {!isNative && (
            <a href={ANDROID_DOWNLOAD_URL} className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
              <Smartphone className="h-3.5 w-3.5" />
              {t('app.downloadAndroid')}
            </a>
          )}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
            <Github className="h-3.5 w-3.5" />
            {t('app.sourceCode')}
          </a>
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('app.privacy')}
          </a>
          {isNative && <UpdateCheckToggle variant="inline" onChange={setUpdateChecks} />}
        </div>
        {isNative && (
          <div className="mt-2 flex justify-center text-[11px] text-zinc-500 dark:text-zinc-400">
            <UpdateCheckNow />
          </div>
        )}
      </div>
    </div>
  );
};
