export interface TextAnnotation {
  id: string;
  spineIndex: number;
  quote: string;
  prefix: string;
  suffix: string;
}

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
    );
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
  for (const annotation of annotations) {
    const offset = findAnnotationOffset(textContent(root), annotation);
    if (offset >= 0) {
      const range = getRangeAtOffsets(root, offset, offset + annotation.quote.length);
      if (range) ranges.push(range);
    }
  }

  if (ranges.length > 0) {
    const HighlightConstructor = win.Highlight;
    const highlight = new HighlightConstructor(...ranges);
    win.CSS.highlights.set('reader-annotation', highlight);
  } else {
    win.CSS.highlights.delete('reader-annotation');
  }
};

export const removeTextAnnotationMarkup = (root: HTMLElement, _id: string) => {
  const win = root.ownerDocument.defaultView as (Window & { CSS?: { highlights?: { delete(key: string): void } } }) | null;
  if (win?.CSS?.highlights) {
    win.CSS.highlights.delete('reader-annotation');
  }
};

export const applyTextAnnotationToRange = (_range: Range, _id: string) => {
  // Handled by state update and applyTextAnnotations re-render
};
