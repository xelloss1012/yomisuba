import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
// The reader runs kuromoji in a worker; here the same dictionary answers in-process.
const kuromoji = require('kuromoji');
const dicPath = resolve(import.meta.dirname, '..', 'node_modules', 'kuromoji', 'dict').split(String.fromCharCode(92)).join('/');
const tokenizer = await new Promise((done, fail) => kuromoji.builder({ dicPath }).build((error, built) => (error ? fail(error) : done(built))));

const root = resolve(import.meta.dirname, '..');
const server = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const { analyzeChapter, chapterText, collectGlossary, collectGlossaryKanji, isStudyWord, toHiragana } = await server.ssrLoadModule('/src/utils/bookGlossary.ts');
  const parse = (html) => parseHTML(`<html><body>${html}</body></html>`).document;

  // --- The text of a chapter --------------------------------------------------------------
  const one = chapterText('<h1>第一章</h1><p>メロスは<ruby>激怒<rt>げきど</rt></ruby>した。</p><p>王様は<ruby>邪智暴虐<rt>じゃちぼうぎゃく</rt></ruby>だった</p><script>x()</script>', parse);
  assert.equal(one, '第一章\nメロスは激怒した。\n王様は邪智暴虐だった', 'no readings, a line per paragraph, no scripts');

  // --- The words of the chapters ------------------------------------------------------------
  const analyze = (index, html) => {
    const text = chapterText(html, parse);
    return analyzeChapter(index, text, tokenizer.tokenize(text));
  };
  const chapters = [
    analyze(1, '<p>メロスは激怒した。必ず、かの邪智暴虐の王を除かなければならぬと決意した。</p><p>メロスは王の城へ走った。</p>'),
    analyze(0, '<p>村の牧人である。笛を吹き、羊と遊んで暮して来た。</p>'),
    analyze(2, '<p>王は激怒した。城の兵は走って来た。三人の兵がいた。私はそれを見ていない。</p>'),
  ];
  const words = collectGlossary(chapters);
  const word = (key) => words.find((item) => item.key === key);

  assert.ok(word('激怒'), 'a noun of the text');
  assert.equal(word('激怒').count, 2);
  assert.deepEqual([...word('激怒').perChapter], [[1, 1], [2, 1]]);
  assert.equal(word('激怒').firstChapter, 1);
  assert.equal(word('激怒').context, 'メロスは激怒した。', 'with the sentence it first appears in');
  assert.equal(word('走る').count, 2, 'verbs by their base form: 走った, 走って');
  assert.equal(word('牧人').firstChapter, 0, 'chapters are read in their order');
  assert.equal(word('王').count, 3, 'a lone kanji is a word');
  for (const grammar of ['は', 'た', 'の', 'を', 'メロス', '私', '三', '人', 'ない', 'それ', '来る']) {
    assert.equal(word(grammar), undefined, `${grammar} is not vocabulary to learn`);
  }
  assert.ok(word('決意'));

  // Order of first appearance within a chapter, for the glossary of a chapter.
  const inChapter1 = words.filter((item) => item.perChapter.has(1)).sort((a, b) => a.firstInChapter.get(1) - b.firstInChapter.get(1));
  assert.deepEqual(inChapter1.slice(0, 2).map((item) => item.key), ['激怒', '必ず']);

  assert.equal(isStudyWord({ surface_form: 'ね', pos: '助詞', basic_form: 'ね' }), false);
  assert.equal(isStudyWord({ surface_form: 'こと', pos: '名詞', pos_detail_1: '非自立', basic_form: 'こと' }), false);
  assert.equal(isStudyWord({ surface_form: 'ABC', pos: '名詞', pos_detail_1: '一般', basic_form: 'ABC' }), false, 'no Japanese, no word');
  assert.equal(isStudyWord({ surface_form: 'ゆっくり', pos: '副詞', basic_form: 'ゆっくり' }), true);
  assert.equal(word('牧人').writtenInKana, false);
  assert.equal(word('牧人').reading, 'ぼくじん', 'the reading the text gives it');
  assert.equal(word('走る').reading, undefined, 'an inflected word has no reading of its base form');
  assert.equal(toHiragana('メロス'), 'めろす');

  // --- Kanji mode: the kanji written in the chapters, and the words with each ---------------------
  const kanji = collectGlossaryKanji(chapters, words);
  const of = (literal) => kanji.find((item) => item.kanji === literal);
  assert.equal(of('王').count, 3, 'every time it is written');
  assert.deepEqual([...of('王').perChapter], [[1, 2], [2, 1]]);
  assert.equal(of('牧').firstChapter, 0);
  assert.ok(of('激').words.includes('激怒'), 'the words that write it');
  assert.equal(of('激').words[0], '激怒');
  assert.ok(!kanji.some((item) => /[ぁ-んァ-ン。、]/.test(item.kanji)), 'only kanji');

  console.log('PASS: the chapters are read without ruby readings, and their words are counted by base form, per chapter, with their first sentence.');
} finally {
  await server.close();
}
