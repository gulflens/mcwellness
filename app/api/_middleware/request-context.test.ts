import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it, vi } from 'vitest';
import type { AuthClaims, TokenVerifier } from './token-verifier';
import {
  withRequestContext,
  type ApiEnv,
  type PoolClientLike,
  type PoolLike,
} from './request-context';

const SUB = '00000000-0000-4000-8000-0000000000aa';
const USER = '00000000-0000-4000-8000-0000000000a1';
const TENANT = '00000000-0000-4000-8000-00000000000a';

const verifier: TokenVerifier = {
  async verify(token): Promise<AuthClaims | null> {
    return token === 'good' ? { sub: SUB, role: 'authenticated' } : null;
  },
};

/** A pool whose one client records every statement and answers the resolver from a script. */
function fakePool(resolved: Record<string, unknown> | null) {
  const statements: string[] = [];
  const params: unknown[][] = [];
  const released: unknown[] = [];
  const client: PoolClientLike = {
    async query(text: string, values?: unknown[]) {
      statements.push(text);
      params.push(values ?? []);
      const rows = text.includes('app.resolve_actor') && resolved ? [resolved] : [];
      return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
    },
    release(destroy) {
      released.push(destroy ?? 'clean');
    },
  };
  const pool: PoolLike & { connections: number } = {
    connections: 0,
    async connect() {
      pool.connections += 1;
      return client;
    },
  };
  return { pool, statements, params, released };
}

const ownerRow = {
  user_id: USER,
  tenant_id: TENANT,
  status: 'active',
  roles: ['owner'],
  capabilities: [],
};

function app(pool: PoolLike, handler: (c: never) => Response | Promise<Response>) {
  return new Hono<ApiEnv>()
    .use('*', withRequestContext({ pool, verifier }))
    .get('/probe', handler as never);
}

