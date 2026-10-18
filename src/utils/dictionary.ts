import TokenizerWorker from './tokenizer.worker?worker&inline';
// Both bundled dictionaries ship gzip-compressed and are only decompressed and
// indexed by the first lookup that needs them, so they cost nothing at startup.
import spanishDictionaryUrl from '../data/jmdict-es.json.gz?inline';
import englishDictionaryUrl from '../data/jmdict-en.json.gz?inline';
import { TranslationLanguage, UiLanguage, tr } from './i18n';
import { joinNounPieces } from './tokenFixes';
import {
  isOptionalDictionaryId,
  loadOptionalDictionaryEntries,
  onOptionalDictionaryChange,
  OptionalDictionaryId,
} from './optionalDictionaries';

export interface DictionarySense {
  partOfSpeech: string[];
  glosses: string[];
}

export interface DictionaryEntry {
  id: string;
  /**
   * Language of the glosses. `es` and `en` are bundled; the others come from
   * optional dictionaries, `ja` being the Japanese–Japanese one (definitions).
   */
  language: UiLanguage;
  kanji: string[];
  kana: string[];
  senses: DictionarySense[];
  synonyms?: string[];
}

export interface DictionaryLookup {
  originalText: string;
  baseForm: string;
  searchTerms: string[];
  entries: DictionaryEntry[];
  hasCompleteMatch: boolean;
  /**
   * True only when the *entire* selection resolved to a single dictionary form:
   * either the whole text matched exactly, or the tokenizer reduced it to one
   * head word whose conjugated base form matched exactly. Used to decide whether
   * the lookup deserves a "dictionary" history entry — a phrase where only one
   * internal word matched should not be stored as a dictionary history entry
   * (it can still be shown in the contextual menu / translated instead).
   */
  hasCompleteTextMatch: boolean;
  englishFallbackError?: string;
}

interface CompactEntry {
  id: string;
  k: string[];
  r: string[];
  s: Array<{ p: string[]; g: string[] }>;
  /** Synonyms (Wiktionary-based dictionaries only). */
  y?: string[];
  /** The word conjugates (Wiktionary-based dictionaries, whose parts of speech are localised). */
  i?: 1;
}

export interface JapaneseMorphologicalToken {
  surface_form: string;
  /** 1-based offset of the token in the tokenized text. */
  word_position?: number;
  pos: string;
  pos_detail_1?: string;
  pos_detail_2?: string;
  pos_detail_3?: string;
  basic_form?: string;
  reading?: string;
  conjugated_type?: string;
  conjugated_form?: string;
}
interface TokenizerClient {
  tokenize(input: string): Promise<JapaneseMorphologicalToken[]>;
}
let tokenizerPromise: Promise<TokenizerClient> | null = null;
let spanishIndexPromise: Promise<DictionaryIndex> | null = null;
let englishIndexPromise: Promise<DictionaryIndex> | null = null;
const optionalIndexPromises = new Map<OptionalDictionaryId, Promise<DictionaryIndex | null>>();
// Installing or removing a dictionary invalidates its cached index.
onOptionalDictionaryChange((id) => { optionalIndexPromises.delete(id); });

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

/**
 * A word written in katakana for effect (オリ, ココロ, ヒトビト) is listed in its usual hiragana
 * or kanji spelling, so it is also looked up as hiragana. Null when there is nothing to convert.
 */
const hiraganaSpelling = (term: string): string | null => {
  if (!/^[ァ-ヶー]+$/.test(term) || !/[ァ-ヶ]/.test(term)) return null;
  return term.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
};

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

const godanMasuStemToDictionaryForm: Record<string, string> = {
  き: 'く',
  ぎ: 'ぐ',
  し: 'す',
  ち: 'つ',
  に: 'ぬ',
  び: 'ぶ',
  み: 'む',
  り: 'る',
  い: 'う',
};

const godanPotentialStemToDictionaryForm: Record<string, string> = {
  え: 'う',
  け: 'く',
  げ: 'ぐ',
  せ: 'す',
  て: 'つ',
  ね: 'ぬ',
  べ: 'ぶ',
  め: 'む',
  れ: 'る',
};

