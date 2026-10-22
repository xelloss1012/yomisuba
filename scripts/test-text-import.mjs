import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

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
  const { decodeText, detectLanguage, isAozoraText, textToDocument, textToEpub } =
    await server.ssrLoadModule('/src/utils/textToEpub.ts');
  const { importFileAsEpub, isImportable } = await server.ssrLoadModule('/src/utils/importFile.ts');
  const labels = { textAuthor: 'Archivo de texto', htmlAuthor: 'Archivo HTML' };
  const bufferOf = (bytes) => new Uint8Array(bytes).buffer;
  const options = { author: 'Pasted text' };

  // --- Encodings --------------------------------------------------------------
  assert.equal(decodeText(new TextEncoder().encode('日本語のテキスト').buffer), '日本語のテキスト');
  assert.equal(decodeText(bufferOf([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('日本語')])), '日本語', 'UTF-8 BOM dropped');
  assert.equal(decodeText(bufferOf([0xff, 0xfe, 0xe5, 0x65, 0x2c, 0x67, 0x9e, 0x8a])), '日本語', 'UTF-16 LE');
  assert.equal(decodeText(bufferOf([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xa0])), '日本語あ', 'Shift_JIS');
  assert.equal(decodeText(bufferOf([0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec, 0xa4, 0xa2])), '日本語あ', 'EUC-JP');

  assert.equal(detectLanguage('吾輩は猫である。名前はまだ無い。'), 'ja');
  assert.equal(detectLanguage('Call me Ishmael. Some years ago, never mind how long precisely.'), 'und');
  assert.equal(isAozoraText('吾輩《わがはい》は猫《ねこ》である。名前《なまえ》はまだ無い。'), true, 'three rubies');
  assert.equal(isAozoraText('私は《ゲーム》を遊ぶ。'), false, 'a title in angle brackets is not ruby');

  // --- Plain text ------------------------------------------------------------
  {
    const doc = textToDocument('今日は天気がいい。\n\n散歩に出かけた。\n<b>&</b>', { ...options, fallbackTitle: 'メモ' });
    assert.equal(doc.title, 'メモ', 'a file name is the title when the text gives none');
    assert.equal(doc.author, 'Pasted text');
    assert.equal(doc.language, 'ja');
    assert.equal(doc.sections.length, 1);
    assert.ok(doc.sections[0].html.includes('<p>今日は天気がいい。</p>'));
    assert.ok(doc.sections[0].html.includes('<p class="blank"><br/></p>'), 'a blank line is a gap');
    assert.ok(doc.sections[0].html.includes('&lt;b&gt;&amp;&lt;/b&gt;'), 'markup is escaped');
    assert.equal(textToDocument('一行目はタイトル\n本文', options).title, '一行目はタイトル', 'first line when nothing else');
    assert.equal(textToDocument('本文', { ...options, title: '自分で付けた題' }).title, '自分で付けた題');
    assert.ok(textToDocument('あ'.repeat(100), options).title.length <= 40, 'a long first line is cut');
    assert.throws(() => textToDocument('  \n \n', options), /empty/);
  }

  // Chapters from headings, or from size.
  {
    const withHeadings = textToDocument('序章\n昔々あるところに。\n第一章\n王様がいました。\n第二章\n旅に出ました。', options);
    assert.deepEqual(withHeadings.sections.map((section) => section.title), ['序章', '第一章', '第二章']);
    assert.ok(withHeadings.sections[1].html.startsWith('<h2 class="chapter">第一章</h2>'));

    const long = Array.from({ length: 900 }, (_, index) => `${index}行目。${'あ'.repeat(40)}`).join('\n');
    const split = textToDocument(long, options);
    assert.ok(split.sections.length >= 2, 'a long text is cut into sections');
    assert.deepEqual(split.sections.map((section) => section.title).slice(1), split.sections.slice(1).map((_, index) => String(index + 2)));
    const lines = split.sections.map((section) => section.html).join('\n').match(/<p>/g).length;
    assert.equal(lines, 900, 'nothing is lost between sections');

    const oneHeading = textToDocument('第一章\n本文だけ。', options);
    assert.equal(oneHeading.sections.length, 1, 'a single heading does not make chapters');
  }

  // --- Aozora notation -------------------------------------------------------
  {
    const aozora = [
      '吾輩は猫である',
      '夏目漱石',
      '',
      '-------------------------------------------------------',
      '【テキスト中に現れる記号について】',
      '《》：ルビ',
      '［＃］：入力者注',
      '-------------------------------------------------------',
      '',
      '［＃大見出し］一［＃大見出し終わり］',
      '　吾輩《わがはい》は猫である。名前《なまえ》はまだ無い。',
      '｜どこ《ドコ》で生れたかとんと見当《けんとう》がつかぬ。［＃「見当」に傍点］',
      '見当［＃「見当」に傍点］は※［＃「てへん＋劣」、U+6318、7-1-7］んだ。',
      '［＃改ページ］',
      '二［＃「二」は大見出し］',
      '　二つ目。',
      '',
      '底本：「吾輩は猫である」岩波文庫',
      '　　　1990（平成2）年',
      '入力：誰か',
    ].join('\r\n');
    const doc = textToDocument(aozora, options);
    assert.equal(doc.title, '吾輩は猫である');
    assert.equal(doc.author, '夏目漱石');
    assert.equal(doc.language, 'ja');
    assert.deepEqual(doc.sections.map((section) => section.title), ['一', '二', '底本']);
    const all = doc.sections.map((section) => section.html).join('\n');
    assert.ok(all.includes('<ruby>吾輩<rt>わがはい</rt></ruby>は猫'), 'ruby on the kanji before the reading');
    assert.ok(all.includes('<ruby>名前<rt>なまえ</rt></ruby>'));
    assert.ok(all.includes('<ruby>どこ<rt>ドコ</rt></ruby>'), 'ruby with an explicit start mark');
    assert.ok(all.includes('<em class="sesame_dot">見当</em>'), 'emphasis dots');
    assert.ok(all.includes('挘'), 'a gaiji given as a code point');
    assert.ok(!/［＃|《|》/.test(all), 'no notation left');
    assert.ok(!all.includes('テキスト中に現れる記号'), 'the symbol explanation is dropped');
    assert.ok(!all.includes('<p>夏目漱石</p>'), 'title and author are not repeated in the text');
    assert.ok(doc.sections[2].html.includes('底本：「吾輩は猫である」岩波文庫'), 'the colophon is its own section');
  }

  // --- The EPUB --------------------------------------------------------------
  {
    const converted = await textToEpub('第一章\n吾輩《わがはい》は猫《ねこ》である。名前《なまえ》はまだ無い。\n第二章\n続き。', { ...options, title: '猫' });
    assert.equal(converted.title, '猫');
    assert.equal(converted.language, 'ja');
    const zip = await JSZip.loadAsync(await converted.blob.arrayBuffer());
    const names = Object.keys(zip.files);
    assert.equal(names[0], 'mimetype', 'mimetype first');
    assert.equal(await zip.file('mimetype').async('text'), 'application/epub+zip');
    for (const name of names.filter((entry) => /\.(xhtml|opf|ncx)$/.test(entry))) {
      const errors = [];
      new DOMParser({ onError: (level, message) => errors.push(message) }).parseFromString(await zip.file(name).async('text'), 'application/xml');
      assert.deepEqual(errors, [], `${name} is well-formed`);
    }
    const opf = await zip.file('OEBPS/content.opf').async('text');
    assert.match(opf, /<dc:title>猫<\/dc:title>/);
    assert.match(opf, /<dc:language>ja<\/dc:language>/);
    assert.match(opf, /page-progression-direction="rtl"/);
    for (const [, href] of opf.matchAll(/<item [^>]*href="([^"]+)"/g)) assert.ok(zip.file(`OEBPS/${href}`), `${href} is in the package`);
    assert.equal((opf.match(/<itemref /g) || []).length, 2);
    const nav = await zip.file('OEBPS/nav.xhtml').async('text');
    assert.ok(nav.includes('第一章') && nav.includes('第二章'));

    const english = await textToEpub('Call me Ishmael.\nSome years ago.', options);
    const englishOpf = await (await JSZip.loadAsync(await english.blob.arrayBuffer())).file('OEBPS/content.opf').async('text');
    assert.match(englishOpf, /<dc:language>und<\/dc:language>/);
    assert.ok(!/page-progression-direction/.test(englishOpf), 'horizontal text is not right-to-left');

    // The same text gives the same identifier; different text, a different one.
    const identifierOf = async (text) => (await (await JSZip.loadAsync(await (await textToEpub(text, options)).blob.arrayBuffer())).file('OEBPS/content.opf').async('text')).match(/<dc:identifier[^>]*>([^<]+)</)[1];
    assert.equal(await identifierOf('同じ本文'), await identifierOf('同じ本文'));
    assert.notEqual(await identifierOf('同じ本文'), await identifierOf('別の本文'));
  }

  // --- Files -----------------------------------------------------------------
  {
    assert.equal(isImportable(new File(['x'], 'a.epub')), true);
    assert.equal(isImportable(new File(['x'], 'a.TXT')), true);
    assert.equal(isImportable(new File(['x'], 'a.HTML')), true);
    assert.equal(isImportable(new File(['x'], 'a.htm')), true);
    assert.equal(isImportable(new File(['x'], 'a.pdf')), false);
    const epub = new File(['epub'], 'libro.epub', { type: 'application/epub+zip' });
    assert.equal(await importFileAsEpub(epub, labels), epub, 'an EPUB is left alone');
    const txt = new File([new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x0a, 0x82, 0xa0])], '日記.txt', { type: 'text/plain' });
    const imported = await importFileAsEpub(txt, labels);
    assert.equal(imported.name, '日記.epub');
    assert.equal(imported.type, 'application/epub+zip');
    const opf = await (await JSZip.loadAsync(await imported.arrayBuffer())).file('OEBPS/content.opf').async('text');
    assert.match(opf, /<dc:title>日記<\/dc:title>/);
    assert.match(opf, /<dc:creator>Archivo de texto<\/dc:creator>/);
  }

  console.log('PASS: pasted text and .txt files (UTF-8, Shift_JIS, EUC-JP, UTF-16) become valid EPUBs, with Aozora notation turned into furigana, headings and a colophon.');
} finally {
  await server.close();
}
