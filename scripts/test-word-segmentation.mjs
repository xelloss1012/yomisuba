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

  // A する verb is one word, in every form, with the endings that follow it.
  assert.deepEqual(surfaces('察するに'), ['察する', 'に']);
  assert.deepEqual(surfaces('察すれば'), ['察すれ', 'ば']);
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
  const guess = await getDictionarySearchTerms('察すれば', 'es');
  assert.equal(guess.baseForm, '察する');
  assert((await first('察すれば', 'es')).kanji.includes('察する'));

  console.log('PASS: kuromoji pieces are joined into the words a reader means (suffixes, する verbs) and looked up main word first.');
} finally {
  await server.close();
}
