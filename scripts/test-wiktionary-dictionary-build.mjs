import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const build = (directory, lines) => {
  const input = join(directory, 'input.jsonl');
  const output = join(directory, 'output.json.gz');
  // Unspaced JSON on purpose: the pre-filter must not depend on the dump's spacing.
  writeFileSync(input, lines.map((entry) => JSON.stringify(entry)).join('\n'));
  execFileSync(process.execPath, [resolve(import.meta.dirname, 'build-wiktionary-dictionary.mjs'), input, output], { stdio: 'pipe' });
  const entries = JSON.parse(gunzipSync(readFileSync(output)).toString('utf8'));
  return { entries, find: (form) => entries.find((entry) => entry.k.includes(form) || entry.r.includes(form)) };
};

const directory = mkdtempSync(join(tmpdir(), 'wiktionary-dictionary-'));
try {
  // Japanese Wiktionary shapes: kanji spellings as forms or 「…の漢字表記」 redirects.
  const japanese = build(directory, [
    {
      word: 'たべる', lang_code: 'ja', pos: 'verb', pos_title: '動詞',
      senses: [{ glosses: ['何かを、口から嚙んで飲み込む。'] }, { glosses: ['生計を立てる。'] }],
      forms: [{ form: '食べる', tags: ['kanji'] }, { form: 'たべない', tags: ['negative', 'imperfective'] }],
    },
    {
      word: '喰べる', lang_code: 'ja', pos: 'character', pos_title: '和語の漢字表記',
      senses: [{ glosses: ['たべるの漢字表記。'], form_of: [{ word: 'たべる' }] }],
    },
    {
      word: '静', lang_code: 'ja', pos: 'noun', pos_title: '名詞',
      senses: [{ glosses: ['しずかなこと。'] }],
      forms: [{ form: 'しずか', tags: ['transliteration', 'kun'] }],
    },
    {
      word: '青空', lang_code: 'ja', pos: 'noun', pos_title: '名詞',
      senses: [{ glosses: ['青い空。'] }, { glosses: ['空の色', '（複合語の前項として）野外。'] }],
      forms: [{ form: 'あお-ぞら', tags: ['transliteration'] }],
      synonyms: [{ word: '晴天' }, { word: '青空' }],
    },
    { word: '東京', lang_code: 'ja', pos: 'name', pos_title: '固有名詞', senses: [{ glosses: ['日本の首都。'] }] },
    { word: 'cat', lang_code: 'en', pos: 'noun', pos_title: '名詞', senses: [{ glosses: ['猫。'] }] },
  ]);
  assert.equal(japanese.entries.length, 3, 'proper nouns, other languages and redirects are not entries');
  const taberu = japanese.find('たべる');
  assert.deepEqual(taberu.k, ['食べる', '喰べる'], 'kanji forms and redirects join the kana entry');
  assert.deepEqual(taberu.r, ['たべる']);
  assert.deepEqual(taberu.s, [{ p: ['動詞'], g: ['何かを、口から嚙んで飲み込む。', '生計を立てる。'] }]);
  assert.equal(taberu.i, 1, 'verbs are flagged as inflectable');
  assert.deepEqual(japanese.find('静').r, [], 'readings of a single kanji are not indexed as words');
  const aozora = japanese.find('青空');
  assert.deepEqual(aozora.r, ['あおぞら'], 'readings lose the okurigana hyphen');
  assert.deepEqual(aozora.s[0].g, ['青い空。', '（複合語の前項として）野外。'], 'the most specific gloss of each sense');
  assert.deepEqual(aozora.y, ['晴天'], 'synonyms exclude the headword itself');
  assert.equal(aozora.i, undefined);

  // Other editions: readings in ruby or sounds, alt_of redirects, romanization
  // entries, glossless senses and parts of speech only marked in the gloss.
  const chinese = build(directory, [
    {
      word: '召し上がる', lang_code: 'ja', pos: 'verb', pos_title: '动词',
      forms: [
        { form: '召し上がる', tags: ['canonical'], ruby: [['召', 'め'], ['上', 'あ']] },
        { form: '召し上がった', tags: ['past'], ruby: [['召', 'め'], ['上', 'あ']] },
      ],
      senses: [{ glosses: ['吃，喝'] }],
    },
    {
      word: '概念', lang_code: 'ja', pos: 'noun', pos_title: '名詞',
      forms: [{ form: '槪念', tags: ['alternative', 'kanji'] }],
      sounds: [{ other: 'がいねん', roman: '[gáꜜìnèǹ]' }],
      senses: [{ glosses: ['概念'] }],
    },
    { word: 'あまた', lang_code: 'ja', pos: 'unknown', senses: [{ glosses: ['(书面语)许多，众多。'] }] },
    { word: 'たべる', lang_code: 'ja', pos: 'unknown', senses: [{ glosses: ['〈动〉吃。'] }] },
    { word: 'taberu', lang_code: 'ja', pos: 'romanization', senses: [{ glosses: ['たべる的罗马字。'] }] },
    { word: 'こんにちは', lang_code: 'ja', pos: 'unknown', senses: [{ tags: ['no-gloss'] }] },
    { word: '槪念', lang_code: 'ja', pos: 'noun', senses: [{ glosses: ['概念的旧字体。'], alt_of: [{ word: '概念' }] }] },
  ]);
  assert.equal(chinese.entries.length, 4, 'romanizations, glossless entries and redirects are not entries');
  assert.deepEqual(chinese.find('召し上がる').r, ['めしあがる'], 'reading rebuilt from the canonical ruby only');
  assert.equal(chinese.find('召し上がる').i, 1);
  const gainen = chinese.find('概念');
  assert.deepEqual(gainen.k, ['概念', '槪念'], 'alternative spellings and alt_of redirects join, once');
  assert.deepEqual(gainen.r, ['がいねん'], 'reading taken from sounds');
  assert.deepEqual(chinese.find('あまた').s, [{ p: [], g: ['(书面语)许多，众多。'] }], 'unknown parts of speech are left empty');
  assert.equal(chinese.find('たべる').i, 1, 'a verb marked only in the gloss is inflectable');

  console.log('PASS: Wiktionary dictionaries join spellings, rebuild readings, flag inflectable words and skip non-entries.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
