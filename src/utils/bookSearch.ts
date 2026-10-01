// Full-text search inside the open book.
//
// A match is addressed by its character offset in the chapter's *searchable
// text*, not by a page: pages depend on font, size and window, the text does
// not. The same extraction runs over the raw chapter HTML (to build the
// index) and over the live, laid-out chapter (to find where a hit lands), so
// an offset means the same place in both.
//
// The searchable text drops whitespace (Japanese has none to speak of, and
// EPUB line breaks must not split a phrase), ruby readings and script/style,
// and folds full-width forms and case, so ＡＢＣ finds abc.

export interface SearchHit {
  spineIndex: number;
  start: number;
  length: number;
  before: string;
  match: string;
  after: string;
}

export const MAX_SEARCH_HITS = 300;
const SNIPPET_CONTEXT = 22;

const SKIPPED = 'rt, rp, script, style';

const normalizeChar = (char: string): string => {
  if (/\s/.test(char)) return '';
  const folded = char.normalize('NFKC');
  // Only fold when the length is preserved, so offsets stay aligned.
  const base = folded.length === char.length ? folded : char;
  const lower = base.toLowerCase();
  return lower.length === base.length ? lower : base;
};

export const normalizeSearchQuery = (value: string): string => {
  let out = '';
  for (const char of value) out += normalizeChar(char);
  return out;
};

const textNodesOf = (root: Node, doc: Document): Text[] => {
  const nodes: Text[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (parent && parent.closest(SKIPPED)) continue;
    nodes.push(node as Text);
  }
  return nodes;
};

/** Searchable text of a chapter (or any subtree). */
export const extractSearchText = (root: Node, doc: Document): string => {
  let out = '';
  for (const node of textNodesOf(root, doc)) {
    const value = node.nodeValue || '';
    for (const char of value) out += normalizeChar(char);
  }
  return out;
};

/** Range covering `length` searchable characters from offset `start`. */
export const locateSearchRange = (
  root: Node,
  doc: Document,
  start: number,
  length: number,
): Range | null => {
  const end = start + length;
  let position = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const node of textNodesOf(root, doc)) {
    const value = node.nodeValue || '';
    let unit = 0;
    for (const char of value) {
      const kept = normalizeChar(char).length;
      if (kept) {
        if (!startNode && position >= start) {
          startNode = node;
          startOffset = unit;
        }
        position += kept;
        if (position >= end) {
          endNode = node;
          endOffset = unit + char.length;
          break;
        }
      }
      unit += char.length;
    }
    if (endNode) break;
  }
  if (!startNode || !endNode) return null;
  const range = doc.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
};

/** Non-overlapping matches of `query` (already normalised) inside `text`. */
export const findHits = (
  text: string,
  query: string,
  spineIndex: number,
  limit: number,
): SearchHit[] => {
  const hits: SearchHit[] = [];
  if (!query) return hits;
  let from = 0;
  while (hits.length < limit) {
    const at = text.indexOf(query, from);
    if (at === -1) break;
    hits.push({
      spineIndex,
      start: at,
      length: query.length,
      before: text.slice(Math.max(0, at - SNIPPET_CONTEXT), at),
      match: text.slice(at, at + query.length),
      after: text.slice(at + query.length, at + query.length + SNIPPET_CONTEXT),
    });
    from = at + query.length;
  }
  return hits;
};

/**
 * Page (0-based) of the chapter on which a range starts. Rects of the range and
 * of the scroller are compared with each other, so a transform applied to the
 * scroller (current page, sliding animation) cancels out.
 */
export const pageOfRange = (
  range: Range,
  scroller: HTMLElement,
  vertical: boolean,
  viewportWidth: number,
  viewportHeight: number,
): number => {
  // A collapsed range has no rect; use the first character instead.
  const firstChar = range.cloneRange();
  if (firstChar.startContainer.nodeType === Node.TEXT_NODE) {
    const length = (firstChar.startContainer as Text).length;
    firstChar.setEnd(firstChar.startContainer, Math.min(length, firstChar.startOffset + 1));
  }
  const rect = firstChar.getClientRects()[0] || firstChar.getBoundingClientRect();
  const base = scroller.getBoundingClientRect();
  if (vertical) return Math.max(0, Math.floor((rect.top - base.top + 1) / viewportHeight));
  return Math.max(0, Math.floor((rect.left - base.left + 1) / viewportWidth));
};

// ── Recent searches ──────────────────────────────────────────────────────────

export const MAX_RECENT_SEARCHES = 20;

export const readRecentSearches = (storageKey: string): string[] => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
};

const writeRecentSearches = (storageKey: string, list: string[]) => {
  try {
    if (list.length) localStorage.setItem(storageKey, JSON.stringify(list));
    else localStorage.removeItem(storageKey);
  } catch {
    // Recent searches are a convenience; storage failures must not get in the way.
  }
};

export const addRecentSearch = (storageKey: string, list: string[], query: string): string[] => {
  const value = query.trim();
  if (!value) return list;
  const next = [value, ...list.filter((item) => item !== value)].slice(0, MAX_RECENT_SEARCHES);
  writeRecentSearches(storageKey, next);
  return next;
};

export const removeRecentSearch = (storageKey: string, list: string[], query: string): string[] => {
  const next = list.filter((item) => item !== query);
  writeRecentSearches(storageKey, next);
  return next;
};

export const clearRecentSearches = (storageKey: string): string[] => {
  writeRecentSearches(storageKey, []);
  return [];
};