// Verbs that follow a て-form only to add an aspect; the reader joins them to
// that verb and the dictionary looks the verb up instead.
export const auxiliaryTeFormVerbs = new Set(['いる', 'おる', 'おく', 'しまう', 'くる', 'いく', 'みる', 'ある']);
export const contractedTeRuForms = new Set(['てる', 'でる']);
// Contracted て-form auxiliaries as kuromoji gives their basic form (書いてる, 送り出しちゃおう).
const contractedTeFormVerbs = new Set([...contractedTeRuForms, 'ちゃう', 'じゃう', 'とく', 'どく']);

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

  // Passive / Potential (e.g. られる, られた, れて, れる, etc.)
  const potentialPassive = word.match(/^(.+?)(られなかった|られない|られた|られて|られる|れました|れません|めます|れば|れた|れて|れる|れ)$/);
  if (potentialPassive) {
    const stem = potentialPassive[1];
    add(`${stem}る`);
    const last = stem.slice(-1);
    const godanEnding = godanPotentialStemToDictionaryForm[last];
    if (godanEnding) add(`${stem.slice(0, -1)}${godanEnding}`);
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

  // Conditional (-tara, -tari, -dara, -dari)
  const taraTari = word.match(/^(.+?)(たら|たり|だら|だり)$/);
  if (taraTari) {
    const stem = taraTari[1];
    add(`${stem}る`);
    if (stem.endsWith('っ')) {
      add(`${stem.slice(0, -1)}つ`);
      add(`${stem.slice(0, -1)}う`);
      add(`${stem.slice(0, -1)}る`);
    } else if (stem.endsWith('い')) {
      add(`${stem.slice(0, -1)}く`);
      if (stem.slice(0, -1) === '行') add('行く');
    } else if (stem.endsWith('し')) {
      add(`${stem.slice(0, -1)}す`);
      add(`${stem.slice(0, -1)}する`);
    } else if (stem.endsWith('ん')) {
      add(`${stem.slice(0, -1)}む`);
      add(`${stem.slice(0, -1)}ぶ`);
      add(`${stem.slice(0, -1)}ぬ`);
    } else {
      const last = stem.slice(-1);
      const godanEnding = godanNegativeStemToDictionaryForm[last];
      if (godanEnding) add(`${stem.slice(0, -1)}${godanEnding}`);
    }
  }

  // Conditional (-ba)
  const baForm = word.match(/^(.+?)(えば|けば|げば|せば|てば|ねば|れば|べば|めば)$/);
  if (baForm) {
    const stem = baForm[1];
    add(`${stem}る`);
    const last = stem.slice(-1);
    const godanEnding = godanPotentialStemToDictionaryForm[last];
    if (godanEnding) add(`${stem.slice(0, -1)}${godanEnding}`);
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

  // Polite forms (-masu, -mashita, -masen, etc.)
  const polite = word.match(/^(.+?)(ませんでした|ません|ました|ましょう|まして|ます)$/);
  if (polite) {
    const stem = polite[1];
    add(`${stem}る`);
    const last = stem.slice(-1);
    const godanEnding = godanMasuStemToDictionaryForm[last];
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

// kuromoji runs in a worker (see tokenizer.worker.ts): building it on the main
// thread froze the reader for seconds on a phone.
const tokenizerTimeoutMs = 90000;
// After a failure (no dictionary files, no Worker support) do not try again on
// every selection: each attempt would download the whole dictionary anew.
const tokenizerRetryDelayMs = 5 * 60 * 1000;
let tokenizerFailedAt = 0;
let tokenizerFailureMessage = '';

const createTokenizer = (): Promise<TokenizerClient> =>
  new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new TokenizerWorker();
    } catch (error) {
      reject(error);
      return;
    }
    const pending = new Map<number, {
      resolve: (tokens: JapaneseMorphologicalToken[]) => void;
      reject: (error: Error) => void;
    }>();
    let nextId = 1;
    let settled = false;

    const fail = (error: Error) => {
      worker.terminate();
      pending.forEach((request) => request.reject(error));
      pending.clear();
      if (settled) {
        // The worker died after it was usable: let the next lookup start afresh.
        tokenizerPromise = null;
      } else {
        settled = true;
        reject(error);
      }
    };
    const timer = window.setTimeout(() => fail(new Error('kuromoji: tiempo de carga del diccionario agotado')), tokenizerTimeoutMs);

    worker.onerror = (event) => {
      window.clearTimeout(timer);
      fail(new Error(event.message || 'kuromoji: error del worker'));
    };
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as
        | { type: 'ready' }
        | { type: 'init-error'; message: string }
        | { type: 'tokens'; id: number; tokens: JapaneseMorphologicalToken[] };
      if (message.type === 'ready') {
        window.clearTimeout(timer);
        settled = true;
        resolve({
          tokenize: (text) =>
            new Promise((resolveTokens, rejectTokens) => {
              const id = nextId;
              nextId += 1;
              pending.set(id, { resolve: resolveTokens, reject: rejectTokens });
              worker.postMessage({ type: 'tokenize', id, text });
            }),
        });
      } else if (message.type === 'init-error') {
        window.clearTimeout(timer);
        fail(new Error(message.message));
      } else if (message.type === 'tokens') {
        pending.get(message.id)?.resolve(message.tokens);
        pending.delete(message.id);
      }
    };
    // Relative to the page, so it also works under a sub-path (GitHub Pages).
    worker.postMessage({ type: 'init', dicPath: new URL('dict/', window.location.href).href });
  });

