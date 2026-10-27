import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { parseHTML } = require('linkedom');
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
  const { wrapVerticalText } = await server.ssrLoadModule('/src/utils/verticalText.ts');
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  const { document } = parseHTML(
    '<html><body><p>第12章!!」</p><p><span class="tate-chu-yoko">34</span></p></body></html>'
  );

  wrapVerticalText(document);

  assert.equal(document.querySelector('.vertical-number')?.textContent, '12');
  assert.equal(document.querySelector('.vertical-punctuation')?.textContent, '!!');
  assert.equal(document.querySelector('.tate-chu-yoko .vertical-number'), null);
  assert.equal(document.body.textContent, '第12章!!」34');

  wrapVerticalText(document);
  assert.equal(document.querySelectorAll('.vertical-number').length, 1);
  assert.equal(document.querySelectorAll('.vertical-punctuation').length, 1);

  console.log('PASS: western digits and punctuation stay upright without changing text content.');
} finally {
  await server.close();
}
