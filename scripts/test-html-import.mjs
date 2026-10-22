import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import JSZip from 'jszip';
import { DOMParser as XmlParser } from '@xmldom/xmldom';
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
  const { htmlToDocument, htmlToEpub, decodeHtml } = await server.ssrLoadModule('/src/utils/htmlToEpub.ts');
  const { decodeText } = await server.ssrLoadModule('/src/utils/textToEpub.ts');
  const parse = (html) => parseHTML(html).document;
  const options = { author: 'Archivo HTML', parse };
  const all = (doc) => doc.sections.map((section) => section.html).join('\n');

  // --- A page of Aozora Bunko: ruby and text kept exactly -----------------------
  {
    const html = `<?xml version="1.0" encoding="Shift_JIS"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja"><head><title>夏目漱石 吾輩は猫である</title></head><body>
<div class="metadata"><h1 class="title">吾輩は猫である</h1><h2 class="author">夏目漱石</h2></div>
<div id="contents"><div class="main_text"><br />
<h3 class="o-midashi" id="midashi10">一</h3>
<br />
<div class="jisage_1" style="margin-left: 1em">　<ruby><rb>吾輩</rb><rp>（</rp><rt>わがはい</rt><rp>）</rp></ruby>は猫である。<ruby><rb>名前</rb><rp>（</rp><rt>なまえ</rt><rp>）</rp></ruby>はまだ無い。<br />
　どこで生れたかとんと<em class="sesame_dot">見当</em>がつかぬ。<img src="../../gaiji/1-84/1-84-77.png" alt="※(「てへん＋劣」、第3水準1-84-77)" class="gaiji" /><br />
</div>
<br />
<h3 class="o-midashi" id="midashi20">二</h3>
<br />
　二つ目の章。<br />
</div><div class="bibliographical_information"><hr />底本：「吾輩は猫である」岩波文庫<br />入力：誰か</div></div>
<div class="notation_notes">●表記について</div></body></html>`;
    const doc = htmlToDocument(html, options);
    assert.equal(doc.title, '吾輩は猫である');
    assert.equal(doc.author, '夏目漱石');
    assert.equal(doc.language, 'ja');
    assert.deepEqual(doc.sections.map((section) => section.title), ['一', '二']);
    const text = all(doc);
    assert.ok(text.includes('<ruby><rb>吾輩</rb><rp>（</rp><rt>わがはい</rt><rp>）</rp></ruby>は猫である。'), 'ruby kept as it is');
    assert.ok(text.includes('<em class="sesame_dot">見当</em>'), 'emphasis dots kept');
    assert.ok(text.includes('※(「てへん＋劣」、第3水準1-84-77)'), 'a picture that is not in the file gives its description');
    assert.ok(!text.includes('<img'), 'no remote image left');
    assert.ok(!text.includes('底本') && !text.includes('表記について'), 'credits and notes are not part of the text');
    assert.ok(!text.includes('style='), 'no attributes');
    assert.ok(text.includes('<p>　二つ目の章。</p>'), 'a line ended by <br> is a paragraph');
  }

  // --- An article saved from the web ---------------------------------------------
  {
    const paragraph = '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。';
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>猫の話 | 例のサイト</title>
<meta name="author" content="山田太郎"><style>p{color:red}</style><script>alert(1)</script></head><body>
<nav><a href="/">ホーム</a> <a href="/about">概要</a></nav>
<header><div>例のサイト</div></header>
<article><h1>猫の話</h1>
<p onclick="steal()">${paragraph}<a href="javascript:evil()">リンク</a><span style="color:red">強調</span></p>
<p>${paragraph}<img src="x" onerror="alert(1)"></p>
<p>${paragraph}</p><p>${paragraph}</p>
<form><input name="q"><button>送信</button></form>
<iframe src="https://example.com"></iframe></article>
<footer>© 例のサイト</footer><script>track()</script></body></html>`;
    const doc = htmlToDocument(html, options);
    assert.equal(doc.title, '猫の話', 'the heading, not the page title with the site name');
    assert.equal(doc.author, '山田太郎');
    assert.equal(doc.language, 'ja');
    const text = all(doc);
    assert.ok(text.includes('吾輩は猫である。'));
    for (const forbidden of ['<script', 'alert(', 'onclick', 'onerror', 'javascript:', '<iframe', '<form', '<input', '<button', 'style=', 'href=', 'ホーム', '© 例のサイト']) {
      assert.ok(!text.includes(forbidden), `${forbidden} is not in the text`);
    }
    assert.ok(text.includes('リンク') && text.includes('強調'), 'what is inside links and spans stays');
    assert.ok(!text.includes('<h2 class="chapter">猫の話</h2>'), 'the title is not repeated');
  }

  // --- A small page without an article --------------------------------------------
  {
    const doc = htmlToDocument('<html><head><title>メモ</title></head><body><nav>メニュー</nav><p>短い文章です。</p><footer>脚注</footer></body></html>', options);
    assert.equal(doc.title, 'メモ');
    const text = all(doc);
    assert.ok(text.includes('短い文章です。'));
    assert.ok(!text.includes('メニュー') && !text.includes('脚注'), 'menus and footers are left out');
    assert.equal(doc.author, 'Archivo HTML', 'the label when the page names nobody');
    assert.throws(() => htmlToDocument('<html><body><script>x()</script></body></html>', options), /no text/);
  }

  // --- Chapters from headings -----------------------------------------------------
  {
    const body = '本文がここに入ります。'.repeat(30);
    const doc = htmlToDocument(`<html><head><title>長い話</title></head><body><h1>長い話</h1><h2>第一章</h2><p>${body}</p><h3>節</h3><p>${body}</p><h2>第二章</h2><p>${body}</p><h2>第三章</h2><p>${body}</p></body></html>`, options);
    assert.deepEqual(doc.sections.map((section) => section.title), ['第一章', '第二章', '第三章']);
    assert.ok(doc.sections[0].html.includes('節'), 'a lower heading stays in its chapter');
  }

  // --- Images inside the file ------------------------------------------------------
  {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const body = '本文がここに入ります。'.repeat(30);
    const html = `<html><head><title>絵</title></head><body><p>${body}</p><p><img src="data:image/png;base64,${png}" alt="挿絵"></p><p>${body}</p></body></html>`;
    const doc = htmlToDocument(html, options);
    assert.equal(doc.images.length, 1);
    assert.equal(doc.images[0].mediaType, 'image/png');
    assert.ok(doc.images[0].data.length > 20);
    assert.ok(all(doc).includes('<img src="images/image1.png" alt="挿絵"/>'));

    const converted = await htmlToEpub(html, options);
    const zip = await JSZip.loadAsync(await converted.blob.arrayBuffer());
    assert.equal(Object.keys(zip.files)[0], 'mimetype');
    assert.ok(zip.file('OEBPS/images/image1.png'), 'the image is in the package');
    const opf = await zip.file('OEBPS/content.opf').async('text');
    assert.match(opf, /href="images\/image1\.png" media-type="image\/png"/);
    for (const name of Object.keys(zip.files).filter((entry) => /\.(xhtml|opf|ncx)$/.test(entry))) {
      const errors = [];
      new XmlParser({ onError: (level, message) => errors.push(message) }).parseFromString(await zip.file(name).async('text'), 'application/xml');
      assert.deepEqual(errors, [], `${name} is well-formed`);
    }
  }

  // --- Languages and line breaks ---------------------------------------------------
  {
    const english = htmlToDocument('<html lang="en"><head><title>Hello</title></head><body><p>Call me Ishmael. Some years ago, never mind how long precisely.</p></body></html>', options);
    assert.equal(english.language, 'en');
    const guessed = htmlToDocument('<html><head><title>x</title></head><body><p>日本語の文章です。</p></body></html>', options);
    assert.equal(guessed.language, 'ja', 'no declared language: read from the text');
    const lines = htmlToDocument('<html><body><p>日本\n語の文章\nと English\nwords</p></body></html>', options);
    const text = all(lines);
    assert.ok(text.includes('日本語の文章と English words'), 'a line break between Japanese characters disappears; between words it is a space');
  }

  // --- The bytes: the page says which encoding it uses ------------------------------
  {
    const head = new TextEncoder().encode('<html><head><meta charset="Shift_JIS"><title>');
    const tail = new TextEncoder().encode('</title></head><body><p>');
    const sjis = [0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]; // 日本語
    const bytes = new Uint8Array([...head, ...sjis, ...tail, ...sjis, ...new TextEncoder().encode('</p></body></html>')]);
    const decoded = decodeHtml(bytes.buffer, decodeText);
    assert.ok(decoded.includes('<title>日本語</title>'), 'declared Shift_JIS');
    const utf8 = new TextEncoder().encode('<html><head><meta charset="utf-8"></head><body>日本語</body></html>');
    assert.ok(decodeHtml(utf8.buffer, decodeText).includes('日本語'));
    const unknown = new Uint8Array([...new TextEncoder().encode('<html><head><meta charset="x-nonsense"></head><body>'), 0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]);
    assert.ok(decodeHtml(unknown.buffer, decodeText).includes('日本語'), 'an unknown declaration falls back to guessing');
  }

  console.log('PASS: HTML pages become clean EPUBs (article extraction, no scripts or attributes, furigana and images kept, chapters from headings, charset honoured).');
} finally {
  await server.close();
}
