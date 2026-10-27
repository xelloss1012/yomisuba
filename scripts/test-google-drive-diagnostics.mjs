import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
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
  const { describeGoogleDriveAuthError } = await server.ssrLoadModule('/src/utils/googleDriveDiagnostics.ts');
  const safe = describeGoogleDriveAuthError(new Error(
    'Rejected for user@example.com, bearer ya29.private, eyJhbGci.signature.payload; app-123.apps.googleusercontent.com'
  ));
  assert.match(safe, /redacted-email/);
  assert.equal((safe.match(/redacted-token/g) || []).length, 1);
  assert.match(safe, /Bearer \[redacted\]/);
  assert.match(safe, /redacted-client-id/);
  assert.doesNotMatch(safe, /user@example\.com|ya29\.private|eyJhbGci|app-123\.apps/);
  assert.match(describeGoogleDriveAuthError({ code: 'USER_CANCELLED', message: 'Cancelled' }), /USER_CANCELLED/);
  console.log('PASS: Google sign-in diagnostics preserve error codes and redact sensitive values.');
} finally {
  await server.close();
}
