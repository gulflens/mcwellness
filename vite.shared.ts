import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** What every config shares: the React plugin, the worker and the import aliases. */

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const plugins = [
  react(),
  /**
   * The practitioner app is installable and opens with no signal
   * (docs/SPEC/practitioner-phone.md section 3.2, decision 1).
   *
   * `injectManifest`, not `generateSW`: the worker's rules are ours and live
   * in app/shell/sw.ts, and the plugin's whole job here is to write the
   * build's own hashed asset list into it. A runtime cache would hold only
   * what was opened while online, so a chunk or a font subset never fetched
   * online would be missing in the lift; a precache holds the build by
   * construction.
   *
   * `injectRegister: null` because app/shell/main.tsx registers it itself,
   * after first render and only in a production build, so a worker caching the
   * shell never fights the dev server. `devOptions` is left off for the same
   * reason.
   *
   * The manifest is a file of our own in public/, not generated here: it is
   * one JSON object, it carries the two colours copied from the design tokens,
   * and it says so in a comment beside them.
   */
  VitePWA({
    strategies: 'injectManifest',
    srcDir: 'app/shell',
    filename: 'sw.ts',
    injectRegister: null,
    manifest: false,
    injectManifest: {
      // The fonts are the reason the precache matters: an Arabic subset never
      // fetched online is a screen with no Arabic in it, in a basement.
      globPatterns: ['**/*.{js,css,html,woff2,svg}'],
    },
  }),
];

export const resolve = {
  alias: {
    // Mirrors "paths" in tsconfig.json. Change both together.
    '@domain': here('./domain'),
    '@app': here('./app'),
  },
};
