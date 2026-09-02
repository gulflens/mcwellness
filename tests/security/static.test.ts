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
    '<!doctype html><title>McWellness</title><div id="root"></div>',
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

  it('serves hashed assets as immutable and lists no directory', async () => {
    const api = createApi(deps);
    mountApp(api, build());
    const asset = await api.request('/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const listing = await api.request('/assets/');
    expect(listing.status).toBe(200);
    expect(await listing.text()).toContain('id="root"');
  });

  it('keeps unknown API paths as API refusals, not the page', async () => {
    const api = createApi(deps);
    mountApp(api, build());
    const res = await api.request('/api/nothing');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
