// Checks the library repository: every EPUB opens, its XML is well formed, the
// manifest matches its files and the catalog agrees with the files on disk.
//
//   node scripts/check-library.mjs <library-dir>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';

const libraryDir = resolve(process.argv[2] || '');
const catalog = JSON.parse(readFileSync(join(libraryDir, 'catalog.json'), 'utf8'));
const GENRES = ['fantasy', 'scifi', 'mystery', 'horror', 'romance', 'historical', 'humor', 'drama', 'children'];
const problems = [];
const errors = [];

const parseXml = (text, name) => {
  const doc = new DOMParser({
    onError: (level, message) => { if (level !== 'warning') errors.push(`${name}: ${message}`); },
  }).parseFromString(text, 'application/xhtml+xml');
  return doc;
};

assert.equal(catalog.schema, 1);
const slugs = new Set();
for (const book of catalog.books) {
  assert(!slugs.has(book.slug), `${book.slug} is listed twice`);
  slugs.add(book.slug);
  for (const key of ['id', 'title', 'author', 'file', 'cover', 'bytes', 'sha256', 'characters', 'pages', 'level', 'source', 'license', 'credits']) {
    assert(book[key] !== undefined && book[key] !== '', `${book.slug}: missing ${key}`);
  }
  assert(book.genres.length > 0 && book.genres.every((genre) => GENRES.includes(genre)), `${book.slug}: bad genres`);
  for (const lang of ['ja', 'es', 'en']) assert(book.description[lang], `${book.slug}: no ${lang} description`);
  assert(book.level.score >= 1 && book.level.score <= 5, `${book.slug}: bad difficulty`);
  assert(book.license.id === 'public-domain' && Number(book.license.authorDied.slice(0, 4)) <= 1945, `${book.slug}: license`);

  const epubPath = join(libraryDir, book.file);
  assert(existsSync(epubPath), `${book.slug}: ${book.file} is missing`);
  assert(existsSync(join(libraryDir, book.cover)), `${book.slug}: ${book.cover} is missing`);
  const data = readFileSync(epubPath);
  assert.equal(data.length, book.bytes, `${book.slug}: size differs from the catalog`);
  assert.equal(createHash('sha256').update(data).digest('hex'), book.sha256, `${book.slug}: checksum differs from the catalog`);

  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files);
  assert.equal(names[0], 'mimetype', `${book.slug}: mimetype must be the first entry`);
  assert.equal(await zip.file('mimetype').async('string'), 'application/epub+zip');
  const container = parseXml(await zip.file('META-INF/container.xml').async('string'), `${book.slug}/container.xml`);
  const opfPath = container.getElementsByTagName('rootfile')[0].getAttribute('full-path');
  const opf = parseXml(await zip.file(opfPath).async('string'), `${book.slug}/${opfPath}`);
  const base = posix.dirname(opfPath);
  const manifest = new Map();
  for (const item of Array.from(opf.getElementsByTagName('item'))) {
    manifest.set(item.getAttribute('id'), item);
    const path = posix.join(base, item.getAttribute('href'));
    assert(zip.file(path), `${book.slug}: ${path} is in the manifest but not in the file`);
    if (/xhtml|xml/.test(item.getAttribute('media-type'))) parseXml(await zip.file(path).async('string'), `${book.slug}/${path}`);
  }
  for (const ref of Array.from(opf.getElementsByTagName('itemref'))) {
    assert(manifest.has(ref.getAttribute('idref')), `${book.slug}: spine item ${ref.getAttribute('idref')} is not in the manifest`);
  }
  // Every image a page uses has to be inside the book.
  for (const item of manifest.values()) {
    if (item.getAttribute('media-type') !== 'application/xhtml+xml') continue;
    const page = await zip.file(posix.join(base, item.getAttribute('href'))).async('string');
    for (const [, src] of page.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)) {
      if (!zip.file(posix.join(base, src))) problems.push(`${book.slug}: ${item.getAttribute('href')} uses ${src}, which is not in the book`);
    }
  }
  assert(opf.getElementsByTagName('dc:title')[0].textContent.length > 0);
}

assert.deepEqual(errors, [], `XML errors:\n${errors.slice(0, 10).join('\n')}`);
assert.deepEqual(problems, [], problems.join('\n'));
console.log(`PASS: ${catalog.books.length} books: files, checksums, XML, manifests and images agree with the catalog.`);
