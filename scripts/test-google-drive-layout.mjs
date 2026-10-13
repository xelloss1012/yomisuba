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
  const { bookFolderName } = await server.ssrLoadModule('/src/utils/googleDriveBackup.ts');
  const identity = (title, creator = '') => ({ bookKey: `ereader_book_${encodeURIComponent(`${title}|${creator}`)}`, title, creator });

  // The folder is named after the real book title.
  assert.equal(bookFolderName(identity('走れメロス', 'Dazai Osamu')), '走れメロス');

  // Characters forbidden by Drive are stripped from the folder name.
  const cleaned = bookFolderName(identity('A/B: C*?<>|"End"', 'x'));
  assert.ok(!/[\\/:*?"<>|]/.test(cleaned), `unexpected forbidden char in: ${cleaned}`);
  assert.ok(cleaned.startsWith('A B C'));

  // Leading/trailing dots are removed and long titles are capped.
  const dotted = bookFolderName(identity('...Novela...', 'x'));
  assert.equal(dotted, 'Novela');
  const long = bookFolderName(identity('x'.repeat(400), 'x'));
  assert.ok(long.length <= 120);

  // Falls back to the creator, then to a generic name, when the title is blank.
  assert.equal(bookFolderName(identity('   ', 'Gabriel García Márquez')), 'Gabriel García Márquez');
  assert.equal(bookFolderName(identity('   ', '  ')), 'Libro sin título');

  console.log('PASS: per-book Drive folder names are sanitized and deterministic.');
} finally {
  await server.close();
}
