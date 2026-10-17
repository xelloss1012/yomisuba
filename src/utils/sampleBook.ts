import JSZip from 'jszip';

export async function createSampleJapaneseEpub(): Promise<Blob> {
  const zip = new JSZip();

  // mimetype (must be first, uncompressed in standard EPUB)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // META-INF/container.xml
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  // SVG sample illustration
  const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 850" width="600" height="850">
  <rect width="600" height="850" fill="#2d3748"/>
  <rect x="20" y="20" width="560" height="810" fill="none" stroke="#e2e8f0" stroke-width="4"/>
  <circle cx="300" cy="350" r="160" fill="#e53e3e" opacity="0.85"/>
  <path d="M150,650 Q300,500 450,650" fill="none" stroke="#edf2f7" stroke-width="8"/>
  <text x="300" y="320" font-family="'Noto Serif JP', serif" font-size="52" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="8">走れメロス</text>
  <text x="300" y="390" font-family="'Noto Serif JP', serif" font-size="28" fill="#f7fafc" text-anchor="middle">太宰 治</text>
  <text x="300" y="740" font-family="'Noto Sans JP', sans-serif" font-size="20" fill="#a0aec0" text-anchor="middle">Vertical Japanese EPUB Reader Sample</text>
</svg>`;

  zip.file('OEBPS/images/cover.svg', coverSvg);

  // Stylesheet
  const css = `@charset "UTF-8";
html {
  writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
  font-family: "Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif;
  text-orientation: upright;
  line-height: 1.9;
  letter-spacing: 0.08em;
}
body {
  margin: 0;
  padding: 1rem;
}
h1 {
  font-size: 1.8rem;
  margin-left: 2rem;
  font-weight: 700;
  border-right: 3px solid #b91c1c;
  padding-right: 0.5rem;
}
h2 {
  font-size: 1.4rem;
  margin-left: 1.5rem;
}
p {
  margin-left: 0.8rem;
  text-indent: 1em;
}
ruby {
  font-family: inherit;
}
rt {
  font-size: 0.55em;
  color: #718096;
}
.tate-chu-yoko {
  text-combine-upright: all;
  -webkit-text-combine: horizontal;
}
.illustration {
  text-align: center;
  margin: 1.5rem 0;
}
.illustration img, .illustration svg {
  max-width: 80%;
  max-height: 70vh;
  border-radius: 8px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}
.author {
  text-align: left;
  font-size: 1.1rem;
  margin-bottom: 2rem;
  color: #4a5568;
}
`;
  zip.file('OEBPS/styles/style.css', css);

  // Chapter 1: Cover & Intro
  const ch1 = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
<head>
  <title>走れメロス - 表紙</title>
  <link rel="stylesheet" type="text/css" href="styles/style.css"/>
</head>
<body>
  <div class="illustration">
    <img src="images/cover.svg" alt="走れメロス 表紙" style="max-height: 80vh;"/>
  </div>
</body>
</html>`;
  zip.file('OEBPS/ch1.xhtml', ch1);

  // Chapter 2: Run Melos
  const ch2 = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
<head>
  <title>走れメロス - 本文</title>
  <link rel="stylesheet" type="text/css" href="styles/style.css"/>
</head>
<body>
  <h1>走れメロス</h1>
  <div class="author">太宰 治</div>

  <p>メロスは<ruby>激怒<rt>げきど</rt></ruby>した。必ず、かの<ruby>邪智暴虐<rt>じゃちぼうぎゃく</rt></ruby>の王を<ruby>除<rt>のぞ</rt></ruby>かなければならぬと決意した。メロスには政治がわからぬ。メロスは、村の<ruby>牧人<rt>まきびと</rt></ruby>である。笛を吹き、羊と遊んで暮して来た。けれども<ruby>邪悪<rt>じゃあく</rt></ruby>に対しては、人一倍に敏感であった。</p>

  <p>きょう未明メロスは村を出発し、野を越え山越え、<span class="tate-chu-yoko">10</span>里はなれた此のシラクスの市にやって来た。メロスには父も、母も無い。女房も無い。<span class="tate-chu-yoko">16</span>の、内気な妹と二人暮しだ。この妹は、村の或る律気な一牧人を、近々、花婿として迎えることになっていた。結婚式も間近かなのである。メロスは、それゆえ、花嫁の衣裳やら祝宴の御馳走やらを買いに、はるばる市にやって来たのだ。</p>

  <p>品々を買いまわり、日の暮れる頃、メロスはシラクスの町を歩きながら、ふと町の様子が異様に淋しいのに気がついた。日も暮れて町が暗いのは当り前だが、それにしても、なんだか夜の雰囲気が重苦しく、ひっそりとして怪しかった。</p>

  <p>「町に何か異変があったのか？」メロスは行き逢った若い衆を捕えて尋ねた。若い衆は首を振って答えなかった。しばらく歩いて老爺に逢い、こんどはもっと語勢を強めて質問した。老爺は答えなかった。メロスは両手で老爺の体を揺すぶって問いつめた。</p>

  <p>老爺は、あたりをはばかる低声で、わずか答えた。「王様は、人を殺します。」</p>

  <p>「なぜ殺すのだ。」</p>

  <p>「悪心を抱いている、というのですが、誰もそんな、悪心を持っては居りませぬ。」</p>

  <p>「たくさんの人を殺したのか。」</p>

  <p>「はい、はじめは王様の妹婿さまを。それから、御自身のお世継を。それから、妹さまを。それから、皇后さまを。それから、賢臣の<ruby>アレキス<rt>あれきす</rt></ruby>様を。」</p>
</body>
</html>`;
  zip.file('OEBPS/ch2.xhtml', ch2);

  // Chapter 3: Resolution
  const ch3 = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
<head>
  <title>走れメロス - 終章</title>
  <link rel="stylesheet" type="text/css" href="styles/style.css"/>
</head>
<body>
  <h2>友情と信頼</h2>

  <p>「走れ！メロス。」</p>
  
  <p>メロスは自分を叱咤した。濁流を泳ぎ切り、山賊を倒し、炎天下の街道を泥のように疲れ果てながらも、友<ruby>セリヌンティウス<rt>せりぬんてぃうす</rt></ruby>との約束のために走り続けた。</p>

  <p>陽はすでに西に沈みかけている。シラクスの処刑場には、十字架にかけられようとしている友の姿があった。</p>

  <p>「待て！その人を殺してはならぬ。メロスが帰って来た！」</p>

  <p>群衆はどよめいた。刑場になだれ込んだメロスは友の足もとにすがりつき、泣いた。「私を殴れ。私は途中で一度だけ、悪い夢を見た。」セリヌンティウスは頷き、メロスを力いっぱい殴った。「メロス、私を殴れ。私も一度だけ、君を疑った。」二人は抱き合い、号泣した。</p>

  <p>暴君ディオニスは二人を見つめ、静かに呟いた。「お前らの望みは叶ったぞ。真実とは、決して空虚な妄想ではなかった。どうか、わしをも仲間に入れてくれまいか。」</p>

  <p>群衆から歓声が湧き起こった。夕陽が紅く、シラクスの城を染めていた。</p>
</body>
</html>`;
  zip.file('OEBPS/ch3.xhtml', ch3);

  // OEBPS/toc.ncx
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:sample-melos-001"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>走れメロス</text>
  </docTitle>
  <docAuthor>
    <text>太宰 治</text>
  </docAuthor>
  <navMap>
    <navPoint id="navPoint-1" playOrder="1">
      <navLabel><text>表紙</text></navLabel>
      <content src="ch1.xhtml"/>
    </navPoint>
    <navPoint id="navPoint-2" playOrder="2">
      <navLabel><text>走れメロス (本文)</text></navLabel>
      <content src="ch2.xhtml"/>
    </navPoint>
    <navPoint id="navPoint-3" playOrder="3">
      <navLabel><text>友情と信頼 (終章)</text></navLabel>
      <content src="ch3.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;
  zip.file('OEBPS/toc.ncx', ncx);

  // OEBPS/nav.xhtml (EPUB 3 Nav)
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
<head>
  <title>目次</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目次</h1>
    <ol>
      <li><a href="ch1.xhtml">表紙</a></li>
      <li><a href="ch2.xhtml">走れメロス (本文)</a></li>
      <li><a href="ch3.xhtml">友情と信頼 (終章)</a></li>
    </ol>
  </nav>
</body>
</html>`;
  zip.file('OEBPS/nav.xhtml', nav);

  // OEBPS/content.opf
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0" prefix="rendition: http://www.idpf.org/vocab/rendition/#" xml:lang="ja">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:sample-melos-001</dc:identifier>
    <dc:title>走れメロス</dc:title>
    <dc:creator>太宰 治</dc:creator>
    <dc:language>ja</dc:language>
    <dc:publisher>青空文庫 / Yomisuba Sample</dc:publisher>
    <dc:description>太宰治の代表作『走れメロス』。縦書き日本語表示とルビ表示のサンプルEPUBです。</dc:description>
    <meta property="dcterms:modified">2026-09-20T00:00:00Z</meta>
    <meta property="page-progression-direction">rtl</meta>
  </metadata>
  <manifest>
    <item id="toc" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="styles/style.css" media-type="text/css"/>
    <item id="cover-img" href="images/cover.svg" media-type="image/svg+xml" properties="cover-image"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine page-progression-direction="rtl" toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', opf);

  return await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}
