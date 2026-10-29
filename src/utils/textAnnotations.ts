export interface TextAnnotation {
  id: string;
  spineIndex: number;
  quote: string;
  prefix: string;
  suffix: string;
  /** What the reader wrote about the passage, if anything. */
  note?: string;
  /** Chosen to be studied in the reviews of the study panel. */
  review?: boolean;
}

export const MAX_NOTE_LENGTH = 2000;

/** The note of an annotation as it is stored: trimmed, within the limit, or none. */
export const normalizeNote = (note: unknown): string | undefined => {
  if (typeof note !== 'string') return undefined;
  const text = note.trim().slice(0, MAX_NOTE_LENGTH);
  return text || undefined;
};

export const readTextAnnotations = (storageKey: string): TextAnnotation[] => {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TextAnnotation =>
      Boolean(
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        Number.isInteger(item.spineIndex) &&
        typeof item.quote === 'string' &&
        item.quote.length > 0 &&
        typeof item.prefix === 'string' &&
        typeof item.suffix === 'string'
      )
    ).map((item) => {
      // A note that is not text (a damaged or foreign file) is dropped; the underline stays.
      const { note, review, ...rest } = item;
      const clean = normalizeNote(note);
      return { ...rest, ...(clean ? { note: clean } : {}), ...(review === true ? { review } : {}) };
    });
  } catch {
    return [];
  }
};

export const captureTextAnnotation = (
  range: Range,
  root: HTMLElement,
  spineIndex: number,
): Omit<TextAnnotation, 'id'> | null => {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const before = root.ownerDocument.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);

  const after = root.ownerDocument.createRange();
  after.selectNodeContents(root);
  after.setStart(range.endContainer, range.endOffset);

  const quote = range.toString();
  if (!quote.trim()) return null;

  return {
    spineIndex,
    quote,
    prefix: before.toString().slice(-48),
    suffix: after.toString().slice(0, 48),
  };
};

const commonSuffixLength = (left: string, right: string) => {
  let length = 0;
  while (
    length < left.length &&
    length < right.length &&
    left[left.length - length - 1] === right[right.length - length - 1]
  ) {
    length += 1;
  }
  return length;
};

const commonPrefixLength = (left: string, right: string) => {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) {
    length += 1;
  }
  return length;
};

const findAnnotationOffset = (text: string, annotation: Omit<TextAnnotation, 'id'>) => {
  let searchFrom = 0;
  let bestOffset = -1;
  let bestScore = -1;
  while (searchFrom <= text.length - annotation.quote.length) {
    const offset = text.indexOf(annotation.quote, searchFrom);
    if (offset === -1) break;
    const prefix = text.slice(Math.max(0, offset - annotation.prefix.length), offset);
    const suffix = text.slice(offset + annotation.quote.length, offset + annotation.quote.length + annotation.suffix.length);
    const score =
      commonSuffixLength(annotation.prefix, prefix) +
      commonPrefixLength(annotation.suffix, suffix);
    if (score > bestScore) {
      bestOffset = offset;
      bestScore = score;
    }
    searchFrom = offset + 1;
  }
  return bestOffset;
};

const textNodes = (root: HTMLElement) => {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest('script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  return nodes;
};

const getRangeAtOffsets = (root: HTMLElement, start: number, end: number) => {
  const nodes = textNodes(root);
  let cursor = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const node of nodes) {
    const nodeEnd = cursor + node.data.length;
    if (!startNode && start <= nodeEnd) {
      startNode = node;
      startOffset = Math.max(0, start - cursor);
    }
    if (end <= nodeEnd) {
      endNode = node;
      endOffset = Math.max(0, end - cursor);
      break;
    }
    cursor = nodeEnd;
  }

  if (!startNode || !endNode) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
};

const textContent = (root: HTMLElement) => textNodes(root).map((node) => node.data).join('');

export const findTextAnnotationRange = (
  root: HTMLElement,
  annotation: TextAnnotation,
): Range | null => {
  const offset = findAnnotationOffset(textContent(root), annotation);
  return offset >= 0
    ? getRangeAtOffsets(root, offset, offset + annotation.quote.length)
    : null;
};

