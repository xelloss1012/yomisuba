/**
 * What is known of each kanji in common use (the ~3,000 of the jōyō and jinmeiyō lists): readings,
 * meanings, strokes, school grade, frequency, the parts it is made of and its reading in Chinese, Korean
 * and Vietnamese. Built by scripts/build_kanji_data.py from KANJIDIC2 and KRADFILE (EDRDG, CC BY-SA
 * 4.0); it ships gzip-compressed (~300 KB) and is decompressed the first time a kanji is looked at.
 */
import kanjiDataUrl from '../data/kanji.json.gz?inline';
import { tr } from './i18n';

export interface KanjiRecord {
  s: number;
  /** School grade; absent for the rare kanji of the optional download. */
  g?: number;
  f?: number;
  on?: string[];
  kun?: string[];
  n?: string[];
  m: Partial<Record<'en' | 'es' | 'fr' | 'pt', string[]>>;
  py?: string[];
  ko?: string[];
  vi?: string[];
  c?: string[];
}

export interface KanjiInfo {
  literal: string;
  strokes: number;
  /** School grade: 1-6 primary, 8 secondary (the rest of the jōyō), 9-10 jinmeiyō (names), 0 none (a rare kanji). */
  grade: number;
  /** Rank among the 2,500 most frequent in newspapers (1 = most frequent). */
  frequency?: number;
  on: string[];
  /** Kun readings: the part after "." is okurigana, "-" marks a prefix or suffix. */
  kun: string[];
  /** Readings used only in names. */
  names: string[];
  /** Meanings in the language asked for, or in English when KANJIDIC2 has none in it. */
  meanings: string[];
  meaningLanguage: string;
  pinyin: string[];
  korean: string[];
  vietnamese: string[];
  /** The parts it is made of (radicals and components). */
  parts: string[];
}

let dataPromise: Promise<Record<string, KanjiRecord>> | null = null;

export const loadKanjiData = (): Promise<Record<string, KanjiRecord>> => {
  if (!dataPromise) {
    dataPromise = (async () => {
      const response = await fetch(kanjiDataUrl);
      if (!response.ok || !response.body || typeof DecompressionStream === 'undefined') {
        throw new Error(tr('err.kanjiLoad'));
      }
      const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json() as { kanji: Record<string, KanjiRecord> };
      return data.kanji;
    })().catch((error) => {
      dataPromise = null;
      throw error;
    });
  }
  return dataPromise;
};

const KANJI = /[㐀-䶿一-鿿豈-﫿]/gu;

/** The kanji of a text, each once, in the order they appear. */
export const kanjiOfText = (text: string): string[] => [...new Set(text.match(KANJI) ?? [])];

/** The info of a kanji, or null when it is not one of the kanji in common use. */
export const kanjiInfo = (data: Record<string, KanjiRecord>, literal: string, language: string): KanjiInfo | null => {
  const record = data[literal];
  if (!record) return null;
  const own = record.m[language as keyof KanjiRecord['m']];
  return {
    literal,
    strokes: record.s,
    grade: record.g ?? 0,
    ...(record.f ? { frequency: record.f } : {}),
    on: record.on ?? [],
    kun: record.kun ?? [],
    names: record.n ?? [],
    meanings: own?.length ? own : record.m.en ?? [],
    meaningLanguage: own?.length ? language : 'en',
    pinyin: (record.py ?? []).map(pinyinWithTones),
    korean: record.ko ?? [],
    vietnamese: record.vi ?? [],
    parts: record.c ?? [],
  };
};

const TONE_MARKS: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à'], e: ['ē', 'é', 'ě', 'è'], i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'], u: ['ū', 'ú', 'ǔ', 'ù'], ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

/** "ji1" → "jī": the tone number as a mark, on the vowel pinyin puts it on (a or e, the o of ou, else the last). */
export const pinyinWithTones = (syllable: string): string => {
  const match = /^([a-zü:v]+)([1-5])$/i.exec(syllable);
  if (!match) return syllable;
  const letters = match[1].replace(/u:|v/g, 'ü');
  const tone = Number(match[2]);
  if (tone === 5) return letters;
  const at = /[ae]/.test(letters) ? letters.search(/[ae]/)
    : letters.includes('ou') ? letters.indexOf('o')
      : Math.max(...['a', 'e', 'i', 'o', 'u', 'ü'].map((vowel) => letters.lastIndexOf(vowel)));
  if (at < 0) return letters;
  return letters.slice(0, at) + TONE_MARKS[letters[at]][tone - 1] + letters.slice(at + 1);
};

/** A kun reading as it is written: はげ.しい → はげ(しい); the affix mark stays. */
export const kunReading = (reading: string): string => {
  const [stem, okurigana] = reading.split('.');
  return okurigana ? `${stem}(${okurigana})` : stem;
};