const getTokenizer = async (retryAfterFailure = false): Promise<TokenizerClient> => {
  if (retryAfterFailure && !tokenizerPromise) {
    tokenizerFailedAt = 0;
    tokenizerFailureMessage = '';
  }
  if (!tokenizerPromise) {
    if (Date.now() - tokenizerFailedAt < tokenizerRetryDelayMs) {
      throw new Error(
        tokenizerFailureMessage
          ? tr('err.kuromojiRetry', { message: tokenizerFailureMessage })
          : tr('err.kuromojiRetryPlain')
      );
    }
    const attempt = createTokenizer();
    attempt.catch((error: unknown) => {
      tokenizerFailedAt = Date.now();
      tokenizerFailureMessage = error instanceof Error ? error.message : String(error);
      if (tokenizerPromise === attempt) tokenizerPromise = null;
    });
    tokenizerPromise = attempt;
  }
  return tokenizerPromise;
};

/** Starts loading the tokenizer in the background so the first lookup is instant. */
export const warmUpDictionary = () => {
  void getTokenizer().catch(() => undefined);
};

export const tokenizeJapanese = async (text: string): Promise<JapaneseMorphologicalToken[]> => {
  const tokenizer = await getTokenizer(true);
  return tokenizer.tokenize(text);
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
  ...(entry.y?.length ? { synonyms: entry.y } : {}),
});

const createIndex = (source: CompactEntry[]): DictionaryIndex => {
  const byForm = new Map<string, CompactEntry[]>();
  for (const entry of source) {
    for (const form of unique([...entry.k, ...entry.r])) {
      const matchingEntries = byForm.get(form);
      if (matchingEntries) matchingEntries.push(entry);
      else byForm.set(form, [entry]);
    }
  }
  return { byForm, forms: [...byForm.keys()].sort() };
};

const loadBundledIndex = async (url: string, name: string): Promise<DictionaryIndex> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(tr('err.jmdictHttp', { name, status: response.status }));
  }
  if (!response.body || typeof DecompressionStream === 'undefined') {
    throw new Error(tr('err.dictNoCompression', { name }));
  }
  const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
  const loadedEntries = await new Response(decompressed).json() as CompactEntry[];
  if (!Array.isArray(loadedEntries)) {
    throw new Error(tr('err.jmdictFormat', { name }));
  }
  return createIndex(loadedEntries);
};

const getSpanishIndex = (): Promise<DictionaryIndex> => {
  if (!spanishIndexPromise) spanishIndexPromise = loadBundledIndex(spanishDictionaryUrl, 'español');
  return spanishIndexPromise;
};

const getEnglishIndex = (): Promise<DictionaryIndex> => {
  if (!englishIndexPromise) englishIndexPromise = loadBundledIndex(englishDictionaryUrl, 'inglés');
  return englishIndexPromise;
};

/** Index of a downloaded optional dictionary, or null when it is not installed. */
const getOptionalIndex = (id: OptionalDictionaryId): Promise<DictionaryIndex | null> => {
  let promise = optionalIndexPromises.get(id);
  if (!promise) {
    promise = loadOptionalDictionaryEntries(id)
      .then((loadedEntries) => (loadedEntries ? createIndex(loadedEntries) : null))
      .catch((error) => {
        optionalIndexPromises.delete(id);
        throw error;
      });
    optionalIndexPromises.set(id, promise);
  }
  return promise;
};

// Parts of speech of the Japanese–Japanese dictionary that conjugate (files
// published before the builder added `i` only carry these).
const JAPANESE_INFLECTABLE_POS = new Set(['動詞', '形容詞', '形容動詞', '助動詞']);
const JAPANESE_EXPRESSION_POS = new Set(['成句', '慣用句', 'ことわざ']);

