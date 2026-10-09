import React, { useMemo, useState } from 'react';
import { BarChart3, BookOpen, Clock, Languages, Star, Trash2, X } from 'lucide-react';
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
import {
  FrequentQuery,
  MAX_FREQUENT_QUERIES,
  normalizeFrequentQuery,
} from '../utils/frequentQueries';

interface Props {
  isOpen: boolean;
  entries: TranslationHistoryEntry[];
  favorites: TranslationFavorite[];
  frequentQueries: FrequentQuery[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onToggleFavorite: (candidate: TranslationFavoriteCandidate) => void;
  onClearFavorites: () => void;
  onClearFrequentQueries: () => void;
}

interface DisplayItem {
  id: string;
  query: string;
  kind?: TranslationFavoriteKind;
  provider?: string;
  response: string;
  date?: number;
  count?: number;
  candidate?: TranslationFavoriteCandidate;
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
  frequentQueries,
  onClose,
  onRemove,
  onClear,
  onToggleFavorite,
  onClearFavorites,
  onClearFrequentQueries,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'history' | 'favorites' | 'frequent'>('history');

  const latestHistoryByQuery = useMemo(() => {
    const latest = new Map<string, TranslationHistoryEntry>();
    entries.forEach((entry) => {
      const key = normalizeFrequentQuery(entry.query);
      const response = entry.response.trim();
      if (
        key &&
        response &&
        response !== 'No se pudo traducir el texto.' &&
        !latest.has(key)
      ) latest.set(key, entry);
    });
    return latest;
  }, [entries]);

  const frequentEntries = useMemo(
    () => frequentQueries.filter((entry) => entry.count >= 2 && latestHistoryByQuery.has(entry.key)),
    [frequentQueries, latestHistoryByQuery],
  );
  const displayItems = useMemo<DisplayItem[]>(() => {
    if (activeTab === 'history') {
      return entries.map((entry) => ({
        id: entry.id,
        query: entry.query,
        kind: entry.kind,
        provider: entry.provider,
        response: entry.response,
        date: entry.queriedAt,
        candidate: {
          query: entry.query,
          kind: entry.kind,
          ...(entry.provider ? { provider: entry.provider } : {}),
          response: entry.response,
        },
      }));
    }
    if (activeTab === 'favorites') {
      return favorites.map((entry) => ({
        id: entry.id,
        query: entry.query,
        kind: entry.kind,
        provider: entry.provider,
        response: entry.response,
        date: entry.savedAt,
        candidate: {
          query: entry.query,
          kind: entry.kind,
          ...(entry.provider ? { provider: entry.provider as TranslationFavoriteCandidate['provider'] } : {}),
          response: entry.response,
        },
      }));
    }
    return frequentEntries.map((entry) => {
      const latest = latestHistoryByQuery.get(entry.key);
      return {
        id: entry.key,
        query: entry.query,
        ...(latest ? {
          kind: latest.kind,
          provider: latest.provider,
          response: latest.response,
          candidate: {
            query: latest.query,
            kind: latest.kind,
            ...(latest.provider ? { provider: latest.provider } : {}),
            response: latest.response,
          },
        } : {
          response: 'No hay una definición guardada en el historial para esta consulta.',
        }),
        date: entry.updatedAt,
        count: entry.count,
      };
    });
  }, [activeTab, entries, favorites, frequentEntries, latestHistoryByQuery]);

  if (!isOpen) return null;

