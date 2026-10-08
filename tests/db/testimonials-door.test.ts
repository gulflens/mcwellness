import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { localDiskStorage } from '../../app/api/_middleware/storage';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi, type ApiOptions } from '../../app/api/create-api';
import { freshDatabase, IDS, seedTenant } from './helpers';

/**
 * The website's two review routes as the Testimonials page reaches them:
 * through `createApi`, ahead of the fence, with no token
 * (app/api/testimonials/door.ts, docs/SPEC/testimonials.md sections 7 and 8).
 * The database side is proved in ./testimonials.test.ts; this is the HTTP
 * contract the website is built against.
 */

const DOOR = '/api/testimonials';
const PUBLISHED = '/api/testimonials/published';
const APEX = 'https://mcwellnessuae.com';
const WWW = 'https://www.mcwellnessuae.com';

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

function options(overrides: Partial<ApiOptions> = {}): ApiOptions {
  return {
    pool,
    verifier: createTokenVerifier({
      issuer: 'http://localhost:54321/auth/v1',
      secret: 'x'.repeat(40),
    }),
    now: () => new Date(),
    storage: localDiskStorage({
      dir: mkdtempSync(join(tmpdir(), 'mcwellness-testimonial-')),
      signingSecret: Buffer.alloc(32, 9),
    }),
    appEnv: process.env.APP_ENV,
    // Each test names its own address, so the database's three-in-ten-minutes
    // budget is one test's and not the file's. The route's per-minute budget is
    // lifted out of the way and proved on its own below.
    keyOf: (c) => `ip:${c.req.header('x-test-address') ?? 'test'}`,
    limits: { enquiryDoorPerMinute: 1000 },
    ...overrides,
  };
}

const REVIEW = {
  display_name: 'Hazel H.',
  context: 'Parent, Dubai',
  rating: 5,
  body: 'The home visits fitted around our week, and the team explained every step.',
  language: 'en',
  consent_to_publish: true,
  website: '',
};

function post(body: unknown, headers: Record<string, string> = {}, address = 'test'): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: APEX,
      'x-test-address': address,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

