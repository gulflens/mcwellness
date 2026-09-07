import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ApiEnv } from './_middleware/request-context';

/**
 * In staging and production the API serves the built app itself, so one
 * process answers everything and the protective headers cover the screens as
 * well as the data. Hashed assets are immutable; a missing asset is a 404,
 * never the page; the page itself is never cached, so a deploy is seen at
 * once. Any other path gets the page, and the app's router takes it from there.
 *
 * Three files sit at the build's root rather than under `/assets`, and each
 * needs its own answer (docs/CHANGE-REQUESTS/session-capture-04.md item 5):
 * the manifest and the icon, which are content-typed and may be cached like
 * any asset, and the worker itself — which is served `no-cache`, because a
 * worker a browser holds on to is a worker that cannot be replaced, and a
 * deploy that cannot replace its own worker is a deploy nobody sees.
 */
const ROOT_FILES: Record<string, { type: string; cacheControl: string }> = {
  '/manifest.webmanifest': {
    type: 'application/manifest+json; charset=utf-8',
    cacheControl: 'public, max-age=3600',
  },
  '/icon.svg': {
    type: 'image/svg+xml; charset=utf-8',
    cacheControl: 'public, max-age=3600',
  },
  // Revalidated on every load: this is the file that decides what the app does
  // offline, so a stale copy is the one thing that cannot be allowed to stick.
  '/sw.js': { type: 'text/javascript; charset=utf-8', cacheControl: 'no-cache' },
};

/**
 * The nonce on every tag that loads a script, for the one document whose
 * policy needs it (docs/SPEC/route-planning.md section 8.2). `'strict-dynamic'`
 * ignores `'self'` and every host for scripts, so the shell's own tags are
 * trusted by their nonce and everything they load is trusted onwards.
 *
 * The empty `<style nonce>` is not decoration: Google's Maps JavaScript API
 * copies the nonce off the first style element it finds and puts it on the
 * styles it injects, and the built page has stylesheet links and no style
 * element of its own.
 */
function stamp(html: string, nonce: string): string {
  return html
    .replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`)
    .replace(/<link rel="modulepreload"/g, `<link rel="modulepreload" nonce="${nonce}"`)
    .replace('</head>', `<style nonce="${nonce}"></style></head>`);
}

export function mountApp(api: Hono<ApiEnv>, root = 'dist'): void {
  const index = readFileSync(join(root, 'index.html'), 'utf8');
  for (const [path, { type, cacheControl }] of Object.entries(ROOT_FILES)) {
    api.get(path, (c) => {
      let body: string;
      try {
        body = readFileSync(join(root, path.slice(1)), 'utf8');
      } catch {
        // A build without one of these is a build with no worker rather than a
        // build that will not serve: the app still works online.
        return c.json({ error: 'not_found', requestId: null }, 404);
      }
      c.header('Content-Type', type);
      c.header('Cache-Control', cacheControl);
      return c.body(body);
    });
  }
  api.use(
    '/assets/*',
    async (c, next) => {
      await next();
      const type = c.res.headers.get('content-type') ?? '';
      if (c.res.ok && !type.startsWith('text/html')) {
        c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
    serveStatic({ root }),
  );
  api.get('/assets/*', (c) => c.json({ error: 'not_found', requestId: null }, 404));
  api.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    c.header('Cache-Control', 'no-store');
    const nonce = c.get('cspNonce');
    return c.html(nonce === undefined ? index : stamp(index, nonce));
  });
}
