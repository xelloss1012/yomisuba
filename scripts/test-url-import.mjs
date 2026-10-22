import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import JSZip from 'jszip';
import { parseHTML } from 'linkedom';

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
  const { normalizeUrl, importUrlAsEpub, UrlImportError } = await server.ssrLoadModule('/src/utils/urlImport.ts');
  const parse = (html) => parseHTML(html).document;
  const labels = { fallbackAuthor: 'Web' };
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const bytes = (text) => new TextEncoder().encode(text);

  // A fake network: addresses to answers; anything else is a 404.
  const network = (pages) => {
    const asked = [];
    return {
      asked,
      port: {
        async get(url, { maxBytes }) {
          asked.push(url);
          const answer = pages[url];
          if (!answer) throw new UrlImportError('status', '404');
          if (answer.bytes.length > maxBytes) throw new UrlImportError('size');
          return { url: answer.finalUrl ?? url, status: 200, contentType: answer.type ?? '', bytes: answer.bytes };
        },
      },
    };
  };
  const catchCode = async (promise) => {
    try { await promise; } catch (error) { return error.code; }
    return 'no error';
  };
  const opfOf = async (file) => (await JSZip.loadAsync(await file.arrayBuffer())).file('OEBPS/content.opf').async('text');

  // --- Addresses ---------------------------------------------------------------
  assert.equal(normalizeUrl('example.com/a?b=1#frag'), 'https://example.com/a?b=1');
  assert.equal(normalizeUrl('  http://example.org/x  '), 'http://example.org/x');
  assert.equal(normalizeUrl('https://ja.wikipedia.org/wiki/猫'), 'https://ja.wikipedia.org/wiki/%E7%8C%AB');
  for (const bad of ['', '   ', 'a b.com', 'ftp://example.com/x', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'intranet', 'https://']) {
    assert.throws(() => normalizeUrl(bad), (error) => error.code === 'invalid', `${JSON.stringify(bad)} is refused`);
  }

  // --- A page with pictures -------------------------------------------------------
  {
    const body = '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。';
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>猫の話 | 例のサイト</title></head><body>
<article><h1>猫の話</h1><p>${body}</p><p><img src="figures/cat.png" alt="猫"></p><p>${body}</p>
<p><img src="https://cdn.example.net/photo.jpg" alt="写真"></p><p><img src="/missing.png" alt="無い"></p>
<p><img src="/huge.png" alt="大きい"></p><p>${body}</p><p>${body}</p></article></body></html>`;
    const net = network({
      'https://example.com/articles/cat.html': { bytes: bytes(html), type: 'text/html; charset=utf-8', finalUrl: 'https://example.com/articles/cat.html' },
      'https://example.com/articles/figures/cat.png': { bytes: PNG, type: 'image/png' },
      'https://cdn.example.net/photo.jpg': { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), type: '' },
      'https://example.com/huge.png': { bytes: new Uint8Array(1_500_000), type: 'image/png' },
    });
    const file = await importUrlAsEpub('example.com/articles/cat.html', labels, { port: net.port, parse });
    assert.equal(file.name, '猫の話.epub');
    assert.equal(file.type, 'application/epub+zip');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const opf = await zip.file('OEBPS/content.opf').async('text');
    assert.match(opf, /<dc:title>猫の話<\/dc:title>/);
    assert.match(opf, /<dc:creator>example\.com<\/dc:creator>/, 'the host when the page names nobody');
    assert.match(opf, /<dc:source>https:\/\/example\.com\/articles\/cat\.html<\/dc:source>/);
    assert.ok(zip.file('OEBPS/images/image1.png'), 'a relative picture is resolved against the page and kept');
    assert.ok(zip.file('OEBPS/images/image2.jpg'), 'a picture without a content type is recognised by its bytes');
    assert.equal(Object.keys(zip.files).filter((name) => name.startsWith('OEBPS/images/') && !name.endsWith('/')).length, 2, 'a missing and an oversized picture are left out');
    const section = await zip.file('OEBPS/section001.xhtml').async('text');
    assert.ok(section.includes('alt="猫"') && section.includes('無い') && section.includes('大きい'), 'what could not be had stays as its description');
    assert.ok(net.asked.includes('https://example.com/missing.png'));

    // The same address gives the same book: its identifier does not change.
    const again = await importUrlAsEpub('https://example.com/articles/cat.html', labels, { port: net.port, parse });
    assert.equal((await opfOf(again)).match(/<dc:identifier[^>]*>([^<]+)</)[1], opf.match(/<dc:identifier[^>]*>([^<]+)</)[1]);
  }

  // After a redirect, the pictures are looked for where the page ended up.
  {
    const body = '本文がここに入ります。'.repeat(30);
    const html = `<html><head><title>移転</title></head><body><p>${body}</p><p><img src="a.png"></p></body></html>`;
    const net = network({
      'https://old.example.com/p': { bytes: bytes(html), type: 'text/html', finalUrl: 'https://new.example.org/dir/p' },
      'https://new.example.org/dir/a.png': { bytes: PNG, type: 'image/png' },
    });
    const file = await importUrlAsEpub('https://old.example.com/p', labels, { port: net.port, parse });
    assert.ok((await JSZip.loadAsync(await file.arrayBuffer())).file('OEBPS/images/image1.png'));
    assert.match(await opfOf(file), /<dc:creator>old\.example\.com<\/dc:creator>/);
  }

  // --- Other kinds of address ------------------------------------------------------
  {
    const epubBytes = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]);
    const net = network({
      'https://example.com/books/neko.epub': { bytes: epubBytes, type: 'application/octet-stream' },
      'https://example.com/dl?id=3': { bytes: epubBytes, type: 'application/epub+zip' },
    });
    const byName = await importUrlAsEpub('https://example.com/books/neko.epub', labels, { port: net.port, parse });
    assert.equal(byName.name, 'neko.epub');
    assert.deepEqual([...new Uint8Array(await byName.arrayBuffer())], [...epubBytes], 'an EPUB is the file itself');
    const byType = await importUrlAsEpub('https://example.com/dl?id=3', labels, { port: net.port, parse });
    assert.equal(byType.name, 'dl.epub', 'named after the last part of the address');
  }
  {
    // text/plain in a legacy encoding, as the server says
    const sjis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xcc, 0x95, 0xb6, 0x8f, 0xcd]); // 日本語の文章
    const net = network({ 'https://example.com/memo.txt': { bytes: sjis, type: 'text/plain; charset=Shift_JIS' } });
    const file = await importUrlAsEpub('https://example.com/memo.txt', labels, { port: net.port, parse });
    assert.equal(file.name, 'memo.epub');
    const opf = await opfOf(file);
    assert.match(opf, /<dc:language>ja<\/dc:language>/);
    assert.match(opf, /<dc:source>https:\/\/example\.com\/memo\.txt<\/dc:source>/);
    const text = await (await JSZip.loadAsync(await file.arrayBuffer())).file('OEBPS/section001.xhtml').async('text');
    assert.ok(text.includes('日本語の文章'));
  }
  {
    // An HTML page in Shift_JIS declared only by the HTTP header
    const head = bytes('<html><head><title>');
    const sjis = [0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea];
    const page = new Uint8Array([...head, ...sjis, ...bytes('</title></head><body><p>'), ...sjis, ...bytes('のページ。</p></body></html>')]);
    const net = network({ 'https://example.jp/': { bytes: page, type: 'text/html; charset=Shift_JIS' } });
    assert.equal((await importUrlAsEpub('https://example.jp/', labels, { port: net.port, parse })).name, '日本語.epub');
  }

  // A plain http address is tried as https first, and as written when that cannot be had.
  {
    const html = '<html><head><title>古いサイト</title></head><body><p>' + '本文がここに入ります。'.repeat(30) + '</p></body></html>';
    const asked = [];
    const port = {
      async get(url) {
        asked.push(url);
        if (url.startsWith('https:')) throw new UrlImportError('failed', 'no TLS');
        return { url, status: 200, contentType: 'text/html', bytes: bytes(html) };
      },
    };
    const file = await importUrlAsEpub('http://old.example.com/page', labels, { port, parse });
    assert.equal(file.name, '古いサイト.epub');
    assert.deepEqual(asked, ['https://old.example.com/page', 'http://old.example.com/page']);
    // An error from the site itself is not retried.
    const failing = { async get(url) { asked.push(url); throw new UrlImportError('status', '404'); } };
    asked.length = 0;
    assert.equal(await catchCode(importUrlAsEpub('http://old.example.com/gone', labels, { port: failing, parse })), 'status');
    assert.equal(asked.length, 1);
  }

  // --- What cannot be read ---------------------------------------------------------
  {
    const net = network({
      'https://example.com/file.pdf': { bytes: bytes('%PDF-1.4'), type: 'application/pdf' },
      'https://example.com/app': { bytes: bytes('<html><head><title>App</title></head><body><div id="root"></div><script>render()</script></body></html>'), type: 'text/html' },
      'https://example.com/big': { bytes: new Uint8Array(10_000_001), type: 'text/html' },
    });
    assert.equal(await catchCode(importUrlAsEpub('https://example.com/file.pdf', labels, { port: net.port, parse })), 'type');
    assert.equal(await catchCode(importUrlAsEpub('https://example.com/app', labels, { port: net.port, parse })), 'empty', 'a page built by JavaScript has no text to read');
    assert.equal(await catchCode(importUrlAsEpub('https://example.com/big', labels, { port: net.port, parse })), 'size');
    assert.equal(await catchCode(importUrlAsEpub('https://example.com/none', labels, { port: net.port, parse })), 'status');
    assert.equal(await catchCode(importUrlAsEpub('not a url', labels, { port: net.port, parse })), 'invalid');
  }

  console.log('PASS: web addresses are checked, downloaded with their pictures within limits, and made into EPUBs (HTML, text in any charset, or the EPUB itself); failures are told apart.');
} finally {
  await server.close();
}
