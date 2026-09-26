import React, { useState } from 'react';
import { BookOpen, Clock, Languages, Trash2, X } from 'lucide-react';
import { AI_PROVIDER_LABELS } from '../utils/aiTranslation';
import { TranslationHistoryEntry } from '../utils/translationHistory';

interface Props {
  isOpen: boolean;
  entries: TranslationHistoryEntry[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

const getKindLabel = (entry: TranslationHistoryEntry) => {
  if (entry.kind === 'dictionary') return 'Diccionario';
  if (entry.kind === 'ai' && entry.provider) return `IA · ${AI_PROVIDER_LABELS[entry.provider]}`;
  return 'Traducción';
};

export const TranslationHistoryModal: React.FC<Props> = ({
  isOpen,
  entries,
  onClose,
  onRemove,
  onClear,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (!isOpen) return null;

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
            <Clock className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h2 id="translation-history-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Historial de consultas
            </h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {entries.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {entries.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="tap-area rounded-lg px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                Borrar todo
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

        {entries.length ? (
          <ul className="space-y-2 overflow-y-auto p-3">
            {entries.map((entry) => {
              const expanded = expandedId === entry.id;
              return (
                <li
                  key={entry.id}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="flex items-start gap-2 p-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : entry.id)}
                      className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      aria-expanded={expanded}
                    >
                      <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
                        {entry.kind === 'dictionary'
                          ? <BookOpen className="h-3 w-3" />
                          : <Languages className="h-3 w-3" />}
                        {getKindLabel(entry)}
                        <span className="font-normal text-zinc-400">
                          {new Date(entry.queriedAt).toLocaleString()}
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
                    <button
                      type="button"
                      onClick={() => onRemove(entry.id)}
                      className="tap-area mt-1 rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                      aria-label={`Eliminar consulta: ${entry.query}`}
                      title="Eliminar del historial"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
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
            Las consultas de diccionario, traducción e IA aparecerán aquí.
          </p>
        )}
        <p className="border-t border-zinc-100 px-4 py-2 text-center text-[10px] text-zinc-400 dark:border-zinc-800">
          Se conservan como máximo las 100 consultas más recientes de este libro.
        </p>
      </section>
    </div>
  );
};
