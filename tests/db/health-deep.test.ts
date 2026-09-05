import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createApi } from '../../app/api/create-api';
import type { TokenVerifier } from '../../app/api/_middleware/token-verifier';
import { freshDatabase } from './helpers';

/**
 * The deep health check against a real database (docs/SPEC/hosting.md section
 * 7.2). Its companion in app/api/create-api.test.ts proves the other half —
 * what the route answers when the pool refuses — with a fake and no database
 * at all; this file is the only place the happy path is worth anything,
 * because the whole point of the route is that it touches Postgres.
 */

// Nothing here signs in: both health routes answer ahead of the fence, so a
// verifier that refuses everything proves they do not need one.
const refusesEverything: TokenVerifier = {
  async verify() {
    return null;
  },
};

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

beforeAll(async () => {
  owner = await freshDatabase();
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: refusesEverything });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/health/deep', () => {
  it('answers ok when the database answers, without a token', async () => {
    const response = await api.request('/api/health/deep');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('leaves the pool with nothing checked out', async () => {
    await api.request('/api/health/deep');
    await api.request('/api/health/deep');

    // Every connection this route takes is given back, so a monitor calling it
    // every few minutes for a year never exhausts the pool.
    expect(pool.idleCount).toBe(pool.totalCount);
    expect(pool.waitingCount).toBe(0);
  });

  it('says nothing about the database it just reached', async () => {
    const body = await (await api.request('/api/health/deep')).text();

    // No version, no host, no database name, no role: the body is the one word
    // a monitor needs and nothing a stranger can use.
    expect(body).toBe('{"ok":true}');
  });
});
