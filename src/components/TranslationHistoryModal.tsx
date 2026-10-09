import React, { useState } from 'react';
import { BookOpen, Clock, Languages, Star, Trash2, X } from 'lucide-react';
import { AI_PROVIDER_LABELS } from '../utils/aiTranslation';
import {
  MAX_TRANSLATION_HISTORY_ENTRIES,
  TranslationHistoryEntry,
} from '../utils/translationHistory';
import {
  isTranslationFavorite,
  MAX_TRANSLATION_FAVORITES,
  TranslationFavorite,
  TranslationFavoriteCandidate,
  TranslationFavoriteKind,
} from '../utils/translationFavorites';

interface Props {
  isOpen: boolean;
  entries: TranslationHistoryEntry[];
  favorites: TranslationFavorite[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onToggleFavorite: (candidate: TranslationFavoriteCandidate) => void;
  onClearFavorites: () => void;
}

const getKindLabel = (entry: { kind: TranslationFavoriteKind; provider?: string }) => {
  if (entry.kind === 'dictionary') return 'Diccionario';
  if (entry.kind === 'glossary') return 'Glosario';
  if (entry.kind === 'ai' && entry.provider) {
    const provider = entry.provider as keyof typeof AI_PROVIDER_LABELS;
    return `IA · ${AI_PROVIDER_LABELS[provider] || entry.provider}`;
  }
  return 'Traducción';
};

export const TranslationHistoryModal: React.FC<Props> = ({
  isOpen,
  entries,
  favorites,
  onClose,
  onRemove,
  onClear,
  onToggleFavorite,
  onClearFavorites,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'history' | 'favorites'>('history');
  if (!isOpen) return null;
  const displayedEntries = activeTab === 'history' ? entries : favorites;
  const clearDisplayed = activeTab === 'history' ? onClear : onClearFavorites;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="translation-history-title"
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            {activeTab === 'history'
              ? <Clock className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              : <Star className="h-5 w-5 fill-current text-amber-500" />}
            <h2 id="translation-history-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {activeTab === 'history' ? 'Historial de consultas' : 'Palabras favoritas'}
            </h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {displayedEntries.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {displayedEntries.length > 0 && (
              <button
                type="button"
                onClick={clearDisplayed}
                className="tap-area rounded-lg px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                {activeTab === 'history' ? 'Borrar historial' : 'Borrar favoritos'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="tap-area rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Cerrar historial"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-1 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            aria-pressed={activeTab === 'history'}
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${
              activeTab === 'history'
                ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
                : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            Historial · {entries.length}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('favorites')}
            aria-pressed={activeTab === 'favorites'}
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${
              activeTab === 'favorites'
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            Favoritos · {favorites.length}
          </button>
        </div>

        {displayedEntries.length ? (
          <ul className="space-y-2 overflow-y-auto p-3">
            {displayedEntries.map((entry) => {
              const expanded = expandedId === entry.id;
              const candidate: TranslationFavoriteCandidate = {
                query: entry.query,
                kind: entry.kind,
                ...(entry.provider ? { provider: entry.provider as TranslationFavoriteCandidate['provider'] } : {}),
                response: entry.response,
              };
              const favorite = isTranslationFavorite(favorites, candidate);
              const queriedAt = 'savedAt' in entry ? entry.savedAt : entry.queriedAt;
              return (
                <li key={entry.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-start gap-2 p-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : entry.id)}
                      className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      aria-expanded={expanded}
                    >
                      <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
                        {entry.kind === 'dictionary' || entry.kind === 'glossary'
                          ? <BookOpen className="h-3 w-3" />
                          : <Languages className="h-3 w-3" />}
                        {getKindLabel(entry)}
                        <span className="font-normal text-zinc-400">
                          {new Date(queriedAt).toLocaleString()}
                        </span>
                      </span>
                      <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                        {entry.query}
                      </span>
                      {!expanded && (
                        <span className="mt-1 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {entry.response}
                        </span>
                      )}
                    </button>
                    {activeTab === 'history' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onToggleFavorite(candidate)}
                          className={`tap-area mt-1 rounded-lg p-2 hover:bg-amber-50 dark:hover:bg-amber-950/40 ${
                            favorite ? 'text-amber-500' : 'text-zinc-500'
                          }`}
                          aria-label={favorite ? `Quitar de favoritos: ${entry.query}` : `Añadir a favoritos: ${entry.query}`}
                          title={favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                          aria-pressed={favorite}
                        >
                          <Star className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemove(entry.id)}
                          className="tap-area mt-1 rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                          aria-label={`Eliminar consulta: ${entry.query}`}
                          title="Eliminar del historial"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggleFavorite(candidate)}
                        className="tap-area mt-1 rounded-lg p-2 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                        aria-label={`Quitar de favoritos: ${entry.query}`}
                        title="Quitar de favoritos"
                        aria-pressed="true"
                      >
                        <Star className="h-4 w-4 fill-current" />
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <div className="mx-3 mb-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                      <p className="mb-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                        {entry.query}
                      </p>
                      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                        {entry.response}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {activeTab === 'history'
              ? 'Las consultas de diccionario, traducción e IA aparecerán aquí.'
              : 'Guarda definiciones y traducciones con la estrella para encontrarlas aquí.'}
          </p>
        )}
        <p className="border-t border-zinc-100 px-4 py-2 text-center text-[10px] text-zinc-400 dark:border-zinc-800">
          {activeTab === 'history'
            ? `Se conservan como máximo las ${MAX_TRANSLATION_HISTORY_ENTRIES} consultas más recientes de este libro.`
            : `Se conservan como máximo ${MAX_TRANSLATION_FAVORITES} favoritos de este libro.`}
        </p>
      </section>
    </div>
  );
};
