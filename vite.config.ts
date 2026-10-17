import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  // The version the app reports and compares with the latest release.
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: [
      // kuromoji needs path.join in the browser (see src/shims/path.ts).
      { find: /^path$/, replacement: fileURLToPath(new URL('./src/shims/path.ts', import.meta.url)) },
    ],
  },
  assetsInclude: ['**/*.gz', '**/*.gz?inline'],
  server: {
    host: true, // Permite acceder desde el móvil en la misma red WiFi
    port: 3000,
  },
});
