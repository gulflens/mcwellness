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