const isInflectableEntry = (entry: CompactEntry, form: string): boolean => {
  if (entry.i) return true;
  return entry.s.some((sense) =>
    sense.p.some((pos) => {
      if (JAPANESE_INFLECTABLE_POS.has(pos)) return true;
      if (JAPANESE_EXPRESSION_POS.has(pos)) return /[うくぐすつぬぶむるい]$/.test(form);
      const normalizedPos = pos.toLowerCase();
      const isSuruVerb = pos === 'vs' || pos.startsWith('vs-') || normalizedPos.includes('suru');
      const isVerb = (pos.startsWith('v') && !pos.startsWith('vs')) ||
        (/\bverb\b/.test(normalizedPos) && (!isSuruVerb || form.endsWith('する')));
      const isAdjective = pos.startsWith('adj') || /\badjective\b/.test(normalizedPos);
      const isExpression = pos === 'exp' || normalizedPos.includes('expressions');
      return isVerb || isAdjective || (isSuruVerb && form.endsWith('する')) || (isExpression && /[うくぐすつぬぶむるい]$/.test(form));
    })
  );
};

const findRawEntries = (
  directTerms: string[],
  wholePhraseTerms: string[],
  subTokenTerms: string[],
  index: DictionaryIndex,
): Array<{ entry: CompactEntry; score: number; exactText?: boolean }> => {
  const normalizedDirect = unique(directTerms.map(normalizeSelection)).filter(Boolean);
  const normalizedWhole = unique(wholePhraseTerms.map(normalizeSelection)).filter(Boolean);
  const normalizedSub = unique(subTokenTerms.map(normalizeSelection)).filter(Boolean);
  const ranked = new Map<string, { entry: CompactEntry; score: number; exactText?: boolean }>();

  const addMatches = (
    matches: CompactEntry[] | undefined,
    score: number,
    form: string,
    requireInflectable = false,
    markExactText = false,
  ) => {
    for (const entry of matches || []) {
      const effectiveScore = requireInflectable && !isInflectableEntry(entry, form)
        ? Math.max(score, 5)
        : score;
      const current = ranked.get(entry.id);
      if (!current || effectiveScore < current.score) {
        ranked.set(entry.id, { entry, score: effectiveScore, ...(markExactText ? { exactText: true } : {}) });
      } else if (markExactText && effectiveScore === current.score) {
        current.exactText = true;
      }
    }
  };

  // 1. Direct whole-text matches
  for (const term of normalizedDirect) {
    addMatches(index.byForm.get(term), 0, term, false, true);
    const hiragana = hiraganaSpelling(term);
    if (hiragana) addMatches(index.byForm.get(hiragana), 0, hiragana, false, true);

    for (let length = 2; length < term.length; length += 1) {
      addMatches(index.byForm.get(term.slice(0, length)), 10 + (term.length - length), term);
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
        addMatches(index.byForm.get(form), 20 + (form.length - term.length), term);
      }
    }
  }

  // 2. Whole-phrase deconjugated matches (score 0, mark exact text match)
  for (const term of normalizedWhole) {
    addMatches(index.byForm.get(term), 0, term, true, true);

    for (let length = 2; length < term.length; length += 1) {
      addMatches(index.byForm.get(term.slice(0, length)), 12 + (term.length - length), term, true);
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
        addMatches(index.byForm.get(form), 22 + (form.length - term.length), term, true);
      }
    }
  }

  // 3. Sub-token matches (score >= 5, partial match for individual internal words). The earlier
  // the word, the lower the score, so the main word of a phrase is listed before the others.
  normalizedSub.forEach((term, position) => {
    addMatches(index.byForm.get(term), 5 + position * 0.01, term, false, false);
    const hiragana = hiraganaSpelling(term);
    if (hiragana) addMatches(index.byForm.get(hiragana), 5 + position * 0.01, hiragana, false, false);
  });

  return [...ranked.values()].sort((left, right) => left.score - right.score);
};

export interface DictionarySearchOptions {
  /** Also search the downloaded Japanese–Japanese dictionary and list its entries first. */
  includeJapanese?: boolean;
}

