import jmdictEntries from '../data/jmdict-spa.json';

export interface DictionarySense {
  partOfSpeech: string[];
  glosses: string[];
}

export interface DictionaryEntry {
  id: string;
  kanji: string[];
  kana: string[];
  senses: DictionarySense[];
}

export interface DictionaryLookup {
  originalText: string;
  baseForm: string;
  searchTerms: string[];
  entries: DictionaryEntry[];
}

interface CompactEntry {
  id: string;
  k: string[];
  r: string[];
  s: Array<{ p: string[]; g: string[] }>;
}

const entries = jmdictEntries as CompactEntry[];
let tokenizerPromise: Promise<{ tokenize(input: string): Array<{ surface_form: string; pos: string; basic_form?: string }> }> | null = null;

const normalizeSelection = (value: string): string => {
  return value
    .replace(/[\s\u3000]+/g, '')
    .replace(/[!-/:-@[-`{-~、。！？「」『』（）［］｛｝【】・…]/g, '')
    .trim();
};

const unique = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

const godanNegativeStemToDictionaryForm: Record<string, string> = {
  か: 'く',
  が: 'ぐ',
  さ: 'す',
  た: 'つ',
  な: 'ぬ',
  ば: 'ぶ',
  ま: 'む',
  ら: 'る',
  わ: 'う',
};

const guessBaseForms = (word: string): string[] => {
  if (!word) return [];

  const candidates: string[] = [word];
  const add = (candidate: string) => {
    if (candidate && candidate !== word) candidates.push(candidate);
  };

  const negative = word.match(/^(.+?)(なかった|ない)$/);
  if (negative) {
    const stem = negative[1];
    const last = stem.slice(-1);
    const godanEnding = godanNegativeStemToDictionaryForm[last];
    if (godanEnding) add(`${stem.slice(0, -1)}${godanEnding}`);
    add(`${stem}る`);
  }

  const passivePast = word.match(/^(.+?)(られた|れた)$/);
  if (passivePast) {
    const stem = passivePast[1];
    if (word.endsWith('られた')) {
      add(`${stem}る`);
    } else {
      const last = stem.slice(-1);
      const godanEnding = godanNegativeStemToDictionaryForm[last];
      if (godanEnding) add(`${stem.slice(0, -1)}${godanEnding}`);
      add(`${stem}る`);
    }
  }

  const polite = word.match(/^(.+?)(ませんでした|ません|ました|ます)$/);
  if (polite) {
    const stem = polite[1];
    add(`${stem}る`);
    const last = stem.slice(-1);
    const godanEnding = godanNegativeStemToDictionaryForm[last];
    if (godanEnding) add(`${stem.slice(0, -1)}${godanEnding}`);
  }

  const progressive = word.match(/^(.+?)(ている|ていた|てくる|てしまう)$/);
  if (progressive) {
    add(`${progressive[1]}る`);
    add(progressive[1]);
  }

  if (word.endsWith('だった')) add(`${word.slice(0, -3)}だ`);
  if (word.endsWith('である')) add(word.slice(0, -3));

  return unique(candidates);
};

const getTokenizer = async () => {
  if (!tokenizerPromise) {
    tokenizerPromise = import('kuromoji').then(
      (kuromoji) =>
        new Promise((resolve, reject) => {
          kuromoji.builder({ dicPath: '/dict/' }).build((error, tokenizer) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(tokenizer);
          });
        })
    );
  }
  return tokenizerPromise;
};

const toEntry = (entry: CompactEntry): DictionaryEntry => ({
  id: entry.id,
  kanji: entry.k,
  kana: entry.r,
  senses: entry.s.map((sense) => ({
    partOfSpeech: sense.p,
    glosses: sense.g,
  })),
});

const findEntries = (terms: string[]): DictionaryEntry[] => {
  const normalizedTerms = unique(terms.map(normalizeSelection)).filter(Boolean);
  const ranked = new Map<string, { entry: CompactEntry; score: number }>();

  for (const entry of entries) {
    const forms = [...entry.k, ...entry.r];
    let bestScore = Number.POSITIVE_INFINITY;

    for (const term of normalizedTerms) {
      for (const form of forms) {
        if (form === term) {
          bestScore = Math.min(bestScore, 0);
        } else if (term.startsWith(form) && form.length >= 2) {
          // Handles compounds such as 幹部様: show the 幹部 entry as well.
          bestScore = Math.min(bestScore, 10 + (term.length - form.length));
        } else if (form.startsWith(term) && term.length >= 2) {
          // Also makes an incomplete selection useful as a dictionary prefix.
          bestScore = Math.min(bestScore, 20 + (form.length - term.length));
        }
      }
    }

    if (Number.isFinite(bestScore)) {
      ranked.set(entry.id, { entry, score: bestScore });
    }
  }

  return [...ranked.values()]
    .sort((left, right) => left.score - right.score)
    .slice(0, 20)
    .map(({ entry }) => toEntry(entry));
};

export const getDictionarySearchTerms = async (value: string): Promise<DictionaryLookup> => {
  const originalText = normalizeSelection(value) || value.trim();
  if (!originalText) {
    return { originalText: '', baseForm: '', searchTerms: [], entries: [] };
  }

  let searchTerms = guessBaseForms(originalText);
  const tokenTerms: string[] = [];

  try {
    const tokenizer = await getTokenizer();
    const tokens = tokenizer.tokenize(originalText);
    for (const token of tokens) {
      if (!['記号', '助詞', '助動詞'].includes(token.pos) && token.surface_form) {
        tokenTerms.push(token.surface_form);
        if (token.basic_form && token.basic_form !== '*') {
          tokenTerms.push(token.basic_form);
        }
      }
    }
    const verbalBase = tokens.find(
      (token) =>
        ['動詞', '形容詞', '形容動詞'].includes(token.pos) &&
        token.basic_form &&
        token.basic_form !== '*'
    );
    if (verbalBase?.basic_form) searchTerms.unshift(verbalBase.basic_form);
  } catch {
    // The regex fallback still provides useful lookups when the tokenizer is unavailable.
  }

  searchTerms = unique([...searchTerms, ...tokenTerms, originalText]).filter((term) => term.length > 0);
  return {
    originalText,
    baseForm: searchTerms[0] || originalText,
    searchTerms,
    entries: findEntries(searchTerms),
  };
};
