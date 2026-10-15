import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

// A few wiktextract lines with the shapes the converter has to handle.
const fixture = [
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
    forms: [{ form: 'しずか', tags: ['transliteration', 'kun'] }, { form: 'セイ', tags: ['transliteration', 'kan-on'] }],
  },
  {
    word: '青空', lang_code: 'ja', pos: 'noun', pos_title: '名詞',
    senses: [{ glosses: ['青い空。'] }, { glosses: ['空の色', '（複合語の前項として）野外。'] }],
    forms: [{ form: 'あお-ぞら', tags: ['transliteration'] }],
    synonyms: [{ word: '晴天' }, { word: '青空' }],
  },
  { word: '東京', lang_code: 'ja', pos: 'name', pos_title: '固有名詞', senses: [{ glosses: ['日本の首都。'] }] },
  { word: 'cat', lang_code: 'en', pos: 'noun', pos_title: '名詞', senses: [{ glosses: ['猫。'] }] },
];

const directory = mkdtempSync(join(tmpdir(), 'ja-dictionary-'));
try {
  const input = join(directory, 'input.jsonl');
  const output = join(directory, 'output.json.gz');
  writeFileSync(input, fixture.map((entry) => JSON.stringify(entry)).join('\n'));
  execFileSync(process.execPath, [
    resolve(import.meta.dirname, 'build-ja-dictionary.mjs'), input, output,
  ], { stdio: 'pipe' });

  const entries = JSON.parse(gunzipSync(readFileSync(output)).toString('utf8'));
  const find = (form) => entries.find((entry) => entry.k.includes(form) || entry.r.includes(form));

  assert.equal(entries.length, 3, 'proper nouns, other languages and redirects are not entries');

  const taberu = find('たべる');
  assert.deepEqual(taberu.k, ['食べる', '喰べる'], 'kanji forms and redirects join the kana entry');
  assert.deepEqual(taberu.r, ['たべる']);
  assert.deepEqual(taberu.s, [{ p: ['動詞'], g: ['何かを、口から嚙んで飲み込む。', '生計を立てる。'] }]);

  const sei = find('静');
  assert.deepEqual(sei.r, [], 'readings of a single kanji are not indexed as words');

  const aozora = find('青空');
  assert.deepEqual(aozora.r, ['あおぞら'], 'readings lose the okurigana hyphen');
  assert.deepEqual(aozora.s[0].g, ['青い空。', '（複合語の前項として）野外。'], 'the most specific gloss of each sense');
  assert.deepEqual(aozora.y, ['晴天'], 'synonyms exclude the headword itself');

  console.log('PASS: Japanese dictionary build joins spellings, keeps word readings, and extracts senses and synonyms.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
