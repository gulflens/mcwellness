import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from './create-api';
import type { PoolClientLike, PoolLike } from './_middleware/request-context';
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

/**
 * A pool whose connections answer nothing (docs/SPEC/hosting.md section 7.2).
 * The message is deliberately the sort a driver writes — it names a host and a
 * port — so that the test below proves none of it reaches the caller.
 */
function refusingPool(where: 'connect' | 'query'): PoolLike {
  const refusal = new Error('connect ECONNREFUSED 10.0.0.7:5432');
  refusal.name = 'AggregateError';
  return {
    async connect(): Promise<PoolClientLike> {
      if (where === 'connect') throw refusal;
      return {
        async query() {
          throw refusal;
        },
        release() {},
      };
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

const api = createApi({ pool: untouchedPool, verifier: rejectingVerifier });

describe('the API', () => {
  it('answers the health check without a token, a socket or a database', async () => {
    const response = await api.request('/api/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'mcwellness-api' });
  });

  // The shallow route is what the deploy step and the uptime monitor call, so
  // its answer is a promise to the outside world: this pins it, and any change
  // to it has to be a deliberate one made here (docs/SPEC/hosting.md 7.1).
  it('keeps the health check free of anything that says which deployment this is', async () => {
    const body = await (await api.request('/api/health')).text();

    expect(body).toBe('{"ok":true,"service":"mcwellness-api"}');
  });

  it('answers the deep health check not-ok when the pool refuses a connection', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deep = createApi({ pool: refusingPool('connect'), verifier: rejectingVerifier });

    const response = await deep.request('/api/health/deep');

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"ok":false}');
    // One line on this process's stderr, in the shape every other failure
    // writes, and even there it is the class and never the message.
    expect(stderr).toHaveBeenCalledTimes(1);
    const line = String(stderr.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      requestId: null,
      route: '/api/health/deep',
      status: 503,
      name: 'AggregateError',
    });
    expect(line).not.toContain('ECONNREFUSED');
  });

  it('answers the deep health check not-ok when the query fails, and says no more', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deep = createApi({ pool: refusingPool('query'), verifier: rejectingVerifier });

    const response = await deep.request('/api/health/deep');
    const body = await response.text();

    expect(response.status).toBe(503);
    // No error text, no version, no host, no service name: not-ok and nothing else.
    expect(body).toBe('{"ok":false}');
    expect(body).not.toContain('10.0.0.7');
    expect(body).not.toContain('mcwellness');
  });

  it('answers the deep health check without a token, like its neighbour', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Ahead of the fence: an unauthenticated caller gets the health answer,
    // never the 401 every other route gives.
    expect((await api.request('/api/health/deep')).status).toBe(503);
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