describe('withRequestContext', () => {
  it('answers 401 without touching the pool when there is no token or a bad one', async () => {
    const fake = fakePool(ownerRow);
    const probe = app(fake.pool, (c: { json: (b: unknown) => Response }) => c.json({}));
    const none = await probe.request('/probe');
    const bad = await probe.request('/probe', { headers: { authorization: 'Bearer nope' } });
    expect(none.status).toBe(401);
    expect(none.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect(bad.status).toBe(401);
    expect(fake.pool.connections).toBe(0);
  });

  it('runs the request inside one fenced, stamped transaction and commits it', async () => {
    const fake = fakePool(ownerRow);
    const probe = app(
      fake.pool,
      (c: { get: (k: string) => unknown; json: (b: unknown) => Response }) =>
        c.json({ actor: c.get('actor') }),
    );
    const res = await probe.request('/probe', {
      headers: {
        authorization: 'Bearer good',
        'x-request-id': '00000000-0000-4000-8000-0000000000ee',
        'x-reason': 'looking something up',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toBe('00000000-0000-4000-8000-0000000000ee');
    expect(await res.json()).toEqual({
      actor: { userId: USER, tenantId: TENANT, roles: ['owner'], capabilities: [] },
    });
    expect(fake.statements.map((s) => s.split(' ').slice(0, 3).join(' '))).toEqual([
      'begin',
      'set local role',
      'select user_id, tenant_id,',
      "select set_config('app.tenant_id', $1,",
      'select 1',
      'commit',
    ]);
    expect(fake.params[2]).toEqual([SUB]);
    expect(fake.params[3]).toEqual([
      TENANT,
      USER,
      'owner',
      '00000000-0000-4000-8000-0000000000ee',
      'looking something up',
    ]);
    expect(fake.released).toEqual(['clean']);
  });

  it('answers 403 and rolls back when the person is unknown or inactive', async () => {
    const fake = fakePool(null);
    const probe = app(fake.pool, (c: { json: (b: unknown) => Response }) => c.json({}));
    const res = await probe.request('/probe', { headers: { authorization: 'Bearer good' } });
    expect(res.status).toBe(403);
    expect(fake.statements.at(-1)).toBe('rollback');
    expect(fake.released).toEqual(['clean']);
  });

  it('rolls back and discards the connection when the route throws', async () => {
    const fake = fakePool(ownerRow);
    const probe = new Hono<ApiEnv>()
      .onError((_error, c) => c.json({ error: 'internal' }, 500))
      .use('*', withRequestContext({ pool: fake.pool, verifier }))
      .get('/probe', () => {
        throw new Error('boom');
      });
    const res = await probe.request('/probe', { headers: { authorization: 'Bearer good' } });
    expect(res.status).toBe(500);
    expect(fake.statements.at(-1)).toBe('rollback');
    expect(fake.released).toEqual(['clean']);
  });

  it('generates a request id when the incoming one is not a uuid', async () => {
    const fake = fakePool(ownerRow);
    const probe = app(fake.pool, (c: { json: (b: unknown) => Response }) => c.json({}));
    const res = await probe.request('/probe', {
      headers: { authorization: 'Bearer good', 'x-request-id': 'not-a-uuid' },
    });
    expect(res.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('X-Request-Id')).not.toBe('not-a-uuid');
  });
});

/**
 * The after-commit hook (docs/CHANGE-REQUESTS/client-record-03.md CR-12,
 * docs/SEAMS.md). It runs when — and only when — the transaction committed,
 * in registration order, and a piece that throws takes nothing with it.
 */
describe('afterCommit', () => {
  type Ctx = {
    get: (k: string) => (work: () => void | Promise<void>) => void;
    json: (b: unknown) => Response;
  };

  /** A route that registers `work`, then answers plainly. */
  function registering(work: readonly (() => void | Promise<void>)[]) {
    const fake = fakePool(ownerRow);
    const probe = app(fake.pool, (c: Ctx) => {
      for (const piece of work) {
        c.get('afterCommit')(piece);
      }
      return c.json({ ok: true });
    });
    return { fake, probe };
  }

  const signedIn = { headers: { authorization: 'Bearer good' } };

  it('runs the work after a committed request, in the order it was registered', async () => {
    const order: string[] = [];
    const { fake, probe } = registering([
      () => {
        order.push('first');
      },
      async () => {
        await Promise.resolve();
        order.push('second');
      },
      () => {
        order.push('third');
      },
    ]);
    const res = await probe.request('/probe', signedIn);
    expect(res.status).toBe(200);
    expect(fake.statements.at(-1)).toBe('commit');
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('runs nothing when the transaction rolled back under a 4xx the route raised', async () => {
    const ran = vi.fn();
    const fake = fakePool(ownerRow);
    const probe = new Hono<ApiEnv>()
      .use('*', withRequestContext({ pool: fake.pool, verifier }))
      .get('/probe', (c) => {
        c.get('afterCommit')(ran);
        throw new HTTPException(409, { message: 'already filed' });
      });
    const res = await probe.request('/probe', signedIn);
    expect(res.status).toBe(409);
    expect(fake.statements.at(-1)).toBe('rollback');
    expect(ran).not.toHaveBeenCalled();
  });

  it('runs nothing when the route throws and the request answers 500', async () => {
    const ran = vi.fn();
    const fake = fakePool(ownerRow);
    const probe = new Hono<ApiEnv>()
      .onError((_error, c) => c.json({ error: 'internal' }, 500))
      .use('*', withRequestContext({ pool: fake.pool, verifier }))
      .get('/probe', (c) => {
        c.get('afterCommit')(ran);
        throw new Error('boom');
      });
    const res = await probe.request('/probe', signedIn);
    expect(res.status).toBe(500);
    expect(fake.statements.at(-1)).toBe('rollback');
    expect(ran).not.toHaveBeenCalled();
  });

  it('lets a throwing piece pass without touching the response or the pieces around it', async () => {
    const before = vi.fn();
    const after = vi.fn();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { probe } = registering([
      before,
      () => {
        throw new Error('the store was unreachable');
      },
      after,
    ]);
    const res = await probe.request('/probe', {
      headers: { ...signedIn.headers, 'x-request-id': '00000000-0000-4000-8000-0000000000ee' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    // The request id names the failure; the message never reaches the log.
    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      requestId: '00000000-0000-4000-8000-0000000000ee',
      after: 'commit',
      name: 'Error',
    });
    expect(line).not.toContain('unreachable');
    logged.mockRestore();
  });
});

describe('scrubReason', () => {
  it('replaces a pasted token or key and leaves an ordinary reason alone', async () => {
    const { scrubReason } = await import('./request-context');
    expect(scrubReason('Asked by the parent at the door.')).toBe(
      'Asked by the parent at the door.',
    );
    const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
    expect(scrubReason(`see ${FAKE_JWT} then`)).toBe('see [redacted] then');
    expect(scrubReason('key 0123456789abcdef0123456789abcdef0123456789abcdef here')).toBe(
      'key [redacted] here',
    );
  });
});
