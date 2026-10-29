import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { DOMParser } from 'linkedom';
import { createServer } from 'vite';

// annotateFurigana parses the chapter and walks its text: linkedom stands for the browser here.
globalThis.DOMParser = DOMParser;
globalThis.NodeFilter = { SHOW_TEXT: 4 };

const require = createRequire(import.meta.url);
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
  const { annotateFurigana } = await server.ssrLoadModule('/src/utils/furigana.ts');
  const { loadWordLevels } = await server.ssrLoadModule('/src/utils/wordLevels.ts');
  const study = await server.ssrLoadModule('/src/utils/studyProgress.ts');
  const levels = await loadWordLevels();
  const html = '<html><body><p>王は激怒した。</p></body></html>';
  const readings = async (knownKanji) => {
    const out = await annotateFurigana(html, {
      mode: 'difficult',
      studyLevel: 5,
      tokenize: async (text) => tokenizer.tokenize(text),
      levels,
      ...(knownKanji ? { knownKanji } : {}),
    });
    return [...out.matchAll(/<span[^>]*data-gf="([^"]+)"[^>]*>([^<]+)</g)].map((match) => `${match[2]}:${match[1]}`);
  };

  // 激怒 is above N5: it gets its reading.
  assert.deepEqual(await readings(), ['王:おう', '激怒:げきど']);
  // Both its kanji learnt in the reviews: the reader can read it, whatever its level.
  assert.deepEqual(await readings(new Set(['激', '怒'])), ['王:おう']);
  // One of them still unknown: the word keeps its readings.
  assert.deepEqual(await readings(new Set(['激'])), ['王:おう', '激怒:げきど']);

  // The kanji learnt are those whose card is known.
  const now = Date.now();
  let progress = study.emptyProgress();
  progress = study.setCard(progress, study.kanjiKey('激'), study.markKnown(undefined, now));
  progress = study.setCard(progress, study.kanjiKey('怒'), study.resetCard(now));
  progress = study.setCard(progress, '激怒|げきど', study.markKnown(undefined, now));
  assert.deepEqual([...study.knownKanji(progress)], ['激'], 'a new kanji or a known word is not a known kanji');

  console.log('PASS: in "difficult" furigana, words whose kanji are all known in the reviews lose their reading.');
} finally {
  await server.close();
}
