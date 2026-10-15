/**
 * Furigana modes beyond the book's own ruby: generated readings for words that
 * have none ("always") and readings only for words above the reader's level
 * ("difficult").
 *
 * Generated readings come from Kuromoji and are drawn by CSS as an absolutely
 * positioned ::after on a <span class="gf" data-gf="reading"> around the kanji.
 * Unlike a real <ruby>, that takes no space in the line (a <ruby> widens its
 * base when the reading is longer: 志 → こころざし), so the layout, and with it
 * the pagination measured on the book's plain HTML, stays exactly the same.
 */
import type { JapaneseMorphologicalToken } from './dictionary';
import { classifyWord, isWithinLevel, JlptLevel, kanjiWithinLevel, WordLevelsData } from './wordLevels';

export type FuriganaMode = 'original' | 'hidden' | 'always' | 'difficult';

export const FURIGANA_MODES: FuriganaMode[] = ['original', 'hidden', 'always', 'difficult'];

/** Settings saved before the modes existed only carry `showFurigana`. */
export const resolveFuriganaMode = (settings: { furiganaMode?: FuriganaMode; showFurigana: boolean }): FuriganaMode =>
  settings.furiganaMode ?? (settings.showFurigana ? 'original' : 'hidden');

/** Classes on #reader-scroller that hide the book's readings for a mode. */
export const applyFuriganaClasses = (scroller: Element, mode: FuriganaMode) => {
  scroller.classList.toggle('hide-furigana', mode === 'hidden');
  scroller.classList.toggle('furigana-difficult', mode === 'difficult');
};

/** Settings for a mode, keeping the older showFurigana flag consistent with it. */
export const furiganaModeSettings = (mode: FuriganaMode) => ({ furiganaMode: mode, showFurigana: mode !== 'hidden' });

/** Modes that rewrite the chapter (and so need Kuromoji and the level data). */
export const furiganaModeAnnotates = (mode: FuriganaMode) => mode === 'always' || mode === 'difficult';

const KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヶ]/;
const KANA = /[぀-ヿー]/;

const toHiragana = (text: string) =>
  text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));

export interface FuriganaSegment {
  text: string;
  /** Reading of a run of kanji; absent on kana (okurigana) runs. */
  reading?: string;
}

/**
 * Splits a word's reading over its kanji runs, leaving the okurigana bare:
 * 食べる + タベル → 食(た)べる; 取り扱い + トリアツカイ → 取(と)り扱(あつか)い.
 * Returns null when the reading does not fit the spelling (Kuromoji guessed an
 * unknown word, or the word mixes in digits or Latin letters).
 */
