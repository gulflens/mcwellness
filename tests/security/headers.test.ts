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
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(res.headers.get('permissions-policy')).toContain('camera=()');
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