  const itemCount = displayItems.length;
  const clearDisplayed = activeTab === 'history'
    ? onClear
    : activeTab === 'favorites'
      ? onClearFavorites
      : onClearFrequentQueries;

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
              : activeTab === 'favorites'
                ? <Star className="h-5 w-5 fill-current text-amber-500" />
                : <BarChart3 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
            <h2 id="translation-history-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {activeTab === 'history'
                ? 'Historial de consultas'
                : activeTab === 'favorites'
                  ? 'Palabras favoritas'
                  : 'Consultas frecuentes'}
            </h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {itemCount}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {itemCount > 0 && (
              <button
                type="button"
                onClick={clearDisplayed}
                className="tap-area rounded-lg px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                {activeTab === 'history'
                  ? 'Borrar historial'
                  : activeTab === 'favorites'
                    ? 'Borrar favoritos'
                    : 'Borrar frecuentes'}
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

        <div className="grid grid-cols-3 gap-1 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            aria-pressed={activeTab === 'history'}
            className={`rounded-lg px-2 py-2 text-xs font-semibold ${
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
            className={`rounded-lg px-2 py-2 text-xs font-semibold ${
              activeTab === 'favorites'
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            Favoritos · {favorites.length}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('frequent')}
            aria-pressed={activeTab === 'frequent'}
            className={`rounded-lg px-2 py-2 text-xs font-semibold ${
              activeTab === 'frequent'
                ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            Frecuentes · {frequentEntries.length}
          </button>
        </div>

        {displayItems.length ? (
          <ul className="space-y-2 overflow-y-auto p-3">
            {displayItems.map((item) => {
              const expanded = expandedId === item.id;
              const favorite = item.candidate
                ? isTranslationFavorite(favorites, item.candidate)
                : false;
              return (
                <li key={item.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-start gap-2 p-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                      className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      aria-expanded={expanded}
                    >
                      <span className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
                        {item.kind === 'dictionary' || item.kind === 'glossary'
                          ? <BookOpen className="h-3 w-3" />
                          : <Languages className="h-3 w-3" />}
                        {item.kind ? getKindLabel({ kind: item.kind, provider: item.provider }) : 'Consulta'}
                        {activeTab === 'frequent' && (
                          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 normal-case text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                            {item.count} búsquedas
                          </span>
                        )}
                        {item.date !== undefined && activeTab !== 'frequent' && (
                          <span className="font-normal text-zinc-400">
                            {new Date(item.date).toLocaleString()}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                        {item.query}
                      </span>
                      {!expanded && (
                        <span className="mt-1 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {item.response}
                        </span>
                      )}
                    </button>
                    {activeTab === 'history' && (
                      <button
                        type="button"
                        onClick={() => onRemove(item.id)}
                        className="tap-area mt-1 rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                        aria-label={`Eliminar consulta: ${item.query}`}
                        title="Eliminar del historial"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => item.candidate && onToggleFavorite(item.candidate)}
                      disabled={!item.candidate}
                      className={`tap-area mt-1 rounded-lg p-2 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-amber-950/40 ${
                        favorite || activeTab === 'favorites' ? 'text-amber-500' : 'text-zinc-500'
                      }`}
                      aria-label={
                        !item.candidate
                          ? `No hay una respuesta guardada para: ${item.query}`
                          : favorite
                            ? `Quitar de favoritos: ${item.query}`
                            : `Añadir a favoritos: ${item.query}`
                      }
                      title={
                        !item.candidate
                          ? 'No hay una respuesta guardada en el historial'
                          : favorite
                            ? 'Quitar de favoritos'
                            : 'Añadir a favoritos'
                      }
                      aria-pressed={favorite}
                    >
                      <Star className={`h-4 w-4 ${favorite || activeTab === 'favorites' ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                  {expanded && (
                    <div className="mx-3 mb-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                      <p className="mb-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                        {item.query}
                      </p>
                      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                        {item.response}
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
              : activeTab === 'favorites'
                ? 'Guarda definiciones y traducciones con la estrella para encontrarlas aquí.'
                : 'Las consultas aparecerán aquí cuando las hayas buscado al menos dos veces.'}
          </p>
        )}
        <p className="border-t border-zinc-100 px-4 py-2 text-center text-[10px] text-zinc-400 dark:border-zinc-800">
          {activeTab === 'history'
            ? `Se conservan como máximo las ${MAX_TRANSLATION_HISTORY_ENTRIES} consultas más recientes de este libro.`
            : activeTab === 'favorites'
              ? `Se conservan como máximo ${MAX_TRANSLATION_FAVORITES} favoritos de este libro.`
              : `Se conservan como máximo ${MAX_FREQUENT_QUERIES} consultas de este libro; solo se muestran las buscadas dos veces o más.`}
        </p>
      </section>
    </div>
  );
};
