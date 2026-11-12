import {
  auxiliaryTeFormVerbs,
  contractedTeFormVerbs,
  contractedTeRuForms,
  JapaneseMorphologicalToken,
} from './dictionary';
import { isKiSuffix, isPrefixOfNoun, joinPrefix } from './tokenFixes';

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

export interface LocatedToken {
  token: JapaneseMorphologicalToken;
  start: number;
  end: number;
}

export interface MergedToken {
  token: JapaneseMorphologicalToken & {
    joinedSuffix?: boolean;
    joinedConjugation?: boolean;
    joinedTeForm?: boolean;
  };
  start: number;
  end: number;
}

const EXPRESSION_PARTICLES = new Set(['に', 'を', 'が', 'で', 'と']);

/**
 * The dictionary form of the set phrase that may start at a word: a noun, a particle and a verb or
 * adjective (身に着けている → 身に着ける, 気に入った → 気に入る, 目を覚まし → 目を覚ます). Whether it
 * is one is for the dictionary to say.
 */
const expressionAt = (tokens: MergedToken[], index: number): string | null => {
  const [noun, particle, predicate] = tokens.slice(index, index + 3);
  if (!noun || !particle || !predicate) return null;
  if (noun.end !== particle.start || particle.end !== predicate.start) return null;
  if (noun.token.pos !== '名詞' || noun.token.pos_detail_1 === '数') return null;
  if (particle.token.pos !== '助詞' || !EXPRESSION_PARTICLES.has(particle.token.surface_form)) return null;
  if (!['動詞', '形容詞'].includes(predicate.token.pos)) return null;
  const base = predicate.token.basic_form;
  if (!base || base === '*') return null;
  return noun.token.surface_form + particle.token.surface_form + base;
};

/**
 * The adverb a noun and に may make: 無性に, 一緒に. kuromoji reads 無性に as one word in some sentences
 * and as 無性 + に in others (無性に殴りたい). Not when the noun is qualified (彼の先に is "ahead of
 * him", not 先に, "first"), nor with nouns of time or place, whose に keeps its own meaning (前に).
 */
const ADVERB_NOUNS = new Set(['一般', 'サ変接続']);
const QUALIFYING_PARTICLES = new Set(['の', 'が']);

const adverbAt = (tokens: MergedToken[], index: number): string | null => {
  const [noun, particle] = tokens.slice(index, index + 2);
  if (!noun || !particle || noun.end !== particle.start) return null;
  if (noun.token.pos !== '名詞' || !ADVERB_NOUNS.has(noun.token.pos_detail_1 ?? "")) return null;
  if (particle.token.pos !== '助詞' || particle.token.surface_form !== 'に') return null;
  const before = tokens[index - 1];
  if (before?.end === noun.start && before.token.pos === '助詞' && QUALIFYING_PARTICLES.has(before.token.surface_form)) return null;
  return noun.token.surface_form + particle.token.surface_form;
};

/** The set phrases the words could make, to ask the dictionary which of them it lists. */
export const expressionCandidates = (tokens: MergedToken[]): string[] =>
  tokens.flatMap((_, index) => [expressionAt(tokens, index), adverbAt(tokens, index)].filter((form): form is string => Boolean(form)));

/** Joins into one word each set phrase that the dictionary lists (`known`). */
export const joinExpressions = (tokens: MergedToken[], known: ReadonlySet<string>): MergedToken[] => {
  const joined: MergedToken[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const form = expressionAt(tokens, index);
    if (!form || !known.has(form)) {
      const adverb = adverbAt(tokens, index);
      if (adverb && known.has(adverb)) {
        const [noun, particle] = tokens.slice(index, index + 2);
        joined.push({
          start: noun.start,
          end: particle.end,
          token: {
            ...noun.token,
            pos: '副詞',
            pos_detail_1: '一般',
            surface_form: adverb,
            reading: noun.token.reading && particle.token.reading ? noun.token.reading + particle.token.reading : noun.token.reading,
            basic_form: adverb,
          },
        });
        index += 1;
        continue;
      }
      joined.push(tokens[index]);
      continue;
    }
    const parts = tokens.slice(index, index + 3);
    const predicate = parts[2];
    joined.push({
      start: parts[0].start,
      end: predicate.end,
      token: {
        ...predicate.token,
        surface_form: parts.map((part) => part.token.surface_form).join(''),
        reading: parts.every((part) => part.token.reading)
          ? parts.map((part) => part.token.reading).join('')
          : predicate.token.reading,
        basic_form: form,
      },
    });
    index += 2;
  }
  return joined;
};

/**
 * kuromoji cuts words finer than a reader would: a verb from its endings, a noun from its
 * suffix, 察 from する. This joins the pieces that belong together, so that one tap selects the
 * word the dictionary lists.
 */
