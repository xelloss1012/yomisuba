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
  const { sharedAddress, sharedToBook } = await server.ssrLoadModule('/src/utils/sharedContent.ts');
  const labels = { textAuthor: 'Archivo de texto', htmlAuthor: 'Archivo HTML', fallbackAuthor: 'Archivo HTML', pastedAuthor: 'Texto pegado' };

  // --- An address among what was shared ---------------------------------------------
  assert.equal(sharedAddress('https://example.com/a'), 'https://example.com/a');
  assert.equal(sharedAddress('  https://example.com/a\n'), 'https://example.com/a');
  assert.equal(sharedAddress('吾輩は猫である\nhttps://example.com/a'), 'https://example.com/a', 'a title before the address');
  assert.equal(sharedAddress('吾輩は猫である'), null);
  assert.equal(sharedAddress('mira https://example.com/a y más'), null, 'an address inside a sentence is text');
  assert.equal(sharedAddress('a\nb\nc\nhttps://example.com'), null, 'a long text is text');

  // --- Text and files become books ----------------------------------------------------
  const text = await sharedToBook({ text: '吾輩は猫である。名前はまだ無い。' }, labels);
  assert.ok(text.name.endsWith('.epub'));
  assert.equal(text.type, 'application/epub+zip');
  const titled = await sharedToBook({ text: '吾輩は猫である。', title: '猫' }, labels);
  assert.equal(titled.name, '猫.epub', 'the subject is the title');
  const bytes = Buffer.from('吾輩は猫である。名前はまだ無い。', 'utf8').toString('base64');
  const file = await sharedToBook({ data: bytes, fileName: '猫.txt', mimeType: 'text/plain' }, labels);
  assert.ok(file.name.endsWith('.epub'));
  await assert.rejects(sharedToBook({ data: bytes, fileName: 'a.png', mimeType: 'image/png' }, labels), /unsupported/);
  await assert.rejects(sharedToBook({ text: '   ' }, labels), /empty/);

  console.log('PASS: shared text, addresses and files become books; other files and empty text are refused.');
} finally {
  await server.close();
}
