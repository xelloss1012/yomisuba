// Builds an optional dictionary of Japanese words from one Wiktionary edition,
// as extracted by kaikki.org (wiktextract, CC BY-SA / GFDL). The glosses come in
// the language of the edition: Japanese Wiktionary gives the Japanese–Japanese
// dictionary (国語辞典), the Chinese, Korean, Vietnamese and Italian ones give
// Japanese–Chinese, Japanese–Korean...
//
//   curl -LO https://kaikki.org/jawiktionary/raw-wiktextract-data.jsonl.gz
//   node scripts/build-wiktionary-dictionary.mjs raw-wiktextract-data.jsonl.gz ja-ja-dictionary.json.gz
//
// Any extract of the edition works (the full raw dump or the per-language file):
// only lines whose word is Japanese (lang_code "ja") are read.
//
// The output uses the same compact entry format as the bundled JMdict files
// ({ id, k, r, s: [{ p, g }] }) plus `y` for synonyms and `i` for words that
// conjugate, so the app indexes and ranks it with the same code. It is not
// bundled: users download it from the settings screen (src/utils/optionalDictionaries.ts).
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip, createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/build-wiktionary-dictionary.mjs <wiktextract.jsonl[.gz]> <output.json.gz>');
  process.exit(1);
}

const MAX_SENSES = 8;
const MAX_GLOSS_LENGTH = 220;
const MAX_SYNONYMS = 10;
const MAX_READINGS = 6;

// Proper nouns, romanizations and empty redirects bloat the file without
// helping a reader look up words in running text.
const SKIPPED_POS = new Set(['name', 'symbol', 'romanization', 'soft-redirect']);
// wiktextract parts of speech that conjugate. Editions name them in their own
// language (動詞, 동사, Verbo...), so the app is told through `i` instead.
const INFLECTABLE_POS = new Set(['verb', 'adj', 'adj_noun', 'aux']);
// The Chinese edition leaves most parts of speech unset and marks them in the gloss.
const INFLECTABLE_GLOSS_MARK = /^〈(动|形|形动|助动)〉/;

const KANA = /^[぀-ヿー\-・]+$/;
const KANJI_SPELLING_OF = /^(.+?)の漢字表記/;
const JAPANESE_LINE = /"lang_code":\s*"ja"/;

const unique = (items) => [...new Set(items.filter(Boolean))];
const isKana = (text) => KANA.test(text);

const cleanGloss = (gloss) => {
  const text = gloss.replace(/。。+/g, '。').replace(/\s+/g, ' ').trim();
  return text.length > MAX_GLOSS_LENGTH ? `${text.slice(0, MAX_GLOSS_LENGTH - 1)}…` : text;
};

// 食べる + ruby [["食", "た"]] → たべる
const readingFromRuby = (form) => {
  if (!form.ruby?.length) return null;
  let reading = '';
  let rest = form.form;
  for (const [base, kana] of form.ruby) {
    const at = rest.indexOf(base);
    if (at < 0) return null;
    reading += rest.slice(0, at) + kana;
    rest = rest.slice(at + base.length);
  }
  reading += rest;
  return isKana(reading) ? reading : null;
};

const readingsOf = (entry) => unique([
  ...(entry.forms || []).map((form) => {
    const tags = form.tags || [];
    if (tags.includes('transliteration') && isKana(form.form)) return form.form.replace(/-/g, '');
    // Conjugation tables carry ruby too (めしあがった); only the headword's own spelling counts.
    return tags.includes('canonical') ? readingFromRuby(form) : null;
  }),
  ...(entry.sounds || []).map((sound) => (sound.other && isKana(sound.other) ? sound.other : null)),
]).slice(0, MAX_READINGS);

const spellingsOf = (entry) => unique(
  (entry.forms || [])
    .filter((form) => (form.tags || []).some((tag) => tag === 'kanji' || tag === 'kyūjitai' || tag === 'alternative'))
    .map((form) => form.form)
    .filter((form) => !isKana(form)),
);

