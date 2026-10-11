import React, { useState } from 'react';
import { Cloud, Check, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { GoogleDriveSession } from '../utils/googleDriveBackup';

interface Props {
  googleDriveSession?: GoogleDriveSession | null;
  isDriveBusy?: boolean;
  syncError?: string | null;
  onRetry?: () => void;
  lastSyncedDate?: string | null;
}

export const SyncStatusBadge: React.FC<Props> = ({
  googleDriveSession,
  isDriveBusy = false,
  syncError = null,
  onRetry,
  lastSyncedDate,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!googleDriveSession) return null;

  const getStatusIcon = () => {
    if (isDriveBusy) {
      return <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />;
    }
    if (syncError) {
      return <AlertTriangle className="w-4 h-4 text-amber-500 animate-pulse" />;
    }
    return <Check className="w-4 h-4 text-emerald-500" />;
  };

  const getStatusBg = () => {
    if (syncError) return 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/80';
    if (isDriveBusy) return 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800/80';
    return 'bg-white/90 dark:bg-zinc-900/90 border-zinc-200/80 dark:border-zinc-800/80';
  };

  return (
    <div className="relative z-50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        title={syncError ? `Aviso de Google Drive: ${syncError}` : isDriveBusy ? 'Sincronizando con Google Drive...' : 'Sincronizado con Google Drive'}
        aria-label="Estado de sincronización de Google Drive"
        className={`tap-area flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs shadow-sm backdrop-blur-sm transition-all ${getStatusBg()} text-zinc-700 dark:text-zinc-200 hover:scale-105`}
      >
        <Cloud className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
        {getStatusIcon()}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-white dark:bg-zinc-900 p-4 shadow-2xl border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
              <Cloud className="w-4 h-4 text-indigo-600" />
              Google Drive
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-bold px-1"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>

          {syncError ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/50 p-2.5 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-900">
                <p className="font-medium mb-1">Aviso de sincronización:</p>
                <p className="text-[11px] opacity-90 break-words">{syncError}</p>
              </div>
              {onRetry && (
                <button
                  onClick={() => {
                    onRetry();
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 transition-colors shadow-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reintentar sincronización
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-zinc-600 dark:text-zinc-400">
                {isDriveBusy ? 'Actualizando datos con Google Drive...' : 'Tus datos de lectura y ajustes están sincronizados con tu cuenta.'}
              </p>
              {lastSyncedDate && (
                <p className="text-[10px] text-zinc-400">
                  Última sincronización: {lastSyncedDate}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
