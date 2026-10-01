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
  hasCompleteMatch: boolean;
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

const isInflectableEntry = (entry: CompactEntry, form: string): boolean => {
  return entry.s.some((sense) =>
    sense.p.some((pos) => {
      const normalizedPos = pos.toLowerCase();
      const isSuruVerb = pos === 'vs' || pos.startsWith('vs-') || normalizedPos.includes('verb suru');
      const isVerb = (pos.startsWith('v') && !pos.startsWith('vs')) ||
        (/\bverb\b/.test(normalizedPos) && (!isSuruVerb || form.endsWith('する')));
      const isAdjective = pos.startsWith('adj') || /\badjective\b/.test(normalizedPos);
      return isVerb || isAdjective || (isSuruVerb && form.endsWith('する'));
    })
  );
};

const findRawEntries = (
  directTerms: string[],
  inflectedTerms: string[],
  index: DictionaryIndex,
): Array<{ entry: CompactEntry; score: number }> => {
  const normalizedDirect = unique(directTerms.map(normalizeSelection)).filter(Boolean);
  const normalizedInflected = unique(inflectedTerms.map(normalizeSelection)).filter(Boolean);
  const ranked = new Map<string, { entry: CompactEntry; score: number }>();

  const addMatches = (matches: CompactEntry[] | undefined, score: number, form: string, requireInflectable = false) => {
    for (const entry of matches || []) {
      const effectiveScore = requireInflectable && !isInflectableEntry(entry, form)
        ? Math.max(score, 5)
        : score;
      const current = ranked.get(entry.id);
      if (!current || effectiveScore < current.score) {
        ranked.set(entry.id, { entry, score: effectiveScore });
      }
    }
  };

  for (const term of normalizedDirect) {
    addMatches(index.byForm.get(term), 0, term);

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

  for (const term of normalizedInflected) {
    addMatches(index.byForm.get(term), 0, term, true);

    for (let length = 2; length < term.length; length += 1) {
      addMatches(index.byForm.get(term.slice(0, length)), 10 + (term.length - length), term, true);
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
        addMatches(index.byForm.get(form), 20 + (form.length - term.length), term, true);
      }
    }
  }

  return [...ranked.values()].sort((left, right) => left.score - right.score);
};

export const getDictionarySearchTerms = async (value: string): Promise<DictionaryLookup> => {
  const originalText = normalizeSelection(value) || value.trim();
  if (!originalText) {
    return { originalText: '', baseForm: '', searchTerms: [], entries: [], hasCompleteMatch: false };
  }

  let searchTerms = guessBaseForms(originalText);
  const tokenSurfaceTerms: string[] = [];
  const tokenBaseForms: string[] = [];

  try {
    const tokenizer = await getTokenizer();
    const tokens = tokenizer.tokenize(originalText);
    for (const token of tokens) {
      if (!['記号', '助詞', '助動詞'].includes(token.pos) && token.surface_form) {
        tokenSurfaceTerms.push(token.surface_form);
        if (token.basic_form && token.basic_form !== '*') {
          tokenBaseForms.push(token.basic_form);
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

  searchTerms = unique([
    ...searchTerms,
    ...tokenSurfaceTerms,
    ...tokenBaseForms,
    originalText,
  ]).filter((term) => term.length > 0);

  // Solo el texto seleccionado completo se considera una búsqueda directa.
  // Las superficies y formas base de Kuromoji se evalúan como términos
  // morfológicos para que una segmentación parcial no parezca una coincidencia exacta.
  const directTerms = [originalText];
  const inflectedTerms = searchTerms.filter((term) => !directTerms.includes(term));

  const spanishResults = findRawEntries(directTerms, inflectedTerms, spanishIndex);
  let englishResults: Array<{ entry: CompactEntry; score: number }> = [];
  let englishFallbackError: string | undefined;

  try {
    const englishIndex = await getEnglishIndex();
    englishResults = findRawEntries(directTerms, inflectedTerms, englishIndex);
  } catch (error) {
    englishIndexPromise = null;
    englishFallbackError = error instanceof Error
      ? error.message
      : 'No se pudo cargar el complemento inglés de JMdict.';
  }

  const spanishIds = new Set(spanishResults.map((m) => m.entry.id));

  // 4-tier hybrid ranking:
  // priority 0: Spanish complete match (score === 0)
  // priority 1: English complete match (score === 0)
  // priority 2: Spanish partial match (score > 0)
  // priority 3: English partial match (score > 0)
  const combined = [
    ...spanishResults.map((m) => ({
      entry: toEntry(m.entry, 'es'),
      score: m.score,
      priority: m.score === 0 ? 0 : 2,
    })),
    ...englishResults
      .filter((m) => !spanishIds.has(m.entry.id))
      .map((m) => ({
        entry: toEntry(m.entry, 'en'),
        score: m.score,
        priority: m.score === 0 ? 1 : 3,
      })),
  ].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.score - right.score;
  });

  const topEntries = combined.slice(0, 20);
  const hasCompleteMatch = topEntries.some((item) => item.score === 0);

  return {
    originalText,
    baseForm: searchTerms[0] || originalText,
    searchTerms,
    entries: topEntries.map((item) => item.entry),
    hasCompleteMatch,
    englishFallbackError,
  };
};
