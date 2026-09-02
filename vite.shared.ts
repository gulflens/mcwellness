import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

/** What every config shares: the React plugin and the import aliases. */

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const plugins = [react()];

export const resolve = {
  alias: {
    // Mirrors "paths" in tsconfig.json. Change both together.
    '@domain': here('./domain'),
    '@app': here('./app'),
  },
};
