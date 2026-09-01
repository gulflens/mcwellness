import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirrors "paths" in tsconfig.json. Change both together.
      '@domain': here('./domain'),
      '@app': here('./app'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // The Hono API (app/api/server.ts) listens on 127.0.0.1:3000.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node' },
});