// An entry that only points at another spelling ("食べる: たべるの漢字表記",
// form_of / alt_of) joins the entry it points to.
const redirectTarget = (entry) => {
  const senses = entry.senses || [];
  if (!senses.length) return null;
  const targets = senses.map((sense) =>
    sense.form_of?.[0]?.word || sense.alt_of?.[0]?.word || sense.glosses?.[0]?.match(KANJI_SPELLING_OF)?.[1] || null,
  );
  return targets.every(Boolean) ? targets[0] : null;
};

const words = new Map(); // headword → { k, r, s, y, i }
const redirects = []; // [spelling, target]

const input = createReadStream(inputPath);
const lines = createInterface({
  input: inputPath.endsWith('.gz') ? input.pipe(createGunzip()) : input,
  crlfDelay: Infinity,
});

let read = 0;
for await (const line of lines) {
  // Cheap pre-filter: in the full dumps most lines are other languages.
  if (!JAPANESE_LINE.test(line)) continue;
  const entry = JSON.parse(line);
  if (entry.lang_code !== 'ja' || SKIPPED_POS.has(entry.pos)) continue;
  read += 1;

  const target = redirectTarget(entry);
  if (target && target !== entry.word) {
    redirects.push([entry.word, target]);
    continue;
  }

  const glosses = (entry.senses || [])
    .filter((sense) => !(sense.tags || []).includes('no-gloss'))
    .map((sense) => sense.glosses?.at(-1))
    .filter((gloss) => gloss && !KANJI_SPELLING_OF.test(gloss))
    .map(cleanGloss);
  if (!glosses.length) continue;

  const word = words.get(entry.word) || { k: [], r: [], s: [], y: [], i: false };
  const kanaWord = isKana(entry.word);
  // A single kanji lists its on/kun readings, which are not words of their own:
  // indexing them would answer a lookup of しずか with 閑 or 禅.
  const isSingleKanji = !kanaWord && [...entry.word].length === 1;
  word.k.push(...(kanaWord ? [] : [entry.word]), ...spellingsOf(entry));
  word.r.push(...(kanaWord ? [entry.word] : []), ...(isSingleKanji ? [] : readingsOf(entry)));
  const pos = entry.pos === 'unknown' ? null : entry.pos_title || entry.pos;
  word.s.push({ p: pos ? [pos] : [], g: glosses });
  word.i ||= INFLECTABLE_POS.has(entry.pos) || glosses.some((gloss) => INFLECTABLE_GLOSS_MARK.test(gloss));
  word.y.push(
    ...(entry.synonyms || []).map((item) => item.word),
    ...(entry.senses || []).flatMap((sense) => (sense.synonyms || []).map((item) => item.word)),
  );
  words.set(entry.word, word);
}

let joined = 0;
for (const [spelling, target] of redirects) {
  const word = words.get(target);
  if (!word) continue;
  word.k.push(spelling);
  joined += 1;
}

let id = 0;
const output = [];
for (const [headword, word] of words) {
  const senses = [];
  let glossCount = 0;
  for (const sense of word.s) {
    const room = MAX_SENSES - glossCount;
    if (room <= 0) break;
    senses.push({ p: sense.p, g: sense.g.slice(0, room) });
    glossCount += Math.min(sense.g.length, room);
  }
  const k = unique(word.k);
  const r = unique(word.r);
  const synonyms = unique(word.y).filter((synonym) => synonym !== headword).slice(0, MAX_SYNONYMS);
  output.push({
    id: `w${(id += 1).toString(36)}`,
    k,
    r: r.length || k.length ? r : [headword],
    s: senses,
    ...(synonyms.length ? { y: synonyms } : {}),
    ...(word.i ? { i: 1 } : {}),
  });
}

// One entry per line keeps the JSON valid while letting gzip find repetition.
const json = `[\n${output.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`;
await pipeline(Readable.from([json]), createGzip({ level: 9 }), createWriteStream(outputPath));

console.log(JSON.stringify({
  entriesRead: read,
  entriesWritten: output.length,
  spellingsJoined: joined,
  rawBytes: Buffer.byteLength(json),
  gzipBytes: statSync(outputPath).size,
}));
