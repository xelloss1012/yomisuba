import type { JapaneseMorphologicalToken } from './dictionary';

type Token = JapaneseMorphologicalToken;

const isAdjectivalNoun = (token: Token | undefined): boolean =>
  token?.pos === '名詞' && token.pos_detail_1 === '形容動詞語幹';

/** 不安気, 自慢気: kuromoji cuts the suffix 気 off as a noun of its own, unlike 不安げ. */
export const isKiSuffix = (previous: Token | undefined, token: Token): boolean =>
  token.pos === '名詞' && token.surface_form === '気' && isAdjectivalNoun(previous);

const isKatakana = (text: string): boolean => /^[゠-ヿ]+$/.test(text);

/**
 * お金, 不安気: a prefix and the noun it starts are one word. Not before a word in katakana: that
 * is usually a word written so for effect (今オリ is 今 + オリ), and joined it would be found nowhere.
 */
export const isPrefixOfNoun = (previous: Token | undefined, token: Token): boolean =>
  previous?.pos === '接頭詞' && token.pos === '名詞' && !isKatakana(token.surface_form);

/** The word made of a prefix and the noun after it, which takes the noun's grammar. */
export const joinPrefix = (prefix: Token, noun: Token): Token => {
  const surface = prefix.surface_form + noun.surface_form;
  return {
    ...noun,
    surface_form: surface,
    reading: prefix.reading && noun.reading ? prefix.reading + noun.reading : noun.reading,
    basic_form: surface,
  };
};

/**
 * The pieces kuromoji cuts too fine in the same way wherever it is read: prefixes with their noun
 * and 気 with the adjectival noun before it. Verb endings are left to the callers, which treat them
 * differently.
 */
export const joinNounPieces = (tokens: Token[]): Token[] => {
  const joined: Token[] = [];
  for (const token of tokens) {
    const previous = joined[joined.length - 1];
    if (isPrefixOfNoun(previous, token)) {
      joined[joined.length - 1] = joinPrefix(previous, token);
    } else if (isKiSuffix(previous, token)) {
      const surface = previous.surface_form + token.surface_form;
      joined[joined.length - 1] = {
        ...previous,
        surface_form: surface,
        reading: previous.reading && token.reading ? previous.reading + token.reading : previous.reading,
        basic_form: surface,
      };
    } else {
      joined.push(token);
    }
  }
  return joined;
};
