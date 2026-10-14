import TokenizerWorker from './tokenizer.worker?worker&inline';
import jmdictEntries from '../data/jmdict-spa.json';
import englishDictionaryUrl from '../data/jmdict-en.json.gz?inline';
import { UiLanguage } from './i18n';

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
}

const entries = jmdictEntries as CompactEntry[];
export interface JapaneseMorphologicalToken {
  surface_form: string;
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
    worker.postMessage({ type: 'init', dicPath: new URL('/dict/', window.location.href).href });
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
          ? `Kuromoji no disponible tras un error anterior: ${tokenizerFailureMessage}`
          : 'Kuromoji no disponible tras un error anterior.'
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
      return createIndex(loadedEntries);
    })();
  }
  return englishIndexPromise;
};

const isInflectableEntry = (entry: CompactEntry, form: string): boolean => {
  return entry.s.some((sense) =>
    sense.p.some((pos) => {
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

  // 3. Sub-token matches (score >= 5, partial match for individual internal words)
  for (const term of normalizedSub) {
    addMatches(index.byForm.get(term), 5, term, false, false);
  }

  return [...ranked.values()].sort((left, right) => left.score - right.score);
};

export const getDictionarySearchTerms = async (value: string, language: UiLanguage = 'es'): Promise<DictionaryLookup> => {
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
    const tokens = await tokenizer.tokenize(originalText);
    tokenizerAvailable = true;

    // Look for the last predicate token (verb, adjective) to reconstruct the base form of the whole phrase
    let lastVerbIdx = -1;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (
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
      (token) => !['記号', '助詞', '助動詞'].includes(token.pos) && token.surface_form
    );

    if (meaningfulTokens.length > 1) {
      for (const token of meaningfulTokens) {
        if (token.surface_form) subTokenTerms.push(token.surface_form);
        if (token.basic_form && token.basic_form !== '*') {
          subTokenTerms.push(token.basic_form);
        }
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

  const spanishResults = findRawEntries(directTerms, filteredWhole, filteredSub, spanishIndex);
  let englishResults: Array<{ entry: CompactEntry; score: number; exactText?: boolean }> = [];
  let englishFallbackError: string | undefined;

  try {
    const englishIndex = await getEnglishIndex();
    englishResults = findRawEntries(directTerms, filteredWhole, filteredSub, englishIndex);
  } catch (error) {
    englishIndexPromise = null;
    englishFallbackError = error instanceof Error
      ? error.message
      : 'No se pudo cargar el complemento inglés de JMdict.';
  }

  const preferEnglish = language !== 'es';
  const preferredDictLang = language === 'es' ? 'es' : 'en';
  const otherDictLang = preferredDictLang === 'es' ? 'en' : 'es';

  const combined = [
    ...spanishResults.map((m) => ({
      entry: toEntry(m.entry, 'es'),
      score: m.score,
      priority: m.score === 0 ? (preferEnglish ? 1 : 0) : (preferEnglish ? 3 : 2),
    })),
    ...englishResults
      .map((m) => ({
        entry: toEntry(m.entry, 'en'),
        score: m.score,
        priority: m.score === 0 ? (preferEnglish ? 0 : 1) : (preferEnglish ? 2 : 3),
      })),
  ].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.score - right.score;
  });

  const topEntries = [
    ...combined.filter((item) => item.entry.language === preferredDictLang).slice(0, 20),
    ...combined.filter((item) => item.entry.language === otherDictLang).slice(0, 20),
  ].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.score - right.score;
  });
  const hasCompleteMatch = topEntries.some((item) => item.score === 0);

  let hasCompleteTextMatch = spanishResults.some((m) => m.exactText)
    || englishResults.some((m) => m.exactText);

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
