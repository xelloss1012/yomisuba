import { readableText, sentenceAround } from './contextSentence';
import type { JapaneseMorphologicalToken } from './dictionary';
import { mergeJapaneseTokens, MergedToken } from './tokenMerging';

/** The words of a chapter, as the reader's analysis gives them, with where they are in its text. */
export interface ChapterAnalysis {
  spineIndex: number;
  text: string;
  tokens: MergedToken[];
}

export interface GlossaryWord {
  /** The form looked up in the dictionary: the base form, or the joined surface of a compound. */
  key: string;
  /** How it is first written in the book. */
  surface: string;
  /** Its reading in the text (hiragana), when the text has it in its base form: 街 is まち here, not がい. */
  reading?: string;
  pos: string;
  /** Written without kanji in the book (ない, いい): it is classified by its kana form too. */
  writtenInKana: boolean;
  count: number;
  /** Occurrences per chapter (spine index → count). */
  perChapter: Map<number, number>;
  /** Order of first appearance in each chapter, to list a chapter's words as they come. */
  firstInChapter: Map<number, number>;
  firstChapter: number;
  /** The sentence it first appears in. */
  context: string;
}

const KANJI = /[㐀-䶿一-鿿豈-﫿々]/;
const JAPANESE = /[㐀-䶿一-鿿豈-﫿々ぁ-ゖァ-ヺー]/;

// Nouns that are not vocabulary to learn: numbers, pronouns, names, suffixes, and dependent forms (こと, もの).
const SKIP_NOUN = new Set(['数', '代名詞', '固有名詞', '非自立', '接尾', '特殊']);
// Verbs and adjectives that only help another word (いる in 食べている, しまう, ない after a verb).
const SKIP_DEPENDENT = new Set(['非自立', '接尾']);

/**
 * The form a word is listed under: its base form (走った → 走る), and a する verb under its noun
 * (激怒した → 激怒), which is how the JLPT lists and the dictionary have it.
 */
const lookupFormOf = (token: MergedToken['token']): string => {
  const base = token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form;
  return token.pos === '動詞' && base.length > 3 && base.endsWith('する') ? base.slice(0, -2) : base;
};

/** Whether a word of the text is worth learning: a noun, verb, adjective or adverb of its own. */
export function isStudyWord(token: MergedToken['token']): boolean {
  // Words kuromoji does not know (no base form) are mostly the names of the book's characters.
  if (!token.basic_form || token.basic_form === '*') return false;
  const form = lookupFormOf(token);
  if (!JAPANESE.test(form)) return false;
  // A lone kana (を, ね, っ) is grammar or noise; a lone kanji (剣, 魔) is a word.
  if (form.length === 1 && !KANJI.test(form)) return false;
  switch (token.pos) {
    case '名詞':
      return !SKIP_NOUN.has(token.pos_detail_1 ?? '');
    case '動詞':
    case '形容詞':
      return !SKIP_DEPENDENT.has(token.pos_detail_1 ?? '');
    case '副詞':
    case '形容動詞':
      return true;
    default:
      return false;
  }
}

/** The text of a chapter as it reads (without the readings of its ruby), from its HTML. */
export function chapterText(html: string, parse: (html: string) => Document): string {
  const doc = parse(html);
  const body = doc.body ?? doc.documentElement;
  for (const element of [...body.querySelectorAll('script, style')]) element.remove();
  // Paragraphs end a sentence even without a 。: give each block its own line.
  for (const block of [...body.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, br, tr, blockquote')]) {
    block.appendChild(doc.createTextNode('\n'));
  }
  return readableText(body).text.replace(/[ \t　]*\n[\s　]*/g, '\n').trim();
}

/** The analysis of a chapter: its tokens, joined as the page glossary joins them, placed in its text. */
export function analyzeChapter(spineIndex: number, text: string, morphology: JapaneseMorphologicalToken[]): ChapterAnalysis {
  const located: { token: JapaneseMorphologicalToken; start: number; end: number }[] = [];
  let searchFrom = 0;
  for (const token of morphology) {
    const start = text.indexOf(token.surface_form, searchFrom);
    if (start < 0) continue;
    const end = start + token.surface_form.length;
    searchFrom = end;
    located.push({ token, start, end });
  }
  return { spineIndex, text, tokens: mergeJapaneseTokens(located) };
}

/** The words of the chapters given, each once, with how often and where they appear. */
export function collectGlossary(chapters: ChapterAnalysis[]): GlossaryWord[] {
  const words = new Map<string, GlossaryWord>();
  for (const chapter of [...chapters].sort((a, b) => a.spineIndex - b.spineIndex)) {
    let order = 0;
    for (const { token, start, end } of chapter.tokens) {
      if (!isStudyWord(token)) continue;
      const key = lookupFormOf(token);
      let word = words.get(key);
      if (!word) {
        word = {
          key,
          surface: token.surface_form,
          ...(token.reading && token.reading !== '*' && token.surface_form === key ? { reading: toHiragana(token.reading) } : {}),
          pos: token.pos,
          writtenInKana: !KANJI.test(token.surface_form),
          count: 0,
          perChapter: new Map(),
          firstInChapter: new Map(),
          firstChapter: chapter.spineIndex,
          context: sentenceAround(chapter.text, start, end),
        };
        words.set(key, word);
      }
      word.count += 1;
      word.perChapter.set(chapter.spineIndex, (word.perChapter.get(chapter.spineIndex) ?? 0) + 1);
      if (!word.firstInChapter.has(chapter.spineIndex)) {
        word.firstInChapter.set(chapter.spineIndex, order);
        order += 1;
      }
    }
  }
  return [...words.values()];
}

/** Katakana to hiragana, to classify a word written in kana by its kana form. */
export const toHiragana = (text: string): string =>
  text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
