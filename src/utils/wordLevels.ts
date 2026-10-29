/**
 * How common or useful a Japanese word is, so a learner can tell which words
 * are worth memorising. Built by scripts/build_word_levels.py from the JMdict
 * frequency tags, the JLPT lists of Jonathan Waller and KANJIDIC2; it ships
 * gzip-compressed (~250 KB) and is decompressed the first time it is needed.
 */
import wordLevelsUrl from '../data/word-levels.json.gz?inline';
import { tr } from './i18n';

/** JLPT level: 5 = N5 (easiest) … 1 = N1. */
export type JlptLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Frequency band for words without a JLPT level (and a coarse one for those with):
 * basic = among the ~3,000 most frequent, common = JMdict "common" or ranked
 * frequency, uncommon = listed but infrequent, rare = no frequency data and a
 * kanji outside the jōyō set.
 */
export type WordBand = 'basic' | 'common' | 'uncommon' | 'rare';

export interface WordLevel {
  jlpt?: JlptLevel;
  band: WordBand;
}

interface WordLevelsData {
  /** form → jlpt * 10 + band (band 1 basic, 2 common, 3 uncommon). */
  w: Record<string, number>;
  /** kanji → jlpt * 100 + school grade (1-6, 8 secondary jōyō, 9-10 jinmeiyō). */
  k: Record<string, number>;
}

const BANDS: WordBand[] = ['basic', 'common', 'uncommon'];
const KANJI = /[㐀-䶿一-鿿豈-﫿々]/g;

let dataPromise: Promise<WordLevelsData> | null = null;

export const loadWordLevels = (): Promise<WordLevelsData> => {
  if (!dataPromise) {
    dataPromise = (async () => {
      const response = await fetch(wordLevelsUrl);
      if (!response.ok || !response.body || typeof DecompressionStream === 'undefined') {
        throw new Error(tr('err.levelsLoad'));
      }
      return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
    })().catch((error) => {
      dataPromise = null;
      throw error;
    });
  }
  return dataPromise;
};

const kanjiOf = (form: string) => form.match(KANJI)?.filter((char) => char !== '々') || [];

/** Whether the kanji is jōyō (taught at school), the set a reader is expected to know. */
const isJoyo = (data: WordLevelsData, kanji: string) => {
  const grade = (data.k[kanji] || 0) % 100;
  return grade > 0 && grade <= 8;
};

export interface ClassifyOptions {
  /**
   * Classify a form the data does not list as uncommon or rare (by its kanji).
   * Only meaningful for single words, such as page tokens: a phrase or a
   * conjugated form that is not listed is not a rare word.
   */
  fallback?: boolean;
}

/** The JLPT level of a kanji (Jonathan Waller's lists), if it has one. */
export const kanjiJlpt = (data: WordLevelsData, kanji: string): JlptLevel | undefined => {
  const level = Math.floor((data.k[kanji] || 0) / 100);
  return level >= 1 && level <= 5 ? level as JlptLevel : undefined;
};

export const classifyWord = (
  data: WordLevelsData,
  form: string,
  { fallback = false }: ClassifyOptions = {},
): WordLevel | null => {
  const text = form.trim();
  if (!text) return null;
  const code = data.w[text];
  if (code !== undefined) {
    const jlpt = Math.floor(code / 10) as JlptLevel | 0;
    const bandCode = code % 10;
    // A JLPT word without frequency tags still gets the band of its level.
    const band = bandCode
      ? BANDS[bandCode - 1]
      : jlpt >= 4 ? 'basic' : jlpt >= 2 ? 'common' : 'uncommon';
    return jlpt ? { jlpt, band } : { band };
  }
  if (!fallback) return null;
  return { band: kanjiOf(text).some((kanji) => !isJoyo(data, kanji)) ? 'rare' : 'uncommon' };
};

/** The most useful level among several spellings of the same word (an entry's forms). */
export const classifyForms = (data: WordLevelsData, forms: string[]): WordLevel | null =>
  forms
    .map((form) => classifyWord(data, form))
    .filter((level): level is WordLevel => level !== null)
    .sort((left, right) => difficultyOf(left) - difficultyOf(right))[0] || null;

/**
 * Level of a dictionary entry. Its kanji spellings identify the word; kana
 * spellings are shared by homophones (かえる is 帰る, 変える and 蛙), so they only
 * count when the entry has no kanji.
 */
export const classifyEntry = (data: WordLevelsData, entry: { kanji: string[]; kana: string[] }) =>
  classifyForms(data, entry.kanji.length ? entry.kanji : entry.kana);

/**
 * One ordinal for sorting, easiest first: N5 = 1 … N1 = 5, and words without a
 * JLPT level by their band.
 */
export const difficultyOf = (level: WordLevel): number => {
  if (level.jlpt) return 6 - level.jlpt;
  return { basic: 1.5, common: 3.5, uncommon: 5.5, rare: 6 }[level.band];
};

/**
 * Bands a learner of each JLPT level is expected to know when a word has no
 * JLPT level of its own. Deliberately conservative: the "common" band alone
 * holds ~35,000 forms, far beyond N2.
 */
const KNOWN_BANDS: Record<JlptLevel, WordBand[]> = {
  5: [],
  4: [],
  3: ['basic'],
  2: ['basic'],
  1: ['basic', 'common'],
};

/**
 * Whether a word is within the reader's level ("Mi nivel"): its JLPT level is
 * the reader's or easier, or, without one, its band is expected at that level.
 * This is about knowing the word, as its badge shows; whether the reader can
 * read its kanji is kanjiWithinLevel's question (half the N5 and N4 words are
 * spelt with a kanji outside the N3 kanji list: 貼る, 鞄).
 */
export const isWithinLevel = (level: WordLevel | null, studyLevel: JlptLevel): boolean => {
  if (!level) return false;
  return level.jlpt ? level.jlpt >= studyLevel : KNOWN_BANDS[studyLevel].includes(level.band);
};

/** Whether every kanji of a form is at the reader's JLPT kanji level or easier. */
export const kanjiWithinLevel = (data: WordLevelsData, form: string, studyLevel: JlptLevel): boolean =>
  kanjiOf(form).every((kanji) => Math.floor((data.k[kanji] || 0) / 100) >= studyLevel);

export type { WordLevelsData };