// --- The mark beside the text ---------------------------------------------------
//
// The highlight alone is a tinted background, which is easy to lose (especially over the analyzer's own
// tints). Each underlined passage also gets a line on the side opposite to the furigana: on the left of
// vertical text (the furigana is on the right) and under horizontal text. The line is drawn in a layer
// of its own that is positioned over the text and takes no space, so the pagination does not change.

const UNDERLINE_LAYER = 'data-annotation-underlines';
const UNDERLINE_THICKNESS = 2;

interface Segment {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The rectangles of the base text of a range, leaving out the furigana (<rt>) that sits inside it. */
const baseTextRects = (range: Range): DOMRect[] => {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return [];
  const rects: DOMRect[] = [];
  const addPart = (node: Text) => {
    if (node.parentElement?.closest('rt, rp')) return;
    const part = doc.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    rects.push(...Array.from(part.getClientRects()));
  };
  const ancestor = range.commonAncestorContainer;
  if (ancestor.nodeType === 3) {
    addPart(ancestor as Text);
    return rects;
  }
  const walker = doc.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (range.intersectsNode(node)) addPart(node as Text);
  }
  return rects;
};

/** Neighbouring rectangles of the same line (or column) become one segment, so that the line has no seams. */
const joinSegments = (rects: DOMRect[], vertical: boolean): Segment[] => {
  const segments: Segment[] = [];
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    const last = segments[segments.length - 1];
    const sameLine = last && (vertical
      ? Math.abs(rect.left - last.left) < 1.5 && Math.abs(rect.right - last.right) < 1.5 && rect.top <= last.bottom + 1.5 && rect.bottom >= last.top - 1.5
      : Math.abs(rect.top - last.top) < 1.5 && Math.abs(rect.bottom - last.bottom) < 1.5 && rect.left <= last.right + 1.5 && rect.right >= last.left - 1.5);
    if (sameLine) {
      last.top = Math.min(last.top, rect.top);
      last.bottom = Math.max(last.bottom, rect.bottom);
      last.left = Math.min(last.left, rect.left);
      last.right = Math.max(last.right, rect.right);
    } else {
      segments.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    }
  }
  return segments;
};

interface MarkedRange {
  range: Range;
  id: string;
  note?: string;
}

type ObservedRoot = HTMLElement & { __annotationRanges?: MarkedRange[]; __annotationWatch?: boolean };

/** The event the page raises when a note marker is tapped; its detail has the annotation id. */
export const NOTE_MARKER_EVENT = 'yomisuba-note';
const NOTE_MARKER_SIZE = 24;

/** A marker beside the first line of an annotation that has a note: a dot, tappable, taking no space. */
const noteMarker = (doc: Document, id: string, note: string, x: number, y: number): HTMLElement => {
  const marker = doc.createElement('span');
  marker.setAttribute('data-annotation-note', id);
  marker.setAttribute('role', 'button');
  marker.title = note.length > 140 ? `${note.slice(0, 139)}…` : note;
  marker.setAttribute('aria-label', marker.title);
  marker.style.cssText = `position: absolute; left: ${x - NOTE_MARKER_SIZE / 2}px; top: ${y - NOTE_MARKER_SIZE / 2}px; width: ${NOTE_MARKER_SIZE}px; height: ${NOTE_MARKER_SIZE}px; display: flex; align-items: center; justify-content: center; pointer-events: auto; cursor: pointer; touch-action: manipulation;`;
  const dot = doc.createElement('span');
  dot.style.cssText = 'width: 9px; height: 9px; border-radius: 50%; background: var(--reader-annotation-line, #4338ca); box-shadow: 0 0 0 2px var(--reader-page-bg, #ffffff);';
  marker.appendChild(dot);
  // The reader's own tap and swipe handlers must not take a tap on the marker for a page turn.
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
    marker.addEventListener(type, (event) => event.stopPropagation());
  }
  marker.addEventListener('click', (event) => {
    event.stopPropagation();
    doc.dispatchEvent(new CustomEvent(NOTE_MARKER_EVENT, { detail: { id } }));
  });
  return marker;
};

