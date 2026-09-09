import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApi } from '../../app/api/create-api';
import {
  addressKey,
  limitsFromEnv,
  rateLimit,
  MAX_KEYS,
  SlidingWindow,
} from '../../app/api/_middleware/rate-limit';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

describe('SlidingWindow', () => {
  it('counts hits inside the window and lets them fall out', () => {
    const w = new SlidingWindow(1000, 2);
    expect(w.hit('a', 0)).toBe(1);
    expect(w.hit('a', 500)).toBe(2);
    expect(w.isLimited('a', 900)).toBe(true);
    expect(w.retryAfterMs('a', 900)).toBe(100);
    expect(w.isLimited('a', 1001)).toBe(false);
    expect(w.count('a', 1600)).toBe(0);
    expect(w.size).toBe(0);
  });

  it('refuses a new key once the map is full, even after a sweep', () => {
    const w = new SlidingWindow(60_000, 5);
    for (let i = 0; i < MAX_KEYS; i++) w.hit(`k${i}`, 1000);
    expect(w.full('another', 1001)).toBe(true);
    expect(w.full('k1', 1001)).toBe(false);
    expect(w.full('another', 70_000)).toBe(false);
  });

  it('sweeps keys that have gone quiet', () => {
    const w = new SlidingWindow(1000, 5);
    w.hit('a', 0);
    w.hit('b', 0);
    w.hit('b', 900);
    expect(w.sweep(1500)).toBe(1);
    expect(w.size).toBe(1);
  });
});

describe('rateLimit middleware', () => {
  it('answers 429 with a wait once the budget is spent, per key', async () => {
    const c = clock();
    const app = new Hono();
    app.use(
      '*',
      rateLimit({
        name: 't',
        windowMs: 60_000,
        max: 2,
        keyOf: (ctx) => ctx.req.header('x-key') ?? null,
        now: c.now,
      }),
    );
    app.get('/', (ctx) => ctx.text('ok'));
    const as = (key: string) => app.request('/', { headers: { 'x-key': key } });
    expect((await as('a')).status).toBe(200);
    const second = await as('a');
    expect(second.status).toBe(200);
    expect(second.headers.get('ratelimit-remaining')).toBe('0');
    const third = await as('a');
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({ error: 'too_many_requests', requestId: null });
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await as('b')).status).toBe(200);
    c.tick(61_000);
    expect((await as('a')).status).toBe(200);
  });

  it('in failure mode counts only refusals, so an honest caller is not cut off', async () => {
    const app = new Hono();
    app.use(
      '*',
      rateLimit({ name: 'f', windowMs: 60_000, max: 2, keyOf: () => 'same', mode: 'failure' }),
    );
    app.get('/ok', (ctx) => ctx.text('ok'));
    app.get('/no', (ctx) => ctx.json({ error: 'unauthorized' }, 401));
    for (let i = 0; i < 5; i++) expect((await app.request('/ok')).status).toBe(200);
    expect((await app.request('/no')).status).toBe(401);
    expect((await app.request('/no')).status).toBe(401);
    expect((await app.request('/no')).status).toBe(429);
    expect((await app.request('/ok')).status).toBe(429);
  });

  it('leaves a request alone when it belongs to no bucket', async () => {
    const app = new Hono();
    app.use('*', rateLimit({ name: 'n', windowMs: 60_000, max: 1, keyOf: () => null }));
    app.get('/', (ctx) => ctx.text('ok'));
    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/')).status).toBe(200);
  });
});

describe('the API budgets', () => {
  const deps = {
    pool: {
      connect: async () => {
        throw new Error('no database in this test');
      },
    },
    verifier: { verify: async () => null },
  };

  it('cuts off an address that keeps failing to sign in', async () => {
    const api = createApi({
      ...deps,
      keyOf: () => 'ip:test',
      limits: { authFailuresPerMinute: 3 },
    });
    for (let i = 0; i < 3; i++) expect((await api.request('/api/me')).status).toBe(401);
    expect((await api.request('/api/me')).status).toBe(429);
    expect((await api.request('/api/health')).status).toBe(429);
  });

  it('reads budgets from the environment and falls back to the defaults', () => {
    expect(
      limitsFromEnv({
        RATE_LIMIT_PER_MINUTE: '10',
        RATE_LIMIT_ACTOR_PER_MINUTE: 'lots',
        // The portal's invitation door, which answers somebody with no session
        // (docs/CHANGE-REQUESTS/client-portal-05.md item 3).
        RATE_LIMIT_INVITE_DOOR_PER_MINUTE: '4',
        // The website's enquiry door, the other route that answers a stranger
        // (docs/CHANGE-REQUESTS/trunk-notes.md, round 38).
        RATE_LIMIT_ENQUIRY_DOOR_PER_MINUTE: '3',
      }),
    ).toEqual({
      perMinute: 10,
      actorPerMinute: 600,
      authFailuresPerMinute: 20,
      devDoorPerMinute: 30,
      inviteDoorPerMinute: 4,
      enquiryDoorPerMinute: 3,
    });
    expect(limitsFromEnv({}).inviteDoorPerMinute).toBe(10);
    expect(limitsFromEnv({}).enquiryDoorPerMinute).toBe(10);
  });

  it('trusts X-Forwarded-For only for the configured number of proxies', async () => {
    const app = new Hono();
    app.get('/', (ctx) => ctx.text(String(addressKey(1)(ctx))));
    const res = await app.request('/', {
      headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' },
    });
    expect(await res.text()).toBe('ip:198.51.100.7');
    const none = new Hono();
    none.get('/', (ctx) => ctx.text(String(addressKey(0)(ctx))));
    expect(
      await (await none.request('/', { headers: { 'x-forwarded-for': '203.0.113.9' } })).text(),
    ).toBe('null');
  });
});

describe('budgets before the body gates', () => {
  it('counts oversized and malformed bodies against the address budget', async () => {
    const api = createApi({
      pool: {
        connect: async () => {
          throw new Error('no database in this test');
        },
      },
      verifier: { verify: async () => null },
      keyOf: () => 'ip:flood',
      limits: { perMinute: 2 },
    });
    const post = (body: string, type: string) =>
      api.request('/api/me', { method: 'POST', headers: { 'content-type': type }, body });
    expect((await post('x', 'text/plain')).status).toBe(415);
    expect((await post('x', 'text/plain')).status).toBe(415);
    expect((await post('x', 'text/plain')).status).toBe(429);
  });
});
