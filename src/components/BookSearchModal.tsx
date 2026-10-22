import React, { useEffect, useMemo, useRef, useState } from 'react';
import { History, Loader2, Search, Trash2, X } from 'lucide-react';
import {
  findHits,
  MAX_SEARCH_HITS,
  normalizeSearchQuery,
  SearchHit,
} from '../utils/bookSearch';
import { useT } from '../i18n/LanguageContext';
import { searchNotes } from '../utils/noteSearch';
import type { TextAnnotation } from '../utils/textAnnotations';

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
  /** The underlines that have a note, with the name of their chapter: their notes are searched too. */
  notes: Array<TextAnnotation & { chapterLabel: string }>;
  onSelectNote: (annotation: TextAnnotation) => void;
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
  notes,
  onSelectNote,
}) => {
  const t = useT();
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
    if (!normalizedQuery) return { hits: [], truncated: false };
    const allHits: SearchHit[] = [];
    for (let spineIndex = 0; spineIndex < texts.length; spineIndex += 1) {
      const text = texts[spineIndex];
      if (!text) continue;
      const chapterHits = findHits(text, normalizedQuery, spineIndex, MAX_SEARCH_HITS - allHits.length);
      for (const hit of chapterHits) {
        allHits.push({ ...hit, spineIndex });
      }
      if (allHits.length >= MAX_SEARCH_HITS) break;
    }
    return { hits: allHits, truncated: allHits.length >= MAX_SEARCH_HITS };
  }, [normalizedQuery, texts]);

  const noteHits = useMemo(() => searchNotes(notes, query), [notes, query]);

  // Request chapter page numbers for hits as they appear.
  useEffect(() => {
    if (!isOpen || hits.length === 0) return;
    let cancelled = false;
    const computePages = async () => {
      const byChapter = new Map<number, Array<{ start: number; length: number }>>();
      for (const hit of hits) {
        const key = `${hit.spineIndex}:${hit.start}:${hit.length}`;
        if (hitPagesRef.current.has(key)) continue;
        let list = byChapter.get(hit.spineIndex);
        if (!list) {
          list = [];
          byChapter.set(hit.spineIndex, list);
        }
        list.push({ start: hit.start, length: hit.length });
      }
      if (byChapter.size === 0) return;

      for (const [spineIndex, chapterHits] of byChapter.entries()) {
        if (cancelled) return;
        try {
          const pages = await getHitPages(spineIndex, chapterHits);
          if (cancelled) return;
          for (let i = 0; i < chapterHits.length; i += 1) {
            const hit = chapterHits[i];
            const page = pages[i];
            if (page !== undefined) {
              hitPagesRef.current.set(`${spineIndex}:${hit.start}:${hit.length}`, page);
            }
          }
          setPagesVersion((v) => v + 1);
        } catch {
          // Individual chapter page resolution failure shouldn't break search.
        }
      }
    };
    void computePages();
    return () => {
      cancelled = true;
    };
  }, [getHitPages, hits, isOpen]);

  if (!isOpen) return null;

  const submit = () => {
    if (hits.length > 0) {
      onRememberSearch(query);
      onSelectHit(hits[0]);
    } else if (noteHits.length > 0) {
      onRememberSearch(query);
      onSelectNote(noteHits[0].annotation);
    }
  };

  const pickRecent = (recent: string) => {
    setInput(recent);
    setQuery(recent);
    inputRef.current?.focus();
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
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h2 id="book-search-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t('search.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-area rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={t('nav.close')}
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
              placeholder={t('search.placeholder')}
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent py-3 text-base text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              aria-label={t('search.placeholder')}
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
                aria-label={t('common.cancel')}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-2 flex min-h-4 items-center gap-2 px-1 text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
            {isIndexing && (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{t('search.preparing')} {indexedCount}/{spineCount}</span>
              </>
            )}
            {!isIndexing && normalizedQuery && (
              <span>
                {[
                  hits.length
                    ? truncated
                      ? t('search.firstMatches').replace('{count}', String(MAX_SEARCH_HITS))
                      : `${hits.length} ${hits.length === 1 ? t('search.match') : t('search.matches')}`
                    : '',
                  noteHits.length ? `${noteHits.length} ${t('search.inNotes')}` : '',
                ].filter(Boolean).join(' · ') || t('search.noResults')}
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
                    {t('search.recent')}
                  </span>
                  <button
                    type="button"
                    onClick={onClearRecents}
                    className="tap-area rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {t('search.clearRecents')}
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
                        aria-label={`${t('common.delete')} "${recent}"`}
                        title={t('common.delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                {t('search.empty')}
              </p>
            )
          ) : (
            <ul className="p-2">
              {noteHits.length > 0 && (
                <li className="sticky top-0 z-10 bg-white/95 px-3 pb-1 pt-3 text-xs font-semibold text-amber-700 backdrop-blur dark:bg-zinc-900/95 dark:text-amber-300">
                  {t('search.notesHeading')}
                </li>
              )}
              {noteHits.map((hit) => (
                <li key={`note-${hit.annotation.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onRememberSearch(query);
                      onSelectNote(hit.annotation);
                    }}
                    className="flex w-full flex-col gap-1 rounded-xl border-l-2 border-amber-400 px-3 py-2.5 text-left text-sm leading-relaxed text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800/70"
                  >
                    <span className="whitespace-pre-line">
                      <span className="text-zinc-500 dark:text-zinc-400">{hit.before ? `…${hit.before}` : ''}</span>
                      <mark className="rounded bg-amber-200 px-0.5 text-zinc-900 dark:bg-amber-400/80">{hit.match}</mark>
                      <span className="text-zinc-500 dark:text-zinc-400">{hit.after ? `${hit.after}…` : ''}</span>
                    </span>
                    <span lang="ja" className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {hit.annotation.chapterLabel} · "{hit.annotation.quote}"
                    </span>
                  </button>
                </li>
              ))}
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
                            return page === undefined ? `${t('pagination.pageShort')} …` : getPageLabel(hit.spineIndex, page);
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
