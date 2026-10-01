import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
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
