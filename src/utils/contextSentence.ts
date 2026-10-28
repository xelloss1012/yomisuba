/** The longest context kept with a favorite. */
export const MAX_CONTEXT_LENGTH = 200;

const SENTENCE_END = /[。！？!?…\n]/;
// Closing marks that belong to the sentence they end: 「…。」 keeps its 」.
const CLOSING = /[」』）)】〉》"'”’]/;
// Of those, the ones that can only close (a straight quote may open the next sentence).
const ONLY_CLOSING = /[」』）)】〉》”’]/;

/**
 * The sentence of a text that holds the characters from `start` to `end`: from the end of the previous
 * sentence to the end of this one, closing quotes included. A sentence longer than `max` is cut around
 * the word, with "…" where it was cut.
 */
export function sentenceAround(text: string, start: number, end: number, max = MAX_CONTEXT_LENGTH): string {
  let from = start;
  while (from > 0 && !SENTENCE_END.test(text[from - 1])) from -= 1;
  let to = Math.max(end, start);
  while (to < text.length && !SENTENCE_END.test(text[to])) to += 1;
  if (to < text.length && text[to] !== '\n') to += 1;
  while (to < text.length && CLOSING.test(text[to])) to += 1;

  // The spaces and closing marks left from the previous sentence are not part of this one.
  while (from < start && (/\s/.test(text[from]) || ONLY_CLOSING.test(text[from]))) from += 1;
  const sentence = text.slice(from, to).trimEnd();
  if (sentence.length <= max) return sentence.replace(/\s+/g, ' ');

  // Too long: keep `max` characters with the word in the middle.
  const room = Math.max(0, max - Math.max(0, end - start));
  const cutTo = Math.min(sentence.length, Math.max(0, start - from - Math.floor(room / 2)) + max);
  const cutFrom = Math.max(0, cutTo - max);
  return `${cutFrom > 0 ? '…' : ''}${sentence.slice(cutFrom, cutTo)}${cutTo < sentence.length ? '…' : ''}`.replace(/\s+/g, ' ');
}

interface FlatText {
  text: string;
  nodes: { node: Text; start: number }[];
}

/** The text of an element as it reads, without the readings of its ruby (`<rt>`, `<rp>`). */
export function readableText(root: Node): FlatText {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: FlatText['nodes'] = [];
  let text = '';
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.parentElement?.closest('rt, rp')) continue;
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  return { text, nodes };
}

/** Where a point of the DOM falls in the readable text, or null when it is in a ruby reading or outside. */
function offsetOf(flat: FlatText, container: Node, offset: number): number | null {
  if (container.nodeType === 3) {
    const found = flat.nodes.find((item) => item.node === container);
    return found ? found.start + Math.min(offset, (container as Text).data.length) : null;
  }
  // A point between children: the text of the children before it.
  const child = container.childNodes[offset] ?? null;
  for (const item of flat.nodes) {
    if (child ? (child === item.node || Boolean(child.compareDocumentPosition(item.node) & 20 /* FOLLOWING | CONTAINED_BY */)) : false) {
      return item.start;
    }
  }
  const last = flat.nodes[flat.nodes.length - 1];
  return last ? last.start + last.node.data.length : null;
}

/** The sentence a selected range is in, read without ruby readings. */
export function sentenceForRange(range: Range, root: Node, max = MAX_CONTEXT_LENGTH): string | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const flat = readableText(root);
  const start = offsetOf(flat, range.startContainer, range.startOffset);
  const end = offsetOf(flat, range.endContainer, range.endOffset);
  if (start === null || end === null || end < start) return null;
  const sentence = sentenceAround(flat.text, start, end, max);
  return sentence.trim() ? sentence : null;
}

/** The sentence of a text where a word first appears, trying each form given in turn. */
export function sentenceForWord(text: string, forms: string[], max = MAX_CONTEXT_LENGTH): string | null {
  for (const form of forms) {
    const word = form.trim();
    if (!word) continue;
    const at = text.indexOf(word);
    if (at >= 0) return sentenceAround(text, at, at + word.length, max);
  }
  return null;
}
