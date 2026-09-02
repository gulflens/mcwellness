import { describe, expect, it } from 'vitest';
import { createApi } from './create-api';
import type { PoolLike } from './_middleware/request-context';
import type { TokenVerifier } from './_middleware/token-verifier';

const untouchedPool: PoolLike = {
  async connect() {
    throw new Error('the pool must not be touched');
  },
};
const rejectingVerifier: TokenVerifier = {
  async verify() {
    return null;
  },
};

const api = createApi({ pool: untouchedPool, verifier: rejectingVerifier });

describe('the API', () => {
  it('answers the health check without a token, a socket or a database', async () => {
    const response = await api.request('/api/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'mcwellness-api' });
  });

  it('refuses everything else without a valid token, before any route is looked at', async () => {
    const me = await api.request('/api/me');
    const unknown = await api.request('/api/clients', {
      headers: { authorization: 'Bearer nope' },
    });

    expect(me.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(me.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await me.json()).toEqual({
      error: 'unauthorized',
      requestId: me.headers.get('X-Request-Id'),
    });
  });
});
