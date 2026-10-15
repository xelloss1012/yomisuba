import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';

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
  const { alignReading, resolveFuriganaMode, furiganaModeSettings } = await server.ssrLoadModule('/src/utils/furigana.ts');
  const show = (segments) => segments && segments.map(({ text, reading }) => (reading ? `${text}(${reading})` : text)).join('');

  // Okurigana stays bare; each kanji run gets its part of the reading.
  assert.equal(show(alignReading('食べる', 'タベル')), '食(た)べる');
  assert.equal(show(alignReading('取り扱い', 'トリアツカイ')), '取(と)り扱(あつか)い');
  assert.equal(show(alignReading('邪智暴虐', 'ジャチボウギャク')), '邪智暴虐(じゃちぼうぎゃく)');
  assert.equal(show(alignReading('お茶', 'オチャ')), 'お茶(ちゃ)');
  // Katakana in the spelling is matched against the katakana reading.
  assert.equal(show(alignReading('ドイツ語', 'ドイツゴ')), 'ドイツ語(ご)');
  assert.equal(show(alignReading('人々', 'ヒトビト')), '人々(ひとびと)');

  // No reading to add, or one that does not fit the spelling.
  assert.equal(alignReading('たべる', 'タベル'), null, 'kana words need no furigana');
  assert.equal(alignReading('東京', '*'), null, 'unknown words have no reading');
  assert.equal(alignReading('食べる', 'ノム'), null, 'a reading that contradicts the okurigana');
  assert.equal(alignReading('3人', 'サンニン'), null, 'digits are not guessed');

  // Settings saved before the modes keep their meaning.
  assert.equal(resolveFuriganaMode({ showFurigana: true }), 'original');
  assert.equal(resolveFuriganaMode({ showFurigana: false }), 'hidden');
  assert.equal(resolveFuriganaMode({ showFurigana: false, furiganaMode: 'always' }), 'always');
  assert.deepEqual(furiganaModeSettings('hidden'), { furiganaMode: 'hidden', showFurigana: false });
  assert.deepEqual(furiganaModeSettings('difficult'), { furiganaMode: 'difficult', showFurigana: true });

  console.log('PASS: furigana readings align over kanji runs, leave okurigana bare, refuse readings that do not fit, and modes resolve from older settings.');
} finally {
  await server.close();
}
