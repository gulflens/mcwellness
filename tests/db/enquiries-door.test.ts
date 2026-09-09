import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { localDiskStorage } from '../../app/api/_middleware/storage';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi } from '../../app/api/create-api';
import { freshDatabase, IDS, seedTenant } from './helpers';

/**
 * The enquiry door as the website reaches it: through `createApi`, ahead of
 * the fence, with a form-encoded body and no token. The database side of the
 * door is proved in ./enquiries.test.ts; this is the HTTP side.
 */

const DOOR = '/api/enquiries';
const APEX = 'https://mcwellnessuae.com';

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

function form(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APEX },
    body: new URLSearchParams(fields).toString(),
  };
}

const HAZEL = {
  name: 'Hazel Harbour',
  country_code: '+971',
  phone: '50 000 0099',
  email: 'hazel@example.com',
  message: 'I want to know more',
  consent: 'on',
  source: 'website',
};

async function rows(): Promise<{ n: string }[]> {
  return (await owner.query<{ n: string }>('select count(*)::text as n from enquiry')).rows;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Practice A');
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({
    pool,
    verifier: createTokenVerifier({
      issuer: 'http://localhost:54321/auth/v1',
      secret: 'x'.repeat(40),
    }),
    now: () => new Date(),
    storage: localDiskStorage({
      dir: mkdtempSync(join(tmpdir(), 'mcwellness-enquiry-')),
      signingSecret: Buffer.alloc(32, 9),
    }),
    appEnv: process.env.APP_ENV,
    // One bucket for every request in this file: what the database's
    // five-in-ten-minutes throttle is keyed on. The route's own per-minute
    // budget is lifted out of the way here and proved on its own below.
    keyOf: () => 'ip:test',
    limits: { enquiryDoorPerMinute: 1000 },
  });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('the enquiry door', () => {
  it('lodges a form-encoded enquiry with no token and answers thank you, with CORS for the apex', async () => {
    await owner.query('delete from enquiry');
    const res = await api.request(DOOR, form(HAZEL));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('access-control-allow-origin')).toBe(APEX);
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const { rows: read } = await owner.query(
      'select name, whatsapp_e164, consent, source, status, length(ip_hash) as hash_len from enquiry',
    );
    expect(read).toEqual([
      {
        name: 'Hazel Harbour',
        whatsapp_e164: '+971500000099',
        consent: true,
        source: 'website',
        status: 'new',
        hash_len: 64,
      },
    ]);
  });

  it('accepts JSON as readily as a form', async () => {
    await owner.query('delete from enquiry');
    const res = await api.request(DOOR, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APEX },
      body: JSON.stringify({ ...HAZEL, source: 'discovery_call', concern: 'sleep' }),
    });
    expect(res.status).toBe(200);
    const { rows: read } = await owner.query('select source, concern from enquiry');
    expect(read).toEqual([{ source: 'discovery_call', concern: 'sleep' }]);
  });

  it('treats a JSON body that is not an object as an empty form', async () => {
    for (const body of ['null', '[]', '"hazel"']) {
      const res = await api.request(DOOR, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: APEX },
        body,
      });
      expect(res.status).toBe(400);
    }
  });

  it('answers a filled honeypot exactly as it answers a person, and keeps nothing', async () => {
    await owner.query('delete from enquiry');
    const res = await api.request(DOOR, form({ ...HAZEL, botcheck: 'on' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await rows()).toEqual([{ n: '0' }]);
  });

  it('tells a person, and only a person, that a name and a number are needed', async () => {
    await owner.query('delete from enquiry');
    const res = await api.request(DOOR, form({ ...HAZEL, phone: '' }));
    expect(res.status).toBe(400);
    expect(await rows()).toEqual([{ n: '0' }]);
  });

  it('answers the sixth lodging from one address in ten minutes with the same thank you, and keeps five', async () => {
    await owner.query('delete from enquiry');
    for (let i = 0; i < 6; i += 1) {
      const res = await api.request(DOOR, form(HAZEL));
      expect(res.status, `lodging ${i + 1}`).toBe(200);
    }
    expect(await rows()).toEqual([{ n: '5' }]);
  });

  it('answers a preflight with 204 and names the canonical origin to a stranger', async () => {
    const ours = await api.request(DOOR, {
      method: 'OPTIONS',
      headers: { origin: 'https://www.mcwellnessuae.com' },
    });
    expect(ours.status).toBe(204);
    expect(ours.headers.get('access-control-allow-origin')).toBe('https://www.mcwellnessuae.com');
    const theirs = await api.request(DOOR, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    expect(theirs.headers.get('access-control-allow-origin')).toBe(APEX);
  });

  it('is the only unsigned door: a GET on the same path meets the fence', async () => {
    const res = await api.request(DOOR, { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('has a budget of its own for writes, and none for a preflight', async () => {
    const tight = createApi({
      pool,
      verifier: createTokenVerifier({
        issuer: 'http://localhost:54321/auth/v1',
        secret: 'x'.repeat(40),
      }),
      now: () => new Date(),
      storage: localDiskStorage({
        dir: mkdtempSync(join(tmpdir(), 'mcwellness-enquiry-tight-')),
        signingSecret: Buffer.alloc(32, 9),
      }),
      appEnv: process.env.APP_ENV,
      keyOf: () => 'ip:tight',
      limits: { enquiryDoorPerMinute: 2 },
    });
    expect((await tight.request(DOOR, form({ ...HAZEL, botcheck: 'on' }))).status).toBe(200);
    expect((await tight.request(DOOR, form({ ...HAZEL, botcheck: 'on' }))).status).toBe(200);
    const third = await tight.request(DOOR, form({ ...HAZEL, botcheck: 'on' }));
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toMatch(/^\d+$/);
    // The preflight is not a write and is never counted or refused.
    const preflight = await tight.request(DOOR, { method: 'OPTIONS', headers: { origin: APEX } });
    expect(preflight.status).toBe(204);
  });
});
