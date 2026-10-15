import React, { useState } from 'react';
import { Cloud, Check, Loader2, AlertTriangle, RefreshCw, UploadCloud } from 'lucide-react';
import { GoogleDriveSession } from '../utils/googleDriveBackup';
import { formatSyncError, SyncErrorState } from '../utils/i18n';
import { useLanguage, useT } from '../i18n/LanguageContext';

interface Props {
  googleDriveSession?: GoogleDriveSession | null;
  isDriveBusy?: boolean;
  syncError?: SyncErrorState;
  onRetry?: () => void;
  lastSyncedDate?: string | null;
  isBookUploaded?: boolean;
  onUploadBook?: () => void;
  align?: 'left' | 'right';
}

export const SyncStatusBadge: React.FC<Props> = ({
  googleDriveSession,
  isDriveBusy = false,
  syncError = null,
  onRetry,
  lastSyncedDate,
  isBookUploaded = true,
  onUploadBook,
  align = 'right',
}) => {
  const t = useT();
  const language = useLanguage();
  const [isOpen, setIsOpen] = useState(false);

  if (!googleDriveSession) return null;

  const displayError = syncError ? formatSyncError(syncError, language) : null;

  const getStatusIcon = () => {
    if (isDriveBusy) {
      return <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />;
    }
    if (displayError) {
      return <AlertTriangle className="w-4 h-4 text-amber-500 animate-pulse" />;
    }
    if (!isBookUploaded) {
      return <UploadCloud className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />;
    }
    return <Check className="w-4 h-4 text-emerald-500" />;
  };

  const getStatusBg = () => {
    if (displayError) return 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/80';
    if (isDriveBusy) return 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800/80';
    if (!isBookUploaded) return 'bg-indigo-50/60 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800/60';
    return 'bg-white/90 dark:bg-zinc-900/90 border-zinc-200/80 dark:border-zinc-800/80';
  };

  const alignmentClass =
    align === 'left'
      ? 'absolute left-0 bottom-full mb-2 origin-bottom-left'
      : 'absolute right-0 top-full mt-2 origin-top-right';

  const handleToggle = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  };

  return (
    <div className="relative inline-block pointer-events-auto">
      <button
        onClick={handleToggle}
        title={
          displayError
            ? `${t('sync.notice')} ${displayError}`
            : isDriveBusy
              ? t('sync.syncing')
              : !isBookUploaded
                ? t('sync.progressOnly')
                : t('sync.synchronized')
        }
        aria-label={t('sync.statusAria')}
        className={`tap-area flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs shadow-sm backdrop-blur-sm transition-all ${getStatusBg()} text-zinc-700 dark:text-zinc-200 hover:scale-105`}
      >
        <Cloud className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
        {getStatusIcon()}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-transparent"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
          />

          <div
            className={`${alignmentClass} z-50 w-72 rounded-2xl bg-white dark:bg-zinc-900 p-4 shadow-2xl border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 animate-in fade-in zoom-in-95 duration-150`}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Cloud className="w-4 h-4 text-indigo-600" />
                {t('sync.title')}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                }}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-bold px-1"
                aria-label={t('menu.close')}
              >
                ✕
              </button>
            </div>

            {displayError ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/50 p-2.5 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-900">
                  <p className="font-medium mb-1">{t('sync.syncWarning')}</p>
                  <p className="text-[11px] opacity-90 break-words">{displayError}</p>
                </div>
                {onRetry && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry();
                      setIsOpen(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 transition-colors shadow-sm cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t('sync.retry')}
                  </button>
                )}
              </div>
            ) : !isBookUploaded ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/40 p-2.5 text-indigo-900 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-900">
                  <p className="font-medium mb-1">{t('sync.progressTitle')}</p>
                  <p className="text-[11px] opacity-90">
                    {t('sync.progressDesc')}
                  </p>
                </div>
                {onUploadBook && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUploadBook();
                      setIsOpen(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 transition-colors shadow-sm cursor-pointer"
                  >
                    <UploadCloud className="w-4 h-4" />
                    {t('sync.uploadBookBtn')}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-zinc-600 dark:text-zinc-400">
                  {isDriveBusy ? t('sync.syncing') : t('sync.syncedOk')}
                </p>
                {lastSyncedDate && (
                  <p className="text-[10px] text-zinc-400">
                    {t('sync.lastSync')}{lastSyncedDate}
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
