import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'vite';

// The reader runs kuromoji in a worker; here the same dictionary answers in-process.
const require = createRequire(import.meta.url);
const kuromoji = require('kuromoji');
const dicPath = resolve(import.meta.dirname, '..', 'node_modules', 'kuromoji', 'dict').split(String.fromCharCode(92)).join('/');
const tokenizer = await new Promise((done, fail) => kuromoji.builder({ dicPath }).build((error, built) => (error ? fail(error) : done(built))));
globalThis.window = { setTimeout, clearTimeout, location: { href: 'http://localhost/' } };
globalThis.Worker = class {
  postMessage(message) {
    queueMicrotask(() => {
      if (message.type === 'init') this.onmessage?.({ data: { type: 'ready' } });
      else if (message.type === 'tokenize') this.onmessage?.({ data: { type: 'tokens', id: message.id, tokens: tokenizer.tokenize(message.text) } });
    });
  }
  terminate() {}
};

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
  const { getDictionarySearchTerms } = await server.ssrLoadModule('/src/utils/dictionary.ts');
  const { mergeJapaneseTokens } = await server.ssrLoadModule('/src/utils/tokenMerging.ts');

  // The words the reader offers for a text, as it locates the tokens on the page.
  const words = (text) => {
    const located = [];
    let from = 0;
    for (const token of tokenizer.tokenize(text)) {
      const start = text.indexOf(token.surface_form, from);
      if (start < 0) continue;
      from = start + token.surface_form.length;
      located.push({ token, start, end: from });
    }
    return mergeJapaneseTokens(located);
  };
  const surfaces = (text) => words(text).map(({ token }) => token.surface_form);

  // A noun and its suffix are one word.
  assert.deepEqual(surfaces('ワニ系の生き物'), ['ワニ系', 'の', '生き物']);
  assert.deepEqual(surfaces('習得済みの技術'), ['習得済み', 'の', '技術']);

  // 気 after an adjectival noun is its suffix, and a prefix belongs to its noun.
  assert.deepEqual(surfaces('不安気に'), ['不安気', 'に']);
  assert.deepEqual(surfaces('不安気な顔'), ['不安気な', '顔']);
  assert.deepEqual(surfaces('不安げに'), ['不安げ', 'に']);
  assert.deepEqual(surfaces('お金がない'), ['お金', 'が', 'ない']);
  assert.deepEqual(surfaces('空気を読む'), ['空気', 'を', '読む']);
  assert.equal(words('不安気な顔')[0].token.basic_form, '不安気');

  // The conditional ば and the contracted ちゃ / ちゃう / どく belong to the verb before them.
  assert.deepEqual(surfaces('終われば'), ['終われば']);
  assert.deepEqual(surfaces('浸かっていれば'), ['浸かっていれば']);
  assert.deepEqual(surfaces('高ければ'), ['高ければ']);
  assert.deepEqual(surfaces('食べなければ'), ['食べなければ']);
  assert.deepEqual(surfaces('静かならば'), ['静かならば']);
  assert.deepEqual(surfaces('鳴っちゃ'), ['鳴っちゃ']);
  assert.deepEqual(surfaces('読んじゃ'), ['読んじゃ']);
  assert.deepEqual(surfaces('鳴っちゃった'), ['鳴っちゃった']);
  assert.deepEqual(surfaces('食べちゃう'), ['食べちゃう']);
  assert.deepEqual(surfaces('読んどく'), ['読んどく']);
  assert.deepEqual(surfaces('行けば試す'), ['行けば', '試す']);
  // A prefix before a katakana word is not part of it.
  assert.deepEqual(surfaces('今オリ'), ['今', 'オリ']);
  assert.deepEqual(surfaces('オリごと'), ['オリごと']);

  // A する verb is one word, in every form, with the endings that follow it.
  assert.deepEqual(surfaces('察するに'), ['察する', 'に']);
  assert.deepEqual(surfaces('察すれば'), ['察すれば']);
  assert.deepEqual(surfaces('察せない'), ['察せない']);
  assert.deepEqual(surfaces('勉強している'), ['勉強している']);
  assert.deepEqual(surfaces('彼女は勉強して'), ['彼女', 'は', '勉強して']);
  const suru = words('察すれば')[0].token;
  assert.equal(suru.pos, '動詞');
  assert.equal(suru.basic_form, '察する');

  // A noun that merely sits next to する, or is not followed by it, stays alone.
  assert.deepEqual(surfaces('勉強を始めた'), ['勉強', 'を', '始めた']);
  assert.deepEqual(surfaces('察しがつく'), ['察し', 'が', 'つく']);

  // Verbs that were already one word are untouched.
  assert.deepEqual(surfaces('察する'), ['察する']);
  assert.deepEqual(surfaces('送り出してしまおう'), ['送り出してしまおう']);

  // Looking up a word kuromoji cut in pieces: the main word comes first, whatever the language.
  const first = async (text, language) => (await getDictionarySearchTerms(text, language)).entries[0];
  for (const language of ['es', 'en']) {
    assert((await first('ワニ系', language)).kanji.includes('鰐'), `ワニ系 should lead with the crocodile in ${language}`);
    assert((await first('習得済み', language)).kanji.includes('習得'), `習得済み should lead with 習得 in ${language}`);
  }
  assert((await first('不安気', 'es')).kanji.includes('不安気'), '不安気 is a word of its own in the dictionary');
  // The word the reader shows is the word looked up, with the particle or ending it carries.
  for (const text of ['不安気な', '不安気に']) {
    assert((await first(text, 'es')).kanji.includes('不安気'), text + ' should lead with 不安気, not with its prefix');
  }
  assert((await first('お金が', 'es')).kanji.includes('お金'));
  // A word written in katakana for effect is looked up in its usual spelling too.
  const kana = async (text) => (await getDictionarySearchTerms(text, 'es')).entries.slice(0, 5).flatMap((entry) => entry.kanji);
  assert((await kana('オリ')).includes('檻'), 'オリ finds the cage, written 檻 or おり');
  assert((await kana('ココロ')).includes('心'));
  assert((await kana('オリの中')).includes('檻'), 'also as a word inside a phrase');
  assert((await getDictionarySearchTerms('オリ', 'es')).hasCompleteMatch, 'and counts as a complete match');
  // Causative and passive endings change the voice, not the word: the verb before them is looked up.
  for (const [text, verb] of [['かけさせよう', 'かける'], ['食べさせよう', '食べる'], ['書かせよう', '書く'], ['読まれる', '読む'], ['見られた', '見る']]) {
    const lookup = await getDictionarySearchTerms(text, 'es');
    assert.equal(lookup.baseForm, verb, text);
    const top = lookup.entries[0];
    assert((top.kanji.concat(top.kana)).includes(verb), text + ' should lead with ' + verb + ', not with its stem');
  }
  // 今オリ is found by its katakana word, and the verb of a conditional or a contraction is what is looked up.
  assert((await kana('今オリ')).includes('檻'));
  assert((await kana('オリごと')).includes('檻'));
  for (const [text, verb] of [['終われば', '終わる'], ['浸かっていれば', '浸かる'], ['鳴っちゃ', '鳴る'], ['食べちゃう', '食べる'], ['高ければ', '高い']]) {
    assert.equal((await getDictionarySearchTerms(text, 'es')).baseForm, verb, text);
  }
  const guess = await getDictionarySearchTerms('察すれば', 'es');
  assert.equal(guess.baseForm, '察する');
  assert((await first('察すれば', 'es')).kanji.includes('察する'));

  console.log('PASS: kuromoji pieces are joined into the words a reader means (suffixes, する verbs) and looked up main word first.');
} finally {
  await server.close();
}