export const alignReading = (surface: string, reading: string): FuriganaSegment[] | null => {
  if (!reading || reading === '*' || !KANJI.test(surface)) return null;
  const runs: FuriganaSegment[] = [];
  for (const char of surface) {
    const isKanji = KANJI.test(char);
    if (!isKanji && !KANA.test(char)) return null;
    const last = runs[runs.length - 1];
    if (last && (last.reading !== undefined) === isKanji) last.text += char;
    else runs.push(isKanji ? { text: char, reading: '' } : { text: char });
  }
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${runs.map((run) => (run.reading !== undefined ? '(.+?)' : escape(toHiragana(run.text)))).join('')}$`);
  const match = toHiragana(reading).match(pattern);
  if (!match) return null;
  let group = 1;
  for (const run of runs) {
    if (run.reading !== undefined) run.reading = match[group++];
  }
  return runs;
};

export interface FuriganaOptions {
  mode: FuriganaMode;
  tokenize: (text: string) => Promise<JapaneseMorphologicalToken[]>;
  levels: WordLevelsData | null;
  /** The reader's JLPT level; "difficult" assumes a beginner (N5) without it. */
  studyLevel?: JlptLevel;
}

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, dt, dd, td, th, blockquote, figcaption, caption, div';
const SKIPPED_ANCESTORS = 'rt, rp, script, style, svg, math';

/** A word is "difficult" when it is above the reader's level. Grammar never is. */
const isDifficult = (token: JapaneseMorphologicalToken, options: FuriganaOptions) => {
  if (!options.levels) return true;
  const studyLevel = options.studyLevel ?? 5;
  const form = token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form;
  const level = classifyWord(options.levels, form);
  // Furigana is about reading the kanji. A JLPT word is judged by its level too
  // (今日 is N5 but not read こんにち), while one without a JLPT level (やって来る,
  // a name) is judged by its kanji alone: its frequency band says nothing about
  // whether the reader can read it.
  return level?.jlpt
    ? !(isWithinLevel(level, studyLevel) && kanjiWithinLevel(options.levels, token.surface_form, studyLevel))
    : !kanjiWithinLevel(options.levels, token.surface_form, studyLevel);
};

/**
 * Adds generated readings to a chapter (and, in "difficult" mode, marks the
 * book's own ruby on easy words so it can be hidden). Returns the rewritten HTML.
 */
export const annotateFurigana = async (rawHtml: string, options: FuriganaOptions): Promise<string> => {
  if (!furiganaModeAnnotates(options.mode)) return rawHtml;
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');

  // Text of each innermost block, as one string per block mapped back to its
  // text nodes, so Kuromoji sees whole sentences (ruby bases included).
  interface Piece { node: Text; start: number; ruby: Element | null }
  const blocks: Array<{ text: string; pieces: Piece[] }> = [];
  const leafBlocks = [...doc.body.querySelectorAll(BLOCK_SELECTOR)]
    .filter((element) => !element.querySelector(BLOCK_SELECTOR));
  for (const block of leafBlocks) {
    const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const pieces: Piece[] = [];
    let text = '';
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIPPED_ANCESTORS)) continue;
      pieces.push({ node, start: text.length, ruby: parent.closest('ruby') });
      text += node.data;
    }
    if (KANJI.test(text)) blocks.push({ text, pieces });
  }
  if (!blocks.length) return rawHtml;

  // One tokenizer call per chapter: blocks joined by newlines, which Kuromoji
  // never merges into a token.
  const tokens = await options.tokenize(blocks.map((block) => block.text).join('\n'));

  const wraps = new Map<Text, Array<{ start: number; end: number; reading: string }>>();
  const easyRuby = new Set<Element>();
  const hardRuby = new Set<Element>();
  let blockIndex = 0;
  let blockStart = 0;
  let cursor = 0;
  for (const token of tokens) {
    // Kuromoji reports where each token starts; summing lengths would drift if
    // it ever skipped a character.
    const start = token.word_position ? token.word_position - 1 : cursor;
    cursor = start + token.surface_form.length;
    // Advance to the block holding this token (skipping the joining newlines).
    while (blockIndex < blocks.length && start >= blockStart + blocks[blockIndex].text.length) {
      blockStart += blocks[blockIndex].text.length + 1;
      blockIndex += 1;
    }
    const block = blocks[blockIndex];
    if (!block || !KANJI.test(token.surface_form)) continue;
    const offset = start - blockStart;
    const pieces = block.pieces.filter((piece) =>
      piece.start < offset + token.surface_form.length && piece.start + piece.node.data.length > offset
    );
    const difficult = options.mode === 'always' || isDifficult(token, options);

    // The book already gives this word a reading: keep it, or hide it if easy.
    const rubies = pieces.map((piece) => piece.ruby).filter((ruby): ruby is Element => ruby !== null);
    if (rubies.length) {
      for (const ruby of rubies) (difficult ? hardRuby : easyRuby).add(ruby);
      continue;
    }
    // Only words inside a single text node: one split across markup is rare
    // and not worth guessing where its kanji fall.
    if (!difficult || pieces.length !== 1) continue;
    const segments = alignReading(token.surface_form, token.reading || '');
    if (!segments) continue;
    const piece = pieces[0];
    let position = offset - piece.start;
    const list = wraps.get(piece.node) || [];
    for (const segment of segments) {
      if (segment.reading) list.push({ start: position, end: position + segment.text.length, reading: segment.reading });
      position += segment.text.length;
    }
    wraps.set(piece.node, list);
  }

  // A ruby shared by an easy and a difficult word keeps its reading.
  for (const ruby of easyRuby) {
    if (!hardRuby.has(ruby)) ruby.setAttribute('data-furigana-easy', '');
  }

  for (const [node, list] of wraps) {
    const fragment = doc.createDocumentFragment();
    let last = 0;
    for (const { start, end, reading } of list) {
      if (start > last) fragment.append(node.data.slice(last, start));
      const span = doc.createElement('span');
      span.className = 'gf';
      span.setAttribute('data-gf', reading);
      span.textContent = node.data.slice(start, end);
      fragment.append(span);
      last = end;
    }
    if (last < node.data.length) fragment.append(node.data.slice(last));
    node.replaceWith(fragment);
  }

  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
};
