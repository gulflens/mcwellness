import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApi } from '../../app/api/create-api';
import { mountApp } from '../../app/api/serve-app';

const deps = {
  pool: {
    connect: async () => {
      throw new Error('no database in this test');
    },
  },
  verifier: { verify: async () => null },
  keyOf: () => 'test',
  appEnv: 'production',
};

function build(): string {
  const root = mkdtempSync(join(tmpdir(), 'mcw-dist-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><head><title>McWellness</title>' +
      '<link rel="modulepreload" href="/assets/app-abc123.js">' +
      '<script type="module" crossorigin src="/assets/app-abc123.js"></script>' +
      '</head><body><div id="root"></div></body></html>',
  );
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(1)');
  return root;
}

describe('serving the built app', () => {
  it('serves the page for any app path, never cached, with the protective headers', async () => {
    const api = createApi(deps);
    mountApp(api, build());
    for (const path of ['/', '/admin/clients', '/sign-in']) {
      const res = await api.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
      expect(res.headers.get('strict-transport-security')).toContain('max-age=');
      expect(await res.text()).toContain('id="root"');
    }
  });

  it('serves hashed assets as immutable, and a missing asset as a refusal, never the page', async () => {
    const api = createApi(deps);
    mountApp(api, build());
    const asset = await api.request('/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    for (const path of ['/assets/', '/assets/missing.js', '/assets/..%2findex.html']) {
      const res = await api.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('cache-control') ?? '', path).not.toContain('immutable');
    }
  });

  it('keeps unknown API paths as API refusals, not the page', async () => {
    const api = createApi(deps);
    mountApp(api, build());
    const res = await api.request('/api/nothing');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('stamps the shell with the map document’s own nonce, and leaves every other page unstamped', async () => {
    const api = createApi({ ...deps, mapDocumentPaths: ['/admin/schedule/map'] });
    mountApp(api, build());
    const res = await api.request('/admin/schedule/map');
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(
      res.headers.get('content-security-policy') ?? '',
    )?.[1];
    const html = await res.text();
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script nonce="${nonce}"`);
    expect(html).toContain(`<link rel="modulepreload" nonce="${nonce}"`);
    // Google's API copies the nonce off the first style element it finds, so
    // the document carries one for it to find.
    expect(html).toContain(`<style nonce="${nonce}"></style>`);
    const plain = await (await api.request('/admin/clients')).text();
    expect(plain).not.toContain('nonce=');
  });
});

/** The policy a document actually carries, read back out of its `<head>`. */
function documentPolicy(html: string): string | null {
  const found = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\s*\/?>/.exec(html);
  if (found === null) return null;
  return (found[1] ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const directivesOf = (policy: string): string[] =>
  policy
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean);

/**
 * The header does not reach a browser in production: Hostinger's origin
 * replaces `Content-Security-Policy` with `upgrade-insecure-requests` on
 * every answer the app produces (docs/SPEC/hosting.md section 2.3). So the
 * document carries the policy too, and these tests hold the two renderings to
 * one policy.
 */
describe('the policy the document carries', () => {
  const withMap = { ...deps, mapDocumentPaths: ['/admin/schedule/map'] };

  it('puts the strict policy first in the head of every ordinary document', async () => {
    const api = createApi(withMap);
    mountApp(api, build());
    for (const path of ['/', '/admin/clients', '/sign-in', '/nothing-here']) {
      const html = await (await api.request(path)).text();
      // First child of <head>: a policy that arrives after a script does not
      // govern that script.
      expect(html, path).toMatch(/<head[^>]*>\s*<meta http-equiv="Content-Security-Policy"/);
      const directives = directivesOf(documentPolicy(html) ?? '');
      expect(directives, path).toContain("script-src 'self'");
      expect(directives, path).toContain("object-src 'none'");
      expect(directives, path).toContain("base-uri 'self'");
      expect(directives, path).toContain("img-src 'self' data: blob:");
      expect(directives.join('; '), path).not.toContain('unsafe-eval');
    }
  });

  it('gives the day map its own meta, with the nonce its header was minted with', async () => {
    const api = createApi(withMap);
    mountApp(api, build());
    const res = await api.request('/admin/schedule/map');
    const header = res.headers.get('content-security-policy') ?? '';
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(header)?.[1];
    expect(nonce, header).toBeTruthy();
    const html = await res.text();
    expect(html).toMatch(/<head[^>]*>\s*<meta http-equiv="Content-Security-Policy"/);
    const meta = documentPolicy(html) ?? '';
    expect(meta).toContain(`'nonce-${nonce}'`);
    expect(directivesOf(meta)).toContain('frame-src *.google.com');
    expect(directivesOf(meta)).toContain("worker-src 'self' blob:");
    // Directive for directive, the header without the one a meta cannot carry.
    expect(directivesOf(header).filter((d) => !d.startsWith('frame-ancestors'))).toEqual(
      directivesOf(meta),
    );
  });

  it('omits frame-ancestors from the meta, which ignores it, and keeps it in the header', async () => {
    const api = createApi(withMap);
    mountApp(api, build());
    for (const path of ['/admin/clients', '/admin/schedule/map']) {
      const res = await api.request(path);
      expect(res.headers.get('content-security-policy'), path).toContain("frame-ancestors 'none'");
      expect(documentPolicy(await res.text()) ?? '', path).not.toContain('frame-ancestors');
      // What actually refuses the frame, and it does reach the browser.
      expect(res.headers.get('x-frame-options'), path).toBe('DENY');
    }
  });

  it('carries no meta on an API answer, which is not a document', async () => {
    const api = createApi(withMap);
    mountApp(api, build());
    const res = await api.request('/api/health');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(documentPolicy(await res.text())).toBeNull();
  });

  it('renders one policy two ways, and nothing about the input can make them disagree', async () => {
    const root = build();
    for (const supabaseUrl of [undefined, 'https://abcdefghij.supabase.co/', 'not a url']) {
      const api = createApi({ ...withMap, supabaseUrl });
      mountApp(api, root);
      for (const path of ['/', '/admin/clients', '/admin/schedule/map']) {
        const where = `${String(supabaseUrl)} ${path}`;
        const res = await api.request(path);
        const header = directivesOf(res.headers.get('content-security-policy') ?? '');
        const meta = directivesOf(documentPolicy(await res.text()) ?? '');
        expect(header.length, where).toBeGreaterThan(1);
        expect(
          header.some((directive) => directive.startsWith('frame-ancestors')),
          where,
        ).toBe(true);
        expect(
          header.filter((directive) => !directive.startsWith('frame-ancestors')),
          where,
        ).toEqual(meta);
      }
    }
  });
});