async function count(): Promise<number> {
  const { rows } = await owner.query<{ n: number }>('select count(*)::int as n from testimonial');
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Practice A');
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi(options());
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('POST /api/testimonials', () => {
  it('keeps a review from the website with no token, and answers 201 with no body and CORS for the apex', async () => {
    await owner.query('delete from testimonial');
    const res = await api.request(DOOR, post(REVIEW, {}, 'keep'));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('');
    expect(res.headers.get('access-control-allow-origin')).toBe(APEX);
    expect(res.headers.get('vary')).toContain('Origin');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    const { rows } = await owner.query(
      'select display_name, context, rating, language, status, consent_to_publish, ' +
        'length(ip_hash) as hash_len from testimonial',
    );
    expect(rows).toEqual([
      {
        display_name: 'Hazel H.',
        context: 'Parent, Dubai',
        rating: 5,
        language: 'en',
        status: 'pending',
        consent_to_publish: true,
        hash_len: 64,
      },
    ]);
  });

  it('answers www by name as well', async () => {
    const res = await api.request(DOOR, post(REVIEW, { origin: WWW }, 'www'));
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe(WWW);
  });

  it('refuses a post from any other origin, or none, and keeps nothing', async () => {
    await owner.query('delete from testimonial');
    const foreign = await api.request(DOOR, post(REVIEW, { origin: 'https://evil.example' }));
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: 'origin_refused' });
    // The answer names the canonical origin, which the foreign page cannot read.
    expect(foreign.headers.get('access-control-allow-origin')).toBe(APEX);
    const init = post(REVIEW);
    delete (init.headers as Record<string, string>).origin;
    expect((await api.request(DOOR, init)).status).toBe(403);
    expect(await count()).toBe(0);
  });

  it('refuses anything that is not JSON with 415, still readable by the website', async () => {
    const res = await api.request(DOOR, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APEX },
      body: new URLSearchParams({ display_name: 'Hazel H.' }).toString(),
    });
    expect(res.status).toBe(415);
    expect(res.headers.get('access-control-allow-origin')).toBe(APEX);
  });

  it('refuses a review without the tick to publish, naming the field', async () => {
    await owner.query('delete from testimonial');
    const res = await api.request(DOOR, post({ ...REVIEW, consent_to_publish: false }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid', fields: ['consent_to_publish'] });
    const missing = await api.request(
      DOOR,
      post(Object.fromEntries(Object.entries(REVIEW).filter(([k]) => k !== 'consent_to_publish'))),
    );
    expect(missing.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it('refuses a review over 1200 characters rather than cutting it', async () => {
    await owner.query('delete from testimonial');
    const res = await api.request(DOOR, post({ ...REVIEW, body: 'a'.repeat(1201) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid', fields: ['body'] });
    expect(await count()).toBe(0);
  });

  it('names every wrong field of an empty or non-object body', async () => {
    for (const body of ['{}', 'null', '[]']) {
      const res = await api.request(DOOR, post(body));
      expect(res.status, body).toBe(400);
      expect(await res.json()).toMatchObject({
        fields: ['display_name', 'rating', 'body', 'language', 'consent_to_publish'],
      });
    }
  });

  it('refuses a body larger than the door needs before reading it', async () => {
    const res = await api.request(DOOR, post({ ...REVIEW, body: 'a'.repeat(20_000) }));
    expect(res.status).toBe(413);
    expect(res.headers.get('access-control-allow-origin')).toBe(APEX);
  });

  it('answers a filled honeypot exactly as it answers a person, and keeps nothing', async () => {
    await owner.query('delete from testimonial');
    const res = await api.request(DOOR, post({ ...REVIEW, website: 'https://spam.example' }));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('');
    expect(await count()).toBe(0);
  });

  it('answers the fourth review from one address in ten minutes with the same 201, and keeps three', async () => {
    await owner.query('delete from testimonial');
    for (let i = 0; i < 4; i += 1) {
      const res = await api.request(DOOR, post(REVIEW, {}, 'budget'));
      expect(res.status, `review ${i + 1}`).toBe(201);
    }
    expect(await count()).toBe(3);
  });

  it('has a budget of its own per minute, at the enquiry door’s rate, and none for a preflight', async () => {
    const tight = createApi(
      options({ keyOf: () => 'ip:tight', limits: { enquiryDoorPerMinute: 2 } }),
    );
    const honeypot = { ...REVIEW, website: 'x' };
    expect((await tight.request(DOOR, post(honeypot))).status).toBe(201);
    expect((await tight.request(DOOR, post(honeypot))).status).toBe(201);
    const third = await tight.request(DOOR, post(honeypot));
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(third.headers.get('access-control-allow-origin')).toBe(APEX);
    const preflight = await tight.request(DOOR, { method: 'OPTIONS', headers: { origin: APEX } });
    expect(preflight.status).toBe(204);
  });

  it('answers a preflight for the website, allowing a JSON post', async () => {
    const res = await api.request(DOOR, {
      method: 'OPTIONS',
      headers: {
        origin: WWW,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(WWW);
    expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type');
  });

  it('keeps the console’s list behind the fence: a GET on the same path is refused unsigned', async () => {
    const res = await api.request(DOOR, { method: 'GET', headers: { origin: APEX } });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('GET /api/testimonials/published', () => {
  async function approved(displayName: string, language: 'en' | 'ar', order: number | null) {
    await owner.query(
      'insert into testimonial (tenant_id, display_name, context, rating, body, language, ' +
        "consent_to_publish, status, decided_by, decided_at, published_order) values ($1, $2, null, 4, $3, $4, true, 'approved', $5, now(), $6)",
      [
        IDS.tenantA,
        displayName,
        'Kind, punctual and clear about every step.',
        language,
        IDS.ownerA,
        order,
      ],
    );
  }

  it('sends the approved reviews in the language asked, four fields each, cacheable for a minute', async () => {
    await owner.query('delete from testimonial');
    await approved('Basil V.', 'en', 2);
    await approved('Iris C.', 'en', 1);
    await approved('ريحان و.', 'ar', null);
    // Waiting for the office: never sent.
    await api.request(DOOR, post({ ...REVIEW, display_name: 'Rowan M.' }, {}, 'read'));

    const res = await api.request(`${PUBLISHED}?lang=en`, { headers: { origin: APEX } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(APEX);
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await res.json()).toEqual({
      testimonials: [
        {
          display_name: 'Iris C.',
          context: null,
          rating: 4,
          body: 'Kind, punctual and clear about every step.',
        },
        {
          display_name: 'Basil V.',
          context: null,
          rating: 4,
          body: 'Kind, punctual and clear about every step.',
        },
      ],
    });

    const arabic = await api.request(`${PUBLISHED}?lang=ar`);
    const body = (await arabic.json()) as { testimonials: { display_name: string }[] };
    expect(body.testimonials.map((t) => t.display_name)).toEqual(['ريحان و.']);
  });

  it('reads English when no language is named, and refuses one it does not know', async () => {
    expect((await api.request(PUBLISHED)).status).toBe(200);
    const res = await api.request(`${PUBLISHED}?lang=fr`);
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers a preflight for a GET', async () => {
    const res = await api.request(PUBLISHED, { method: 'OPTIONS', headers: { origin: APEX } });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
  });
});
