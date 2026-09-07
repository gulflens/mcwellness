import { describe, expect, it } from 'vitest';
import { createApi } from '../../app/api/create-api';

// No database is touched: the pool refuses to connect, and every request stops before it.
const deps = {
  pool: {
    connect: async () => {
      throw new Error('no database in this test');
    },
  },
  verifier: { verify: async () => null },
  keyOf: () => 'test',
};

describe('protective headers', () => {
  it('sends the content security policy and the other protections on every answer, including refusals', async () => {
    const api = createApi(deps);
    for (const res of [
      await api.request('/api/health'),
      await api.request('/api/me'),
      await api.request('/nothing'),
    ]) {
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      // The images directive exactly, because this is the one the second round
      // widened: `blob:` beside `data:`, and nothing else. The app fetches the
      // day's picture and the last sensor placement itself, through `apiFetch`
      // with its bearer header, and shows them from revocable object URLs; a
      // `blob:` URL can be created only by this app's own scripts, so nothing
      // third-party is admitted (docs/SPEC/practitioner-phone.md section 3.6).
      expect(csp.split(';').map((directive) => directive.trim())).toContain(
        "img-src 'self' data: blob:",
      );
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(res.headers.get('permissions-policy')).toContain('camera=()');
      expect(res.headers.get('permissions-policy')).toContain('microphone=()');
      // The app's own origin may ask for location (check-in, enrolment); no
      // embedded third party may.
      expect(res.headers.get('permissions-policy')).toContain('geolocation=(self)');
      expect(res.headers.get('x-powered-by')).toBeNull();
      expect(res.headers.get('server')).toBeNull();
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('never caches an API answer', async () => {
    const api = createApi(deps);
    expect((await api.request('/api/health')).headers.get('cache-control')).toBe('no-store');
    expect((await api.request('/api/me')).headers.get('cache-control')).toBe('no-store');
  });

  it('pins HTTPS in production only, where it exists', async () => {
    expect(
      (await createApi({ ...deps, appEnv: 'production' }).request('/api/health')).headers.get(
        'strict-transport-security',
      ),
    ).toBe('max-age=31536000; includeSubDomains');
    expect(
      (await createApi({ ...deps, appEnv: 'development' }).request('/api/health')).headers.get(
        'strict-transport-security',
      ),
    ).toBeNull();
  });

  it('grants nothing to another origin, on a plain request and on a preflight', async () => {
    const api = createApi(deps);
    const plain = await api.request('/api/health', {
      headers: { origin: 'https://evil.example.com' },
    });
    expect(plain.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await api.request('/api/me', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'GET' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(preflight.headers.get('access-control-allow-methods')).toBeNull();
  });

  it('answers an unknown path in the fixed refusal shape', async () => {
    const api = createApi(deps);
    const res = await api.request('/nothing-here');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found', requestId: null });
    const unauthenticated = await api.request('/api/nothing-here');
    expect(unauthenticated.status).toBe(401);
  });
});

describe('the policy and the sign-in project', () => {
  it('names the Supabase origin as the one outside connection, and nothing when none is configured', async () => {
    const withProject = await createApi({
      ...deps,
      supabaseUrl: 'https://abcdefghij.supabase.co/',
    }).request('/api/health');
    expect(withProject.headers.get('content-security-policy')).toContain(
      "connect-src 'self' https://abcdefghij.supabase.co",
    );
    const without = await createApi(deps).request('/api/health');
    expect(without.headers.get('content-security-policy')).toContain("connect-src 'self';");
    const broken = await createApi({ ...deps, supabaseUrl: 'not a url' }).request('/api/health');
    expect(broken.headers.get('content-security-policy')).toContain("connect-src 'self';");
  });
});

describe('the day map document, and only it', () => {
  const withMap = { ...deps, mapDocumentPaths: ['/admin/schedule/map'] };

  it('carries the wider policy Google needs, with a nonce, on that one path', async () => {
    const res = await createApi(withMap).request('/admin/schedule/map');
    const csp = res.headers.get('content-security-policy') ?? '';
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
    expect(nonce, csp).toBeTruthy();
    const directives = csp.split(';').map((d) => d.trim());
    expect(directives).toContain(
      `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-eval' blob:`,
    );
    expect(directives).toContain(`style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`);
    expect(directives).toContain('frame-src *.google.com');
    expect(directives).toContain("worker-src 'self' blob:");
    expect(csp).toContain('https://*.googleapis.com');
    // The protections that never move.
    expect(directives).toContain("frame-ancestors 'none'");
    expect(directives).toContain("object-src 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    // The key is restricted by referrer, and Google refuses a request with none.
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('mints a new nonce for every response', async () => {
    const api = createApi(withMap);
    const first = (await api.request('/admin/schedule/map')).headers.get('content-security-policy');
    const second = (await api.request('/admin/schedule/map')).headers.get(
      'content-security-policy',
    );
    expect(first).not.toBe(second);
  });

  it('leaves every other document, and every API answer, exactly as they were', async () => {
    const api = createApi(withMap);
    for (const path of ['/admin/schedule', '/admin/clients', '/today', '/api/health', '/nothing']) {
      const csp = (await api.request(path)).headers.get('content-security-policy') ?? '';
      expect(csp, path).toContain("script-src 'self'");
      expect(csp, path).not.toContain('googleapis');
      expect(csp, path).not.toContain('unsafe-eval');
      expect((await api.request(path)).headers.get('referrer-policy'), path).toBe('no-referrer');
    }
  });

  it('is the strict policy again when no map path is configured', async () => {
    const csp = (await createApi(deps).request('/admin/schedule/map')).headers.get(
      'content-security-policy',
    );
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('widens nothing for a POST to that path', async () => {
    const csp = (
      await createApi(withMap).request('/admin/schedule/map', { method: 'POST' })
    ).headers.get('content-security-policy');
    expect(csp).toContain("script-src 'self'");
  });
});