const drawUnderlines = (root: ObservedRoot) => {
  const doc = root.ownerDocument;
  doc.querySelector(`[${UNDERLINE_LAYER}]`)?.remove();
  const ranges = root.__annotationRanges || [];
  if (ranges.length === 0) return;

  const vertical = (doc.defaultView?.getComputedStyle(root).writingMode || '').startsWith('vertical');
  const origin = root.getBoundingClientRect();
  const layer = doc.createElement('div');
  layer.setAttribute(UNDERLINE_LAYER, '');
  layer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 4; margin: 0; padding: 0;';
  for (const { range, id, note } of ranges) {
    const segments = joinSegments(baseTextRects(range), vertical);
    if (note && segments.length > 0) {
      // At the start of the passage, on the side of its line: top-left of vertical text, left end of horizontal.
      const first = segments[0];
      layer.appendChild(noteMarker(
        doc,
        id,
        note,
        first.left - origin.left + (vertical ? 1 : 0),
        vertical ? first.top - origin.top : first.bottom - origin.top - UNDERLINE_THICKNESS / 2,
      ));
    }
    for (const segment of segments) {
      const line = doc.createElement('span');
      const geometry = vertical
        ? `left: ${segment.left - origin.left}px; top: ${segment.top - origin.top}px; width: ${UNDERLINE_THICKNESS}px; height: ${segment.bottom - segment.top}px;`
        : `left: ${segment.left - origin.left}px; top: ${segment.bottom - origin.top - UNDERLINE_THICKNESS}px; width: ${segment.right - segment.left}px; height: ${UNDERLINE_THICKNESS}px;`;
      line.style.cssText = `position: absolute; ${geometry} background: var(--reader-annotation-line, #4338ca); border-radius: 1px;`;
      layer.appendChild(line);
    }
  }
  root.appendChild(layer);
};

/** Draws the lines again when the text is laid out anew (the window is resized, a font arrives). */
const watchLayout = (root: ObservedRoot) => {
  if (root.__annotationWatch) return;
  const win = root.ownerDocument.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null;
  if (!win) return;
  root.__annotationWatch = true;
  let frame = 0;
  const redraw = () => {
    win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(() => drawUnderlines(root));
  };
  if (win.ResizeObserver) new win.ResizeObserver(redraw).observe(root);
  void root.ownerDocument.fonts?.ready.then(redraw);
};

export const applyTextAnnotations = (
  root: HTMLElement,
  annotations: TextAnnotation[],
) => {
  const win = root.ownerDocument.defaultView as (Window & {
    Highlight?: { new (...ranges: Range[]): unknown };
    CSS?: { highlights?: { set(key: string, value: unknown): void; delete(key: string): void } };
  }) | null;
  if (!win || !win.Highlight || !win.CSS || !win.CSS.highlights) return;

  const ranges: Range[] = [];
  const marked: MarkedRange[] = [];
  for (const annotation of annotations) {
    const range = findTextAnnotationRange(root, annotation);
    if (range) {
      ranges.push(range);
      marked.push({ range, id: annotation.id, note: annotation.note });
    }
  }

  if (ranges.length > 0) {
    const HighlightConstructor = win.Highlight;
    const highlight = new HighlightConstructor(...ranges);
    win.CSS.highlights.set('reader-annotation', highlight);
  } else {
    win.CSS.highlights.delete('reader-annotation');
  }
  (root as ObservedRoot).__annotationRanges = marked;
  drawUnderlines(root as ObservedRoot);
  watchLayout(root as ObservedRoot);
};

export const removeTextAnnotationMarkup = (root: HTMLElement, _id: string) => {
  const win = root.ownerDocument.defaultView as (Window & { CSS?: { highlights?: { delete(key: string): void } } }) | null;
  if (win?.CSS?.highlights) {
    win.CSS.highlights.delete('reader-annotation');
  }
  (root as ObservedRoot).__annotationRanges = [];
  root.ownerDocument.querySelector(`[${UNDERLINE_LAYER}]`)?.remove();
};

export const applyTextAnnotationToRange = (_range: Range, _id: string) => {
  // Handled by state update and applyTextAnnotations re-render
};
