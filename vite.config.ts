import { loadEnv } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { plugins, resolve } from './vite.shared';

export default defineConfig(({ mode }) => {
  // Ports are settings, not constants, so several worktrees can run side by side
  // (docs/PARALLEL-SESSIONS.md). The empty prefix reads every key, not only VITE_*.
  const env = loadEnv(mode, process.cwd(), '');
  const webPort = Number(env.WEB_PORT || 5173);
  const apiPort = Number(env.PORT || 3000);

  return {
    plugins,
    resolve,
    server: {
      port: webPort,
      strictPort: true,
      proxy: {
        // The Hono API (app/api/server.ts) listens on this worktree's own port.
        '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      },
    },
    // Nothing is inlined as a data: URI: the content security policy allows only the app's own files.
    build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
    test: {
      environment: 'node',
      // Database tests live under tests/db and run through vitest.db.config.ts.
      exclude: [...configDefaults.exclude, 'tests/db/**'],
    },
  };
});
