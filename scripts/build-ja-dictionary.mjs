// Builds the optional Japanese–Japanese dictionary (国語辞典) from the Japanese
// Wiktionary extract published by kaikki.org (wiktextract, CC BY-SA / GFDL).
//
//   curl -LO https://kaikki.org/jawiktionary/raw-wiktextract-data.jsonl.gz
//   node scripts/build-ja-dictionary.mjs raw-wiktextract-data.jsonl.gz ja-ja-dictionary.json.gz
//
// The output uses the same compact entry format as the bundled JMdict files
// ({ id, k, r, s: [{ p, g }] }) plus `y` for synonyms, so the app indexes and
// ranks it with the same code. It is not bundled: users download it from the
// settings screen (see src/utils/japaneseDictionary.ts).
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip, createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/build-ja-dictionary.mjs <raw-wiktextract-data.jsonl[.gz]> <output.json.gz>');
  process.exit(1);
}

const MAX_SENSES = 8;
const MAX_GLOSS_LENGTH = 220;
const MAX_SYNONYMS = 10;
const MAX_READINGS = 6;

// Proper nouns, single-character entries and symbols bloat the file without
// helping a reader look up words in running text.
const SKIPPED_POS = new Set(['name', 'symbol']);

const KANA = /^[぀-ヿー\-・]+$/;
const KANJI_SPELLING_OF = /^(.+?)の漢字表記/;
const JAPANESE_LINE = /"lang_code":\s*"ja"/;

const unique = (items) => [...new Set(items.filter(Boolean))];

const cleanGloss = (gloss) => {
  const text = gloss.replace(/。。+/g, '。').replace(/\s+/g, ' ').trim();
  return text.length > MAX_GLOSS_LENGTH ? `${text.slice(0, MAX_GLOSS_LENGTH - 1)}…` : text;
};

const readingsOf = (entry) => unique(
  (entry.forms || [])
    .filter((form) => (form.tags || []).includes('transliteration') && KANA.test(form.form))
    .map((form) => form.form.replace(/-/g, '')),
).slice(0, MAX_READINGS);

const spellingsOf = (entry) => unique(
  (entry.forms || [])
    .filter((form) => (form.tags || []).some((tag) => tag === 'kanji' || tag === 'kyūjitai'))
    .map((form) => form.form),
);

// "食べる" → "たべるの漢字表記" (form_of: たべる): only an alternative spelling.
const redirectTarget = (entry) => {
  const senses = entry.senses || [];
  if (!senses.length) return null;
  const targets = senses.map((sense) =>
    sense.form_of?.[0]?.word || sense.glosses?.[0]?.match(KANJI_SPELLING_OF)?.[1] || null,
  );
  return targets.every(Boolean) ? targets[0] : null;
};

const words = new Map(); // headword → { k, r, s, y }
const redirects = []; // [spelling, target]

const input = createReadStream(inputPath);
const lines = createInterface({
  input: inputPath.endsWith('.gz') ? input.pipe(createGunzip()) : input,
  crlfDelay: Infinity,
});

let read = 0;
for await (const line of lines) {
  // Cheap pre-filter: most lines are other languages and not worth parsing.
  if (!JAPANESE_LINE.test(line)) continue;
  const entry = JSON.parse(line);
  if (entry.lang_code !== 'ja' || SKIPPED_POS.has(entry.pos)) continue;
  read += 1;

  const target = redirectTarget(entry);
  if (target) {
    redirects.push([entry.word, target]);
    continue;
  }

  const senses = (entry.senses || [])
    .map((sense) => sense.glosses?.at(-1))
    .filter((gloss) => gloss && !KANJI_SPELLING_OF.test(gloss))
    .map(cleanGloss);
  if (!senses.length) continue;

  const word = words.get(entry.word) || { k: [], r: [], s: [], y: [] };
  const isKana = KANA.test(entry.word);
  // A single kanji lists its on/kun readings, which are not words of their own:
  // indexing them would answer a lookup of しずか with 閑 or 禅.
  const isSingleKanji = !isKana && [...entry.word].length === 1;
  word.k.push(...(isKana ? [] : [entry.word]), ...spellingsOf(entry));
  word.r.push(...(isKana ? [entry.word] : []), ...(isSingleKanji ? [] : readingsOf(entry)));
  word.s.push({ p: [entry.pos_title || entry.pos], g: senses });
  word.y.push(
    ...(entry.synonyms || []).map((item) => item.word),
    ...(entry.senses || []).flatMap((sense) => (sense.synonyms || []).map((item) => item.word)),
  );
  words.set(entry.word, word);
}

// Alternative spellings join the entry they point to, so looking up 食べる finds
// the definitions stored under たべる.
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
    id: `ja${(id += 1).toString(36)}`,
    k,
    r: r.length || k.length ? r : [headword],
    s: senses,
    ...(synonyms.length ? { y: synonyms } : {}),
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