export const getDictionarySearchTerms = async (
  value: string,
  language: TranslationLanguage,
  { includeJapanese = false }: DictionarySearchOptions = {},
): Promise<DictionaryLookup> => {
  const originalText = normalizeSelection(value) || value.trim();
  if (!originalText) {
    return { originalText: '', baseForm: '', searchTerms: [], entries: [], hasCompleteMatch: false, hasCompleteTextMatch: false };
  }

  const guessed = guessBaseForms(originalText).filter((form) => form !== originalText);
  let phraseBase: string | null = null;
  const wholePhraseTerms: string[] = [...guessed];
  const subTokenTerms: string[] = [];
  let tokenizerAvailable = false;

  try {
    const tokenizer = await getTokenizer();
    // The same pieces the reader joins (不安気な is cut as 不 + 安気), so the lookup is of the word shown.
    const tokens = joinNounPieces(await tokenizer.tokenize(originalText));
    tokenizerAvailable = true;

    // A verb that only adds an aspect to the て-form before it (送り出してしまおう,
    // 食べている, 書いてる) is not the word being looked up: the reader joins it to
    // that verb, and looking it up would answer しまう instead of 送り出す.
    const isTeFormAuxiliary = (index: number): boolean => {
      const token = tokens[index];
      const previous = tokens[index - 1];
      if (token.pos !== '動詞' || !previous) return false;
      if (token.pos_detail_1 === '非自立' && contractedTeFormVerbs.has(token.basic_form || '')) {
        return previous.pos === '動詞';
      }
      return previous.pos === '助詞' &&
        ['て', 'で'].includes(previous.surface_form) &&
        auxiliaryTeFormVerbs.has(token.basic_form || token.surface_form);
    };
    const auxiliaryIndexes = new Set<number>();
    for (let i = tokens.length - 1; i > 0 && (isTeFormAuxiliary(i) || ['助詞', '助動詞'].includes(tokens[i].pos)); i -= 1) {
      if (isTeFormAuxiliary(i)) auxiliaryIndexes.add(i);
    }
    // させる, れる, られる after a verb (かけさせよう, 読まれる) only change its voice: the word is
    // the verb before them. Looking them up would answer かけ (a chicken) for かけさせよう.
    tokens.forEach((token, index) => {
      if (index > 0 && token.pos === '動詞' && token.pos_detail_1 === '接尾') auxiliaryIndexes.add(index);
    });

    // Look for the last predicate token (verb, adjective) to reconstruct the base form of the whole phrase
    let lastVerbIdx = -1;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (
        !auxiliaryIndexes.has(i) &&
        ['動詞', '形容詞', '形容動詞'].includes(tokens[i].pos) &&
        tokens[i].basic_form &&
        tokens[i].basic_form !== '*'
      ) {
        lastVerbIdx = i;
        break;
      }
    }

    if (lastVerbIdx >= 0) {
      phraseBase = tokens.slice(0, lastVerbIdx).map((t) => t.surface_form).join('') + tokens[lastVerbIdx].basic_form;
      if (phraseBase && phraseBase !== originalText) {
        wholePhraseTerms.unshift(phraseBase);
      }
    }

    const meaningfulTokens = tokens.filter(
      (token, index) => !['記号', '助詞', '助動詞'].includes(token.pos) &&
        !auxiliaryIndexes.has(index) &&
        token.surface_form
    );

    if (meaningfulTokens.length > 1) {
      const isSuffixToken = (token: JapaneseMorphologicalToken) => token.pos_detail_1 === '接尾';
      const byImportance = [
        ...meaningfulTokens.filter((token) => !isSuffixToken(token)),
        ...meaningfulTokens.filter(isSuffixToken),
      ];
      for (const token of byImportance) {
        // A conjugated verb or adjective is looked up by its dictionary form first: its stem alone
        // (かけ of かける) is often a different word.
        const hasBaseForm = token.basic_form && token.basic_form !== '*';
        const inflects = ['動詞', '形容詞'].includes(token.pos) && hasBaseForm;
        if (inflects) subTokenTerms.push(token.basic_form as string);
        if (token.surface_form) subTokenTerms.push(token.surface_form);
        if (!inflects && hasBaseForm) subTokenTerms.push(token.basic_form as string);
      }
    } else if (meaningfulTokens.length === 1 && lastVerbIdx >= 0) {
      const verbBase = tokens[lastVerbIdx].basic_form;
      if (verbBase && verbBase !== '*') {
        wholePhraseTerms.unshift(verbBase);
      }
    }
  } catch (err) {
    // The regex fallback still provides useful lookups when the tokenizer is unavailable.
    console.error('[dictionary] tokenizer error:', err);
  }

  const directTerms = [originalText];
  const filteredWhole = unique(wholePhraseTerms).filter((term) => !directTerms.includes(term));
  const filteredSub = unique(subTokenTerms).filter(
    (term) => !directTerms.includes(term) && !filteredWhole.includes(term)
  );

  const searchTerms = unique([
    ...filteredWhole,
    originalText,
    ...filteredSub,
  ]).filter((term) => term.length > 0);

  type RankedMatch = { entry: CompactEntry; score: number; exactText?: boolean };
  const resultsByLanguage = new Map<UiLanguage, RankedMatch[]>();
  let englishFallbackError: string | undefined;
  const [spanishIndex, englishIndex] = await Promise.allSettled([getSpanishIndex(), getEnglishIndex()]);

  if (spanishIndex.status === 'fulfilled') {
    resultsByLanguage.set('es', findRawEntries(directTerms, filteredWhole, filteredSub, spanishIndex.value));
  } else {
    // Retried on the next lookup; English still answers meanwhile.
    spanishIndexPromise = null;
    console.error('[dictionary] Spanish dictionary error:', spanishIndex.reason);
  }

  if (englishIndex.status === 'fulfilled') {
    resultsByLanguage.set('en', findRawEntries(directTerms, filteredWhole, filteredSub, englishIndex.value));
  } else {
    englishIndexPromise = null;
    englishFallbackError = englishIndex.reason instanceof Error
      ? englishIndex.reason.message
      : 'No se pudo cargar el complemento inglés de JMdict.';
  }

  // Downloaded dictionaries that apply: the translation language's own one and,
  // with a Japanese interface, the Japanese–Japanese one. One that is not
  // installed resolves to no index and simply takes no part.
  const optionalIds = unique([
    includeJapanese ? 'ja' : '',
    isOptionalDictionaryId(language) ? language : '',
  ]) as OptionalDictionaryId[];
  await Promise.all(optionalIds.map(async (id) => {
    try {
      const index = await getOptionalIndex(id);
      if (index) resultsByLanguage.set(id, findRawEntries(directTerms, filteredWhole, filteredSub, index));
    } catch (error) {
      // The bundled dictionaries still answer if a downloaded one is unreadable.
      console.error(`[dictionary] ${id} dictionary error:`, error);
    }
  }));

  // Dictionaries in order of preference: Japanese definitions first (searched
  // only with a Japanese interface), then the translation language's own
  // dictionary, then English, then Spanish. A language without a dictionary of
  // its own falls back to English. Every exact match comes before every partial
  // one, so an exact English entry still beats a partial match in the preferred
  // dictionary.
  const preferred: UiLanguage = resultsByLanguage.has(language) ? language : 'en';
  const order = (unique(['ja', preferred, 'en', 'es']) as UiLanguage[])
    .filter((dictionaryLanguage) => resultsByLanguage.has(dictionaryLanguage));
  // Exact matches go by dictionary order; partial ones by how good the match is, and only then by
  // dictionary (so the main word of a phrase is not pushed down by a minor word that the preferred
  // dictionary happens to have).
  const byPriority = (
    left: { priority: number; score: number; dictionaryIndex: number },
    right: { priority: number; score: number; dictionaryIndex: number },
  ) => left.priority - right.priority || left.score - right.score || left.dictionaryIndex - right.dictionaryIndex;

  const topEntries = order.flatMap((dictionaryLanguage, index) =>
    (resultsByLanguage.get(dictionaryLanguage) || [])
      .map((match) => ({
        entry: toEntry(match.entry, dictionaryLanguage),
        score: match.score,
        priority: match.score === 0 ? index : order.length,
        dictionaryIndex: index,
      }))
      .sort(byPriority)
      .slice(0, 20)
  ).sort(byPriority);
  const hasCompleteMatch = topEntries.some((item) => item.score === 0);

  let hasCompleteTextMatch = [...resultsByLanguage.values()].some((results) =>
    results.some((match) => match.exactText)
  );

  // If the tokenizer was unavailable (e.g. in Node tests), we fall back to
  // hasCompleteMatch because guessBaseForms and direct matches are always
  // against the entire selection.
  if (!tokenizerAvailable && hasCompleteMatch) {
    hasCompleteTextMatch = true;
  }

  // Determine the best resolved baseForm: the matching whole phrase, or the top whole-phrase candidate, or originalText
  const matchedWhole = filteredWhole.find((form) =>
    topEntries.some(
      (item) =>
        item.score === 0 &&
        (item.entry.kanji.includes(form) || item.entry.kana.includes(form))
    )
  );
  const baseForm = matchedWhole || filteredWhole[0] || originalText;

  return {
    originalText,
    baseForm,
    searchTerms,
    entries: topEntries.map((item) => item.entry),
    hasCompleteMatch,
    hasCompleteTextMatch,
    englishFallbackError,
  };
};
