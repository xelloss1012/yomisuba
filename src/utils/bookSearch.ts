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

export const normalizeChar = (char: string): string => {
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

/**
 * Locates ranges by searchable-text offset. Built once per laid-out chapter,
 * it answers any number of lookups without walking the DOM again, which is
 * what makes placing hundreds of hits on their pages cheap.
 */
export const createSearchLocator = (root: Node, doc: Document) => {
  const nodes = textNodesOf(root, doc);
  // starts[i] = searchable characters before node i; the last entry is the total.
  const starts: number[] = [];
  let total = 0;
  for (const node of nodes) {
    starts.push(total);
    for (const char of node.nodeValue || '') total += normalizeChar(char).length;
  }
  starts.push(total);

  // Code-unit span, inside `node`, of the character holding searchable offset `within`.
  const spanIn = (node: Text, within: number): [number, number] | null => {
    let kept = 0;
    let unit = 0;
    for (const char of node.nodeValue || '') {
      const size = normalizeChar(char).length;
      if (size && within < kept + size) return [unit, unit + char.length];
      kept += size;
      unit += char.length;
    }
    return null;
  };

  const nodeIndexAt = (position: number): number => {
    if (position < 0 || position >= total) return -1;
    // First node that starts beyond `position`; the one before it holds it.
    let low = 1;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (starts[middle] > position) high = middle;
      else low = middle + 1;
    }
    return low - 1;
  };

  /** Range covering `length` searchable characters from offset `start`. */
  const locate = (start: number, length: number): Range | null => {
    const first = nodeIndexAt(start);
    const last = nodeIndexAt(start + Math.max(1, length) - 1);
    if (first < 0 || last < 0) return null;
    const startSpan = spanIn(nodes[first], start - starts[first]);
    const endSpan = spanIn(nodes[last], start + Math.max(1, length) - 1 - starts[last]);
    if (!startSpan || !endSpan) return null;
    const range = doc.createRange();
    range.setStart(nodes[first], startSpan[0]);
    range.setEnd(nodes[last], endSpan[1]);
    return range;
  };

  return { locate, length: total };
};

/** Range covering `length` searchable characters from offset `start`. */
export const locateSearchRange = (
  root: Node,
  doc: Document,
  start: number,
  length: number,
): Range | null => createSearchLocator(root, doc).locate(start, length);

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

/** Searchable-text offset of the first character on a page, if it has text. */
export const textOffsetOfPage = (
  root: Node,
  doc: Document,
  page: number,
  scroller: HTMLElement,
  vertical: boolean,
  viewportWidth: number,
  viewportHeight: number,
  existingLocator?: ReturnType<typeof createSearchLocator>,
): number | null => {
  const locator = existingLocator || createSearchLocator(root, doc);
  if (!locator.length) return null;

  let low = 0;
  let high = locator.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const range = locator.locate(middle, 1);
    if (!range || pageOfRange(range, scroller, vertical, viewportWidth, viewportHeight) < page) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const range = locator.locate(low, 1);
  return range && pageOfRange(range, scroller, vertical, viewportWidth, viewportHeight) === page
    ? low
    : null;
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
