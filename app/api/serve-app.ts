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
const ROOT_FILES: Record<string, { type: string; cacheControl: string; binary?: true }> = {
  '/manifest.webmanifest': {
    type: 'application/manifest+json; charset=utf-8',
    cacheControl: 'public, max-age=3600',
  },
  '/icon.svg': {
    type: 'image/svg+xml; charset=utf-8',
    cacheControl: 'public, max-age=3600',
  },
  // The raster icons a desk and a phone ask for (docs/SPEC/desktop-install.md).
  // `binary`, because reading a PNG as utf8 does not fail — it corrupts,
  // silently, and the icon simply does not render.
  '/icon-192.png': { type: 'image/png', cacheControl: 'public, max-age=3600', binary: true },
  '/icon-512.png': { type: 'image/png', cacheControl: 'public, max-age=3600', binary: true },
  '/icon-512-maskable.png': {
    type: 'image/png',
    cacheControl: 'public, max-age=3600',
    binary: true,
  },
  '/apple-touch-icon.png': {
    type: 'image/png',
    cacheControl: 'public, max-age=3600',
    binary: true,
  },
  // Revalidated on every load: this is the file that decides what the app does
  // offline, so a stale copy is the one thing that cannot be allowed to stick.
  '/sw.js': { type: 'text/javascript; charset=utf-8', cacheControl: 'no-cache' },
};

const HEAD_OPEN = /<head(\s[^>]*)?>/i;

/** Nothing a policy of ours contains needs escaping; escaped all the same. */
const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The document's own copy of its content security policy, and the nonce on
 * every tag that loads a script.
 *
 * **Why the policy is in the document.** In production the header does not
 * reach a browser: Hostinger's origin replaces `Content-Security-Policy` with
 * `upgrade-insecure-requests` on every answer this app produces, while every
 * other protective header — including the per-document `Referrer-Policy` —
 * arrives untouched (docs/SPEC/hosting.md section 2.3, docs/SECURITY.md item
 * 2). A browser enforces a `<meta>` policy as it enforces a header, and
 * enforces both when both arrive, so the header is still sent and nothing
 * here weakens it: the day the edge passes ours through, this becomes
 * redundant rather than wrong. The policy is the **first** child of `<head>`,
 * because a policy that arrives after a script does not govern that script,
 * and it is the same object the header was built from
 * (./_middleware/security.ts), never a second policy.
 *
 * `frame-ancestors` is not in it: a meta policy ignores that directive, which
 * is the specification and not a bug. Framing is refused by
 * `X-Frame-Options: DENY`, which does reach the browser.
 *
 * **The nonce** is for the one document whose policy needs it
 * (docs/SPEC/route-planning.md section 8.2). `'strict-dynamic'` ignores
 * `'self'` and every host for scripts, so the shell's own tags are trusted by
 * their nonce and everything they load is trusted onwards.
 *
 * The empty `<style nonce>` is not decoration: Google's Maps JavaScript API
 * copies the nonce off the first style element it finds and puts it on the
 * styles it injects, and the built page has stylesheet links and no style
 * element of its own.
 */
function stamp(html: string, nonce: string | undefined, policy: string | undefined): string {
  let out = html;
  if (policy !== undefined) {
    out = out.replace(
      HEAD_OPEN,
      (head) =>
        `${head}<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}" />`,
    );
  }
  if (nonce !== undefined) {
    out = out
      .replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`)
      .replace(/<link rel="modulepreload"/g, `<link rel="modulepreload" nonce="${nonce}"`)
      .replace('</head>', `<style nonce="${nonce}"></style></head>`);
  }
  return out;
}

/** Not a policy anything would honour: it exists to be looked for. */
const BOOT_PROBE = 'boot-check';

/**
 * The boot check, and it asserts the outcome rather than the precondition.
 *
 * In production the document is the only place the policy reaches a browser,
 * so a shell the stamping cannot reach is a shell served with no policy at
 * all — and that has to fail the deploy rather than the visitor, quietly.
 * Asking merely whether the file contains a `<head>` would not do it: a
 * comment carrying the word satisfies that and still takes the meta with it.
 * So the shell is stamped once, here, and the result is read — the policy is
 * in the document, it is not inside a comment, and no script stands in front
 * of it, because a policy that arrives after a script does not govern that
 * script (the review of pull request 129, finding F1).
 */
function assertThePolicyLands(html: string): void {
  const stamped = stamp(html, undefined, BOOT_PROBE);
  const policy = stamped.indexOf(`content="${BOOT_PROBE}"`);
  if (policy === -1) {
    throw new Error(
      'the built shell has nowhere the content security policy can be stamped: no reachable <head>',
    );
  }
  // An unclosed comment ahead of it is a policy a parser never sees.
  const before = stamped.slice(0, policy);
  if (before.lastIndexOf('<!--') > before.lastIndexOf('-->')) {
    throw new Error(
      'the built shell put the content security policy inside a comment, where no browser reads it',
    );
  }
  const script = stamped.indexOf('<script');
  if (script !== -1 && script < policy) {
    throw new Error(
      'the built shell puts a script before the content security policy, which would not govern it',
    );
  }
}

export function mountApp(api: Hono<ApiEnv>, root = 'dist'): void {
  const index = readFileSync(join(root, 'index.html'), 'utf8');
  assertThePolicyLands(index);
  for (const [path, { type, cacheControl, binary }] of Object.entries(ROOT_FILES)) {
    api.get(path, (c) => {
      let body: string | ArrayBuffer;
      try {
        if (binary) {
          const bytes = readFileSync(join(root, path.slice(1)));
          body = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
        } else {
          body = readFileSync(join(root, path.slice(1)), 'utf8');
        }
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
    return c.html(stamp(index, c.get('cspNonce'), c.get('cspDocumentPolicy')));
  });
}
