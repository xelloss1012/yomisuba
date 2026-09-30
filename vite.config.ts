import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  assetsInclude: ['**/*.gz', '**/*.gz?inline'],
  server: {
    host: true, // Permite acceder desde el móvil en la misma red WiFi
    port: 3000,
  },
});
