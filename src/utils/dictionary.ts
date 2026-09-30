import jmdictEntries from '../data/jmdict-spa.json';
import englishDictionaryUrl from '../data/jmdict-en.json.gz?inline';

export interface DictionarySense {
  partOfSpeech: string[];
  glosses: string[];
}

export interface DictionaryEntry {
  id: string;
  language: 'es' | 'en';
  kanji: string[];
  kana: string[];
  senses: DictionarySense[];
}

export interface DictionaryLookup {
  originalText: string;
  baseForm: string;
  searchTerms: string[];
  entries: DictionaryEntry[];
  englishFallbackError?: string;
}

interface CompactEntry {
  id: string;
  k: string[];
  r: string[];
  s: Array<{ p: string[]; g: string[] }>;
}

const entries = jmdictEntries as CompactEntry[];
const spanishEntryIds = new Set(entries.map((entry) => entry.id));
let tokenizerPromise: Promise<{ tokenize(input: string): Array<{ surface_form: string; pos: string; basic_form?: string }> }> | null = null;
let englishIndexPromise: Promise<DictionaryIndex> | null = null;

interface DictionaryIndex {
  byForm: Map<string, CompactEntry[]>;
  forms: string[];
}

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

  // Passive (present: られる/れる, past: られた/れた, te-form: られて/れて)
  const passive = word.match(/^(.+?)(られる|られた|られて|れる|れた|れて)$/);
  if (passive) {
    const ending = passive[2];
    const stem = passive[1];
    if (ending.startsWith('られ')) {
      add(`${stem}る`);
    } else {
      const last = stem.slice(-1);
      const godanEnding = godanNegativeStemToDictionaryForm[last];
      if (godanEnding) add(`${stem.slice(0, -1)}${godanEnding}`);
      add(`${stem}る`);
    }
  }

  // Causative (させる/させた/させて and せる/せた/せて)
  const causative = word.match(/^(.+?)(させる|させた|させて|せる|せた|せて)$/);
  if (causative) {
    const ending = causative[2];
    const stem = causative[1];
    if (ending.startsWith('させ')) {
      add(`${stem}る`);
    } else {
      const last = stem.slice(-1);
      const godanEnding = godanNegativeStemToDictionaryForm[last];
      if (godanEnding) add(`${stem.slice(0, -1)}${godanEnding}`);
      add(`${stem}る`);
    }
  }

  // Common past and te-form for Godan / Ichidan
  const teTa = word.match(/^(.+?)(って|った|いて|いた|いで|いだ|して|した|んで|んだ)$/);
  if (teTa) {
    const stem = teTa[1];
    const ending = teTa[2];
    if (ending === 'って' || ending === 'った') {
      add(`${stem}る`);
      add(`${stem}つ`);
      add(`${stem}う`);
    } else if (ending === 'いて' || ending === 'いた') {
      add(`${stem}く`);
      if (stem === '行') add('行く');
    } else if (ending === 'いで' || ending === 'いだ') {
      add(`${stem}ぐ`);
    } else if (ending === 'して' || ending === 'した') {
      add(`${stem}す`);
      add(`${stem}する`);
    } else if (ending === 'んで' || ending === 'んだ') {
      add(`${stem}む`);
      add(`${stem}ぶ`);
      add(`${stem}ぬ`);
    }
  }

  // Plain ichidan past / te-form (e.g. 食べて -> 食べる, 食べた -> 食べる)
  if (word.endsWith('て') && !word.match(/(って|いて|いで|して|んで|れて|せて)$/)) {
    add(`${word.slice(0, -1)}る`);
  }
  if (word.endsWith('た') && !word.match(/(った|いた|いだ|した|んだ|れた|せた)$/)) {
    add(`${word.slice(0, -1)}る`);
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

const toEntry = (entry: CompactEntry, language: DictionaryEntry['language']): DictionaryEntry => ({
  id: entry.id,
  language,
  kanji: entry.k,
  kana: entry.r,
  senses: entry.s.map((sense) => ({
    partOfSpeech: sense.p,
    glosses: sense.g,
  })),
});

const createIndex = (source: CompactEntry[], excludedIds?: Set<string>): DictionaryIndex => {
  const byForm = new Map<string, CompactEntry[]>();
  for (const entry of source) {
    if (excludedIds?.has(entry.id)) continue;
    for (const form of unique([...entry.k, ...entry.r])) {
      const matchingEntries = byForm.get(form);
      if (matchingEntries) matchingEntries.push(entry);
      else byForm.set(form, [entry]);
    }
  }
  return { byForm, forms: [...byForm.keys()].sort() };
};

const spanishIndex = createIndex(entries);

const getEnglishIndex = async (): Promise<DictionaryIndex> => {
  if (!englishIndexPromise) {
    englishIndexPromise = (async () => {
      const response = await fetch(englishDictionaryUrl);
      if (!response.ok) {
        throw new Error(`No se pudo cargar JMdict inglés (HTTP ${response.status}).`);
      }
      if (!response.body || typeof DecompressionStream === 'undefined') {
        throw new Error('Este navegador no admite la carga comprimida del diccionario inglés.');
      }
      const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
      const loadedEntries = await new Response(decompressed).json() as CompactEntry[];
      if (!Array.isArray(loadedEntries)) {
        throw new Error('El archivo local de JMdict inglés no tiene un formato válido.');
      }
      return createIndex(loadedEntries, spanishEntryIds);
    })();
  }
  return englishIndexPromise;
};

const findEntries = (
  terms: string[],
  index: DictionaryIndex,
  language: DictionaryEntry['language'],
): Array<{ entry: DictionaryEntry; score: number }> => {
  const normalizedTerms = unique(terms.map(normalizeSelection)).filter(Boolean);
  const ranked = new Map<string, { entry: CompactEntry; score: number }>();

  const addMatches = (matches: CompactEntry[] | undefined, score: number) => {
    for (const entry of matches || []) {
      const current = ranked.get(entry.id);
      if (!current || score < current.score) ranked.set(entry.id, { entry, score });
    }
  };

  for (const term of normalizedTerms) {
    addMatches(index.byForm.get(term), 0);

    for (let length = 2; length < term.length; length += 1) {
      addMatches(index.byForm.get(term.slice(0, length)), 10 + (term.length - length));
    }

    let low = 0;
    let high = index.forms.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (index.forms[middle] < term) low = middle + 1;
      else high = middle;
    }
    for (let position = low; position < index.forms.length; position += 1) {
      const form = index.forms[position];
      if (!form.startsWith(term)) break;
      if (form.length > term.length && term.length >= 2) {
        addMatches(index.byForm.get(form), 20 + (form.length - term.length));
      }
    }
  }

  return [...ranked.values()]
    .sort((left, right) => left.score - right.score)
    .map(({ entry, score }) => ({ entry: toEntry(entry, language), score }));
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
  const spanishMatches = findEntries(searchTerms, spanishIndex, 'es');
  let englishMatches: Array<{ entry: DictionaryEntry; score: number }> = [];
  let englishFallbackError: string | undefined;
  if (spanishMatches.length < 20) {
    try {
      const englishIndex = await getEnglishIndex();
      englishMatches = findEntries(searchTerms, englishIndex, 'en');
    } catch (error) {
      englishIndexPromise = null;
      englishFallbackError = error instanceof Error
        ? error.message
        : 'No se pudo cargar el complemento inglés de JMdict.';
    }
  }
  const spanishIds = new Set(spanishMatches.map(({ entry }) => entry.id));
  const combinedEntries = [
    ...spanishMatches,
    ...englishMatches.filter(({ entry }) => !spanishIds.has(entry.id)),
  ].slice(0, 20).map(({ entry }) => entry);

  return {
    originalText,
    baseForm: searchTerms[0] || originalText,
    searchTerms,
    entries: combinedEntries,
    englishFallbackError,
  };
};
