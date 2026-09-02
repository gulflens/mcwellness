import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { ApiEnv } from './_middleware/request-context';
import { createTokenVerifier } from './_middleware/token-verifier';
import { devSessionEnabled, mountDevSession } from './dev-session';

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const AUTH_ID = '00000003-0000-4000-8000-000000000001';

describe('devSessionEnabled', () => {
  const local = {
    APP_ENV: 'development',
    API_DATABASE_URL: 'postgresql://mcwellness_api:x@localhost:5432/postgres',
    SUPABASE_JWT_SECRET: SECRET,
  };

  it('opens only on a laptop: development, a local database, and a secret to sign with', () => {
    expect(devSessionEnabled(local)).toBe(true);
    expect(devSessionEnabled({ ...local, APP_ENV: 'staging' })).toBe(false);
    expect(devSessionEnabled({ ...local, APP_ENV: undefined })).toBe(false);
    expect(
      devSessionEnabled({ ...local, API_DATABASE_URL: 'postgresql://u:x@db.example.com/postgres' }),
    ).toBe(false);
    expect(devSessionEnabled({ ...local, SUPABASE_JWT_SECRET: '' })).toBe(false);
  });
});

describe('mountDevSession', () => {
  it('mints a token the verifier accepts, for the auth id asked for', async () => {
    const api = new Hono<ApiEnv>();
    mountDevSession(api, { secret: SECRET, issuer: ISSUER });
    const res = await api.request('/api/dev/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authId: AUTH_ID }),
    });
    expect(res.status).toBe(200);
    const { token, expiresAt } = (await res.json()) as { token: string; expiresAt: number };
    expect(expiresAt).toBeGreaterThan(Date.now() / 1000);
    const claims = await createTokenVerifier({ issuer: ISSUER, secret: SECRET }).verify(token);
    expect(claims?.sub).toBe(AUTH_ID);
  });

  it('refuses a body without a uuid', async () => {
    const api = new Hono<ApiEnv>();
    mountDevSession(api, { secret: SECRET, issuer: ISSUER });
    const res = await api.request('/api/dev/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authId: 'owner' }),
    });
    expect(res.status).toBe(400);
  });
});
