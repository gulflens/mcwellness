import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import base from './vite.config';

// pnpm test:db — the tests under tests/db need a real database (DATABASE_URL),
// so they are outside pnpm verify, which must pass with Docker stopped.
// Files run one at a time because they share one database.

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  plugins: base.plugins,
  resolve: base.resolve,
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
