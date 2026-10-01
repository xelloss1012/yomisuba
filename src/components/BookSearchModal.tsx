import React, { useEffect, useMemo, useRef, useState } from 'react';
import { History, Loader2, Search, Trash2, X } from 'lucide-react';
import {
  findHits,
  MAX_SEARCH_HITS,
  normalizeSearchQuery,
  SearchHit,
} from '../utils/bookSearch';

interface Props {
  isOpen: boolean;
  /** Text to search for as soon as the panel opens (e.g. the selection). */
  initialQuery: string;
  /** Changes every time the panel is opened, so the same text can be re-sent. */
  openToken: number;
  spineCount: number;
  getChapterText: (spineIndex: number) => Promise<string>;
  /** Pages (0-based, within the chapter) of several hits of one chapter. */
  getHitPages: (spineIndex: number, hits: Array<{ start: number; length: number }>) => Promise<number[]>;
  getPageLabel: (spineIndex: number, page: number) => string;
  getChapterLabel: (spineIndex: number) => string;
  recentSearches: string[];
  onRememberSearch: (query: string) => void;
  onRemoveRecent: (query: string) => void;
  onClearRecents: () => void;
  onClose: () => void;
  onSelectHit: (hit: SearchHit) => void;
}

const SEARCH_DELAY_MS = 250;

