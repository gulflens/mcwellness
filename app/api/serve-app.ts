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
    return c.html(index);
  });
}
