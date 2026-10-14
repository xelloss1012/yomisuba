import React, { useMemo, useState } from 'react';
import { BarChart3, Clock, Star, Trash2, X } from 'lucide-react';
import { AI_PROVIDER_LABELS } from '../utils/aiTranslation';
import {
  MAX_TRANSLATION_HISTORY_ENTRIES,
  TranslationHistoryEntry,
  DictionaryHistoryData,
  getHistoryEntryResponse,
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
  normalizeFrequentQuery,
} from '../utils/frequentQueries';
import { t, UiLanguage } from '../utils/i18n';

interface Props {
  isOpen: boolean;
  entries: TranslationHistoryEntry[];
  favorites: TranslationFavorite[];
  frequentQueries: FrequentQuery[];
  language?: UiLanguage;
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
  data?: DictionaryHistoryData;
  date?: number;
  count?: number;
  candidate?: TranslationFavoriteCandidate;
}

/**
 * Renders an item using the current UI language. Dictionary/glossary entries
 * keep their structured `data`, so the labels (Base form / Terms / Reading…)
 * are translated at display time instead of being baked in when stored.
 */
const renderItemResponse = (item: DisplayItem, language: UiLanguage): string =>
  getHistoryEntryResponse(item, language);

const getKindLabel = (entry: { kind: TranslationFavoriteKind; provider?: string }, language: UiLanguage = 'es') => {
  if (entry.kind === 'dictionary') return t('common.dictionary', language);
  if (entry.kind === 'glossary') return t('nav.glossary', language);
  if (entry.kind === 'ai' && entry.provider) {
    const provider = entry.provider as keyof typeof AI_PROVIDER_LABELS;
    return `AI · ${AI_PROVIDER_LABELS[provider] || entry.provider}`;
  }
  return t('common.translate', language);
};

export const TranslationHistoryModal: React.FC<Props> = ({
  isOpen,
  entries,
  favorites,
  frequentQueries,
  language = 'es',
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
      const response = getHistoryEntryResponse(entry, language).trim();
      if (
        key &&
        response &&
        response !== 'No se pudo traducir el texto.' &&
        !latest.has(key)
      ) latest.set(key, entry);
    });
    return latest;
  }, [entries, language]);

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
        response: entry.response || '',
        data: entry.data,
        date: entry.queriedAt,
        candidate: {
          query: entry.query,
          kind: entry.kind,
          ...(entry.provider ? { provider: entry.provider } : {}),
          response: getHistoryEntryResponse(entry, language),
          ...(entry.data ? { data: entry.data } : {}),
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
        data: entry.data,
        candidate: entry,
      }));
    }
    return frequentEntries.map((frequent) => {
      const entry = latestHistoryByQuery.get(frequent.key);
      return {
        id: frequent.key,
        query: entry?.query || frequent.key,
        kind: entry?.kind,
        provider: entry?.provider,
        response: entry ? getHistoryEntryResponse(entry, language) : '',
        data: entry?.data,
        count: frequent.count,
        candidate: entry ? {
          query: entry.query,
          kind: entry.kind,
          ...(entry.provider ? { provider: entry.provider } : {}),
          response: getHistoryEntryResponse(entry, language),
          ...(entry.data ? { data: entry.data } : {}),
        } : undefined,
      };
    });
  }, [activeTab, entries, favorites, frequentEntries, language, latestHistoryByQuery]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-modal-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h2 id="history-modal-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t('history.title', language)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-area rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={t('nav.close', language)}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div role="tablist" aria-label={t('history.title', language)} className="grid grid-cols-3 gap-1 border-b border-zinc-200 p-2 dark:border-zinc-800">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            onClick={() => setActiveTab('history')}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium ${
              activeTab === 'history'
                ? 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            {t('history.tabHistory', language)}
            <span className="text-[10px] opacity-70">({entries.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'favorites'}
            onClick={() => setActiveTab('favorites')}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium ${
              activeTab === 'favorites'
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            <Star className="h-3.5 w-3.5" />
            {t('history.tabFavorites', language)}
            <span className="text-[10px] opacity-70">({favorites.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'frequent'}
            onClick={() => setActiveTab('frequent')}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium ${
              activeTab === 'frequent'
                ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            {t('history.tabFrequent', language)}
            <span className="text-[10px] opacity-70">({frequentEntries.length})</span>
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 dark:border-zinc-800/80">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {activeTab === 'history' && t('history.maxEntries', language).replace('{count}', String(MAX_TRANSLATION_HISTORY_ENTRIES))}
            {activeTab === 'favorites' && t('history.savedFavs', language).replace('{count}', String(favorites.length)).replace('{max}', String(MAX_TRANSLATION_FAVORITES))}
            {activeTab === 'frequent' && t('history.frequentTerms', language)}
          </span>
          {displayItems.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (activeTab === 'history') onClear();
                else if (activeTab === 'favorites') onClearFavorites();
                else onClearFrequentQueries();
              }}
              className="tap-area text-[11px] font-medium text-rose-600 hover:underline dark:text-rose-400"
            >
              {t('history.clear', language)}
            </button>
          )}
        </div>

        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-3">
          {displayItems.length ? (
            <ul className="space-y-2">
              {displayItems.map((item) => {
                const isFavorite = item.candidate ? isTranslationFavorite(favorites, item.candidate) : false;
                const isExpanded = expandedId === item.id;
                return (
                  <li
                    key={item.id}
                    className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-800/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {item.query}
                          </span>
                          {item.kind && (
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                              {getKindLabel({ kind: item.kind, provider: item.provider }, language)}
                            </span>
                          )}
                          {item.count !== undefined && (
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                              {item.count} {t('history.queries', language)}
                            </span>
                          )}
                        </div>
                        <p className={`mt-1 text-xs text-zinc-600 dark:text-zinc-300 ${isExpanded ? '' : 'line-clamp-2'}`}>
                          {renderItemResponse(item, language)}
                        </p>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {item.candidate && (
                          <button
                            type="button"
                            onClick={() => onToggleFavorite(item.candidate!)}
                            className={`tap-area rounded-lg p-2 transition-colors ${
                              isFavorite
                                ? 'text-amber-500 hover:text-amber-600 dark:text-amber-400'
                                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'
                            }`}
                            title={isFavorite ? t('glossary.removeFav', language) : t('glossary.addFav', language)}
                            aria-label={isFavorite ? t('glossary.removeFav', language) : t('glossary.addFav', language)}
                          >
                            <Star className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} />
                          </button>
                        )}
                        {activeTab === 'history' && (
                          <button
                            type="button"
                            onClick={() => onRemove(item.id)}
                            className="tap-area rounded-lg p-2 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400"
                            title={t('common.delete', language)}
                            aria-label={t('common.delete', language)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t('history.empty', language)}
            </p>
          )}
        </div>
      </section>
    </div>
  );
};