export const mergeJapaneseTokens = (locatedTokens: LocatedToken[]): MergedToken[] => {
  const mergedTokens: MergedToken[] = [];
  locatedTokens.forEach(({ token, start, end }) => {
    if (
      !token.surface_form.trim() ||
      token.pos === '記号' ||
      !WORD_CHARACTER.test(token.surface_form)
    ) return;
    const previous = mergedTokens[mergedTokens.length - 1];
    const adjacent = previous?.end === start;
    const previousIsAdjectivalNoun =
      previous?.token.pos === '名詞' &&
      previous.token.pos_detail_1 === '形容動詞語幹';
    // 不安気, 自慢気: the suffix 気 (げ) is cut off as a noun of its own, unlike 不安げ. A verb suffix
    // (れる, られる, させる) is not one: it conjugates the verb, which keeps its base form.
    const isSuffix = (token.pos_detail_1 === '接尾' && token.pos !== '動詞') ||
      isKiSuffix(previous?.token, token);
    // 読まれる, 摑まれていた, 食べさせる: the passive and causative endings belong to the verb before them.
    const isVerbSuffix = token.pos === '動詞' &&
      token.pos_detail_1 === '接尾' &&
      previous?.token.pos === '動詞';
    // 大人びた, 汗ばむ: a verb suffix after a noun makes a verb of it (大人びる), like する does.
    const isNounVerb = token.pos === '動詞' &&
      token.pos_detail_1 === '接尾' &&
      previous?.token.pos === '名詞';
    const isAuxiliary = token.pos === '助動詞' &&
      (
        ['動詞', '形容詞', '形容動詞', '助動詞'].includes(previous?.token.pos || '') ||
        previousIsAdjectivalNoun
      );
    const isTeFormConnector = token.pos === '助詞' &&
      token.pos_detail_1 === '接続助詞' &&
      ['て', 'で'].includes(token.surface_form) &&
      previous?.token.pos === '動詞';
    const isTeFormAuxiliary = token.pos === '動詞' &&
      previous?.token.joinedTeForm === true &&
      auxiliaryTeFormVerbs.has(token.basic_form || token.surface_form);
    // 察する, 勉強して: IPADIC reads a する verb as a noun plus する, so 察すれば comes out as
    // 察 + すれ + ば. Joined, it is the one verb the dictionary lists.
    const isSuruVerb = token.pos === '動詞' &&
      token.basic_form === 'する' &&
      previous?.token.pos === '名詞' &&
      previous.token.pos_detail_1 === 'サ変接続' &&
      !previous.token.joinedSuffix;
    // 食べちゃう, 読んどく, 書いてる: the contracted ている, てしまう, ておく.
    const isContractedTeRu = token.pos === '動詞' &&
      token.pos_detail_1 === '非自立' &&
      (contractedTeRuForms.has(token.surface_form) || contractedTeFormVerbs.has(token.basic_form || '')) &&
      previous?.token.pos === '動詞';
    // 終われば, 浸かっていれば, 高ければ: the conditional ば belongs to the form before it.
    const isConditionalBa = token.pos === '助詞' &&
      token.pos_detail_1 === '接続助詞' &&
      token.surface_form === 'ば' &&
      previous?.token.conjugated_form === '仮定形';
    // 鳴っちゃ, 読んじゃ: the contracted ては and では.
    const isContractedTeWa = token.pos === '助詞' &&
      token.pos_detail_1 === '接続助詞' &&
      ['ちゃ', 'じゃ'].includes(token.surface_form) &&
      ['動詞', '形容詞'].includes(previous?.token.pos || '');

    // お金, 不安気: a prefix and the noun it starts are one word (kuromoji cuts 不安気な as 不 + 安気).
    if (adjacent && previous && isPrefixOfNoun(previous.token, token)) {
      previous.token = joinPrefix(previous.token, token);
      previous.end = end;
      return;
    }

    if (adjacent && previous && (
      isSuffix ||
      isVerbSuffix ||
      isNounVerb ||
      isSuruVerb ||
      isAuxiliary ||
      isTeFormConnector ||
      isTeFormAuxiliary ||
      isContractedTeRu ||
      isConditionalBa ||
      isContractedTeWa
    )) {
      const mergedSurface = previous.token.surface_form + token.surface_form;
      previous.token = {
        ...previous.token,
        surface_form: mergedSurface,
        reading: previous.token.reading && token.reading
          ? previous.token.reading + token.reading
          : previous.token.reading || token.reading,
        pos: isSuruVerb || isNounVerb ? '動詞' : previous.token.pos,
        pos_detail_1: isSuruVerb || isNounVerb ? '自立' : previous.token.pos_detail_1,
        basic_form: isSuffix
          ? mergedSurface
          : isSuruVerb
            ? previous.token.surface_form + (token.basic_form || 'する')
            : isNounVerb
              ? previous.token.surface_form + (token.basic_form || '')
              : previous.token.basic_form,
        joinedSuffix: Boolean(previous.token.joinedSuffix || isSuffix),
        joinedConjugation: Boolean(
          previous.token.joinedConjugation ||
          isVerbSuffix ||
          isNounVerb ||
          isSuruVerb ||
          isTeFormAuxiliary ||
          isContractedTeRu ||
          isConditionalBa ||
          isContractedTeWa
        ),
        joinedTeForm: Boolean(
          isTeFormConnector ||
          (previous.token.joinedTeForm && !isTeFormAuxiliary)
        ),
        conjugated_type: token.conjugated_type || previous.token.conjugated_type,
        conjugated_form: token.conjugated_form || previous.token.conjugated_form,
      };
      previous.end = end;
      return;
    }

    mergedTokens.push({
      token: { ...token },
      start,
      end,
    });
  });

  return mergedTokens;
};
