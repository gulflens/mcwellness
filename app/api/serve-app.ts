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
 */
export function mountApp(api: Hono<ApiEnv>, root = 'dist'): void {
  const index = readFileSync(join(root, 'index.html'), 'utf8');
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
