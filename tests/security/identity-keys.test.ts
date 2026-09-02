import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { withIdentityKeys } from '../../app/api/_middleware/identity-context';
import type { ApiEnv } from '../../app/api/_middleware/request-context';
import type { IdentityKeys } from '../../domain/shared/identity';

/**
 * create-api.ts mounts withIdentityKeys on /api/* only when it is given
 * identityKeys, and only after withRequestContext (app/api/create-api.ts) —
 * so no route ahead of authentication can ever read c.get('identityKeys'),
 * and every route that can is already inside one database transaction as the
 * signed-in actor. A route added straight to createApi()'s own instance
 * cannot prove this in isolation, since every /api/* route past that same
 * fence would need a working verifier and a database to reach; this
 * exercises the middleware exactly as create-api.ts wires it, on a plain Hono
 * app of the app's own ApiEnv shape, the way rate-limit.test.ts proves
 * rateLimit.
 */

const keys: IdentityKeys = {
  hashKey: Buffer.alloc(32, 0xab),
  sealKey: Buffer.alloc(32, 0xcd),
};

function probe(app: Hono<ApiEnv>): void {
  app.get('/', (c) => {
    const found = c.get('identityKeys');
    return c.json({ hashKeyHex: found?.hashKey.toString('hex') ?? null });
  });
}

describe('withIdentityKeys', () => {
  it("a route sees c.get('identityKeys') once the middleware is mounted", async () => {
    const app = new Hono<ApiEnv>();
    app.use('*', withIdentityKeys(keys));
    probe(app);

    const response = await app.request('/');

    expect(await response.json()).toEqual({ hashKeyHex: keys.hashKey.toString('hex') });
  });

  it('is undefined on a route below no such middleware, the way create-api.ts leaves it when it is given no identityKeys', async () => {
    const app = new Hono<ApiEnv>();
    probe(app);

    const response = await app.request('/');

    expect(await response.json()).toEqual({ hashKeyHex: null });
  });
});
