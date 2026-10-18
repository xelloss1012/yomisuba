import {
  auxiliaryTeFormVerbs,
  contractedTeRuForms,
  JapaneseMorphologicalToken,
} from './dictionary';
import { isKiSuffix, isPrefixOfNoun, joinPrefix } from './tokenFixes';

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

/**
 * kuromoji cuts words finer than a reader would: a verb from its endings, a noun from its
 * suffix, 察 from する. This joins the pieces that belong together, so that one tap selects the
 * word the dictionary lists.
 */
export const mergeJapaneseTokens = (locatedTokens: LocatedToken[]): MergedToken[] => {
  const mergedTokens: MergedToken[] = [];
  locatedTokens.forEach(({ token, start, end }) => {
    if (!token.surface_form.trim() || token.pos === '記号') return;
    const previous = mergedTokens[mergedTokens.length - 1];
    const adjacent = previous?.end === start;
    const previousIsAdjectivalNoun =
      previous?.token.pos === '名詞' &&
      previous.token.pos_detail_1 === '形容動詞語幹';
    // 不安気, 自慢気: the suffix 気 (げ) is cut off as a noun of its own, unlike 不安げ.
    const isSuffix = token.pos_detail_1 === '接尾' ||
      isKiSuffix(previous?.token, token);
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
    const isContractedTeRu = token.pos === '動詞' &&
      token.pos_detail_1 === '非自立' &&
      contractedTeRuForms.has(token.surface_form) &&
      previous?.token.pos === '動詞';

    // お金, 不安気: a prefix and the noun it starts are one word (kuromoji cuts 不安気な as 不 + 安気).
    if (adjacent && previous && isPrefixOfNoun(previous.token, token)) {
      previous.token = joinPrefix(previous.token, token);
      previous.end = end;
      return;
    }

    if (adjacent && previous && (
      isSuffix ||
      isSuruVerb ||
      isAuxiliary ||
      isTeFormConnector ||
      isTeFormAuxiliary ||
      isContractedTeRu
    )) {
      const mergedSurface = previous.token.surface_form + token.surface_form;
      previous.token = {
        ...previous.token,
        surface_form: mergedSurface,
        reading: previous.token.reading && token.reading
          ? previous.token.reading + token.reading
          : previous.token.reading || token.reading,
        pos: isSuruVerb ? '動詞' : previous.token.pos,
        pos_detail_1: isSuruVerb ? '自立' : previous.token.pos_detail_1,
        basic_form: isSuffix
          ? mergedSurface
          : isSuruVerb
            ? previous.token.surface_form + (token.basic_form || 'する')
            : previous.token.basic_form,
        joinedSuffix: Boolean(previous.token.joinedSuffix || isSuffix),
        joinedConjugation: Boolean(
          previous.token.joinedConjugation ||
          isSuruVerb ||
          isTeFormAuxiliary ||
          isContractedTeRu
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