export const BookSearchModal: React.FC<Props> = ({
  isOpen,
  initialQuery,
  openToken,
  spineCount,
  getChapterText,
  getHitPages,
  getPageLabel,
  getChapterLabel,
  recentSearches,
  onRememberSearch,
  onRemoveRecent,
  onClearRecents,
  onClose,
  onSelectHit,
}) => {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [texts, setTexts] = useState<string[]>([]);
  const [indexedCount, setIndexedCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const indexRunRef = useRef(0);
  // Page of each hit, keyed by chapter:start:length. Filled by laying the
  // chapters out, so it matches the page the reader will actually open.
  const hitPagesRef = useRef<Map<string, number>>(new Map());
  const [pagesVersion, setPagesVersion] = useState(0);

  // Open with the text handed in (selection) or with an empty, focused box.
  useEffect(() => {
    if (!isOpen) return;
    hitPagesRef.current.clear();
    setPagesVersion((version) => version + 1);
    setInput(initialQuery);
    setQuery(initialQuery);
    if (!initialQuery) window.setTimeout(() => inputRef.current?.focus(), 60);
  }, [isOpen, initialQuery, openToken]);

  // Build the text index chapter by chapter, yielding between chapters so the
  // panel stays responsive. Chapters are cached by the caller, so reopening
  // the panel finds everything ready.
  useEffect(() => {
    if (!isOpen) return;
    const run = indexRunRef.current + 1;
    indexRunRef.current = run;
    const collected: string[] = [];
    let cancelled = false;
    const index = async () => {
      for (let spine = 0; spine < spineCount; spine += 1) {
        if (cancelled || indexRunRef.current !== run) return;
        try {
          collected[spine] = await getChapterText(spine);
        } catch {
          collected[spine] = '';
        }
        if (spine % 6 === 5 || spine === spineCount - 1) {
          setTexts(collected.slice());
          setIndexedCount(spine + 1);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }
    };
    void index();
    return () => {
      cancelled = true;
    };
  }, [getChapterText, isOpen, spineCount]);

  // Search only once typing (or IME composition) has paused.
  useEffect(() => {
    if (composing) return;
    const timer = window.setTimeout(() => setQuery(input), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [composing, input]);

  const normalizedQuery = useMemo(() => normalizeSearchQuery(query), [query]);
  const isIndexing = indexedCount < spineCount;

  const { hits, truncated } = useMemo(() => {
    if (!normalizedQuery) return { hits: [] as SearchHit[], truncated: false };
    const found: SearchHit[] = [];
    for (let spine = 0; spine < texts.length; spine += 1) {
      const text = texts[spine];
      if (!text) continue;
      const room = MAX_SEARCH_HITS + 1 - found.length;
      found.push(...findHits(text, normalizedQuery, spine, room));
      if (found.length > MAX_SEARCH_HITS) break;
    }
    return {
      hits: found.slice(0, MAX_SEARCH_HITS),
      truncated: found.length > MAX_SEARCH_HITS,
    };
  }, [normalizedQuery, texts]);

  // Place the hits on their pages, one chapter per layout pass, so each result
  // can show where it is. Results stay usable meanwhile; a new query abandons
  // the pass between chapters.
  useEffect(() => {
    if (!isOpen || !hits.length) return;
    let cancelled = false;
    const pending = new Map<number, SearchHit[]>();
    for (const hit of hits) {
      if (hitPagesRef.current.has(`${hit.spineIndex}:${hit.start}:${hit.length}`)) continue;
      const group = pending.get(hit.spineIndex);
      if (group) group.push(hit);
      else pending.set(hit.spineIndex, [hit]);
    }
    const place = async () => {
      for (const [spineIndex, group] of pending) {
        if (cancelled) return;
        try {
          const pages = await getHitPages(spineIndex, group);
          if (cancelled) return;
          group.forEach((hit, position) => {
            hitPagesRef.current.set(`${hit.spineIndex}:${hit.start}:${hit.length}`, pages[position] ?? 0);
          });
          setPagesVersion((version) => version + 1);
        } catch {
          // A chapter that cannot be laid out simply shows no page number.
        }
      }
    };
    void place();
    return () => {
      cancelled = true;
    };
  }, [getHitPages, hits, isOpen]);

  if (!isOpen) return null;

  const submit = () => {
    setQuery(input);
    if (input.trim()) onRememberSearch(input);
  };

  const pickRecent = (value: string) => {
    setInput(value);
    setQuery(value);
    onRememberSearch(value);
  };

  let lastChapter = -1;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-search-title"
        className="flex h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h2 id="book-search-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Buscar en el libro
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-area rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Cerrar búsqueda"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <form
          className="border-b border-zinc-200 p-3 dark:border-zinc-800"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
            inputRef.current?.blur();
          }}
        >
          <div className="flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-950">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              ref={inputRef}
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(event) => {
                setComposing(false);
                setInput(event.currentTarget.value);
              }}
              placeholder="Palabra o frase…"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent py-3 text-base text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              aria-label="Texto a buscar"
            />
            {input && (
              <button
                type="button"
                onClick={() => {
                  setInput('');
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className="tap-area rounded-full p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                aria-label="Borrar texto"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-2 flex min-h-4 items-center gap-2 px-1 text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
            {isIndexing && (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Preparando el libro… {indexedCount}/{spineCount}</span>
              </>
            )}
            {!isIndexing && normalizedQuery && (
              <span>
                {hits.length
                  ? truncated
                    ? `Primeras ${MAX_SEARCH_HITS} coincidencias`
                    : `${hits.length} ${hits.length === 1 ? 'coincidencia' : 'coincidencias'}`
                  : 'Sin coincidencias'}
              </span>
            )}
          </div>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!normalizedQuery ? (
            recentSearches.length ? (
              <div className="p-3">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    <History className="h-3.5 w-3.5" />
                    Búsquedas recientes
                  </span>
                  <button
                    type="button"
                    onClick={onClearRecents}
                    className="tap-area rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    Borrar todo
                  </button>
                </div>
                <ul className="space-y-1">
                  {recentSearches.map((recent) => (
                    <li key={recent} className="flex items-center gap-1 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/70">
                      <button
                        type="button"
                        onClick={() => pickRecent(recent)}
                        className="tap-area min-w-0 flex-1 truncate px-3 py-3 text-left text-sm text-zinc-800 dark:text-zinc-100"
                      >
                        {recent}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveRecent(recent)}
                        className="tap-area rounded-lg p-2 text-zinc-400 hover:text-red-600 dark:hover:text-red-300"
                        aria-label={`Quitar "${recent}" de las búsquedas recientes`}
                        title="Quitar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Escribe una palabra o frase, o selecciona texto en el libro y elige «Buscar en el libro».
              </p>
            )
          ) : (
            <ul className="p-2">
              {hits.map((hit) => {
                const showHeading = hit.spineIndex !== lastChapter;
                lastChapter = hit.spineIndex;
                return (
                  <React.Fragment key={`${hit.spineIndex}:${hit.start}`}>
                    {showHeading && (
                      <li className="sticky top-0 z-10 bg-white/95 px-3 pb-1 pt-3 text-xs font-semibold text-zinc-500 backdrop-blur dark:bg-zinc-900/95 dark:text-zinc-400">
                        {getChapterLabel(hit.spineIndex)}
                      </li>
                    )}
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          onRememberSearch(query);
                          onSelectHit(hit);
                        }}
                        className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm leading-relaxed text-zinc-700 hover:bg-zinc-50 active:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/70 dark:active:bg-zinc-800"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-zinc-500 dark:text-zinc-400">…{hit.before}</span>
                          <mark className="rounded bg-amber-200 px-0.5 text-zinc-900 dark:bg-amber-400/80">
                            {hit.match}
                          </mark>
                          <span className="text-zinc-500 dark:text-zinc-400">{hit.after}…</span>
                        </span>
                        <span
                          className="mt-0.5 shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                          data-pages-version={pagesVersion}
                        >
                          {(() => {
                            const page = hitPagesRef.current.get(`${hit.spineIndex}:${hit.start}:${hit.length}`);
                            return page === undefined ? 'p. …' : getPageLabel(hit.spineIndex, page);
                          })()}
                        </span>
                      </button>
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
};
