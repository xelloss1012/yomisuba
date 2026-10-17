import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { UploadCloud, BookOpen, Sparkles, FileText, Clock3, Trash2, Languages, Smartphone, Github, ShieldCheck, Library } from 'lucide-react';
import { createSampleJapaneseEpub } from '../utils/sampleBook';
import { RecentBook } from '../utils/recentBooks';
import { GoogleDriveBook, GoogleDriveSession } from '../utils/googleDriveBackup';
import { GoogleDriveBackupPanel } from './GoogleDriveBackupPanel';
import { BookCoverThumbnail } from './BookCoverThumbnail';
import { BookLibraryModal } from './BookLibraryModal';
import { UpdateNotice } from './UpdateNotice';
import { UpdateCheckToggle } from './UpdateCheckToggle';
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
  onGoogleDriveSignIn: () => void;
  onGoogleDriveSignOut: () => void;
  onRestoreDriveSettings: () => void;
  onUploadDriveBook: (book: RecentBook) => void;
  onDownloadDriveBook: (book: GoogleDriveBook) => void;
  onDeleteDriveBook: (book: GoogleDriveBook) => void;
  onRefreshDriveBooks: () => void;
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
  onGoogleDriveSignIn,
  onGoogleDriveSignOut,
  onRestoreDriveSettings,
  onUploadDriveBook,
  onDownloadDriveBook,
  onDeleteDriveBook,
  onRefreshDriveBooks,
  onUpdateSettings,
}) => {
  const t = useT();
  const language = useLanguage();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const isNative = Capacitor.isNativePlatform();
  const [updateChecks, setUpdateChecks] = useState(isUpdateCheckEnabled);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.epub') || file.type.includes('epub') || file.type.includes('zip')) {
        onFileLoaded(file);
      } else {
        alert(t('dropzone.alert'));
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
        {/* Language Selector on Main Page */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6 bg-indigo-50/70 dark:bg-indigo-950/40 p-3 rounded-2xl border border-indigo-100 dark:border-indigo-800/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
            <Languages className="w-4 h-4" />
            <span>{t('language.label')}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {AVAILABLE_LANGUAGES.map((langItem) => (
              <button
                key={langItem.code}
                type="button"
                onClick={() => onUpdateSettings({ language: langItem.code })}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all ${
                  language === langItem.code
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-transparent text-zinc-700 dark:text-zinc-300 hover:bg-indigo-100/60 dark:hover:bg-indigo-900/50'
                }`}
              >
                {langItem.label}
              </button>
            ))}
          </div>
        </div>

        {/* Only the Android app can be out of date: the web version is republished on every change. */}
        {isNative && <UpdateNotice enabled={updateChecks} />}

        {/* Brand & Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-semibold mb-6">
          <BookOpen className="w-3.5 h-3.5" />
          <span>{t('app.subtitle')}</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-white font-mincho mb-2">
          {t('app.title')}
        </h1>
        <p lang="ja" className="text-sm sm:text-base font-mincho text-indigo-700 dark:text-indigo-300 mb-3">
          {t('app.slogan')}
        </p>
        <p className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400 mb-8 max-w-md mx-auto">
          {t('app.description')}
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
          onDeleteBook={onDeleteDriveBook}
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
            {t('dropzone.dragPrefix')}<span className="text-indigo-600 dark:text-indigo-400">.epub</span>{t('dropzone.dragSuffix')}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            {t('dropzone.browse')}
          </div>

          <button
            type="button"
            className="flex min-h-11 w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-center text-xs font-semibold text-white shadow-md transition-all hover:bg-indigo-700 active:scale-95"
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="min-w-0">{t('dropzone.selectBtn')}</span>
          </button>
        </div>

        {/* Sample Book Divider & Action */}
        <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-left">
            <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {t('sample.title')}
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {t('sample.subtitle')}
            </div>
          </div>

          <button
            type="button"
            onClick={handleLoadSample}
            disabled={isLoading}
            className="flex min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-stone-100 px-3 py-2.5 text-center text-xs font-semibold text-zinc-800 shadow-sm transition-all hover:bg-stone-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 sm:w-auto sm:max-w-full"
          >
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span className="min-w-0">{t('sample.btn')}</span>
          </button>
        </div>

        <div className="mt-4 flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="text-left">
            <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t('library.title')}</div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('library.subtitle')}</div>
          </div>
          <button
            type="button"
            onClick={() => setIsLibraryOpen(true)}
            disabled={isLoading}
            className="flex min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-stone-100 px-3 py-2.5 text-center text-xs font-semibold text-zinc-800 shadow-sm transition-all hover:bg-stone-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 sm:w-auto sm:max-w-full"
          >
            <Library className="w-4 h-4 text-indigo-500" />
            <span className="min-w-0">{t('library.button')}</span>
          </button>
        </div>

        {recentBooks.length > 0 && (
          <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-800 text-left">
            <div className="flex items-center gap-2 mb-3">
              <Clock3 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t('recent.title')}</h2>
            </div>
            <div className="space-y-2">
              {recentBooks.map((book) => (
                <div
                  key={book.id}
                  className="flex min-w-0 items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-2 dark:border-zinc-700 dark:bg-zinc-800/60"
                >
                  <button
                    type="button"
                    onClick={() => onOpenRecent(book)}
                    disabled={isLoading}
                    className="min-w-0 flex-1 py-2.5 pl-1 text-left transition-colors hover:text-indigo-700 disabled:opacity-50 dark:hover:text-indigo-300"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <BookCoverThumbnail cover={book.cover} title={book.title} />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">{book.title}</span>
                        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{book.creator} · {book.name}</span>
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveRecentBook(book)}
                    disabled={isLoading || isDriveBusy}
                    title={t('dropzone.removeRecent')}
                    className="p-2 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
      </div>
    </div>
  );
};
