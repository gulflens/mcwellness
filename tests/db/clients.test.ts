import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi } from '../../app/api/create-api';
import type { ClientListResponse } from '../../app/api/clients/schema';
import { applySeed } from '../../db/seed/apply';
import { generateSeed, SEED_OWNER_USER_ID } from '../../db/seed/generate';
import { deriveIdentityKeys } from '../../domain/shared/identity';
import { freshDatabase } from './helpers';

// Everything synthetic: the seeded practice, a test secret that unlocks nothing,
// and a second practice with one admin to prove the fence between practices.
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const TENANT_B = '00000000-0000-4000-8000-0000000000b0';
const ADMIN_B = '00000000-0000-4000-8000-0000000000b1';
const ADMIN_B_AUTH = '00000000-0000-4000-8000-0000000000b2';
const STRANGER_AUTH = '00000000-0000-4000-8000-0000000000ff';
const data = generateSeed();

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

async function mint(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(KEY);
}

async function list(sub: string, query = '', requestId?: string): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${await mint(sub)}` };
  if (requestId) headers['x-request-id'] = requestId;
  return api.request(`/api/clients${query}`, { headers });
}

function authIdOf(index: number): string {
  const user = data.users[index];
  if (!user) throw new Error(`No seeded user ${index}.`);
  return user.authId;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await applySeed(owner, data, deriveIdentityKeys(Buffer.alloc(32, 7)));
  await owner.query("insert into tenant (id, legal_name) values ($1, 'Synthetic Studio B')", [
    TENANT_B,
  ]);
  await owner.query(
    "insert into app_user (id, tenant_id, auth_id, display_name) values ($1, $2, $3, 'Synthetic Admin B')",
    [ADMIN_B, TENANT_B, ADMIN_B_AUTH],
  );
  await owner.query("insert into user_role (tenant_id, user_id, role) values ($1, $2, 'admin')", [
    TENANT_B,
    ADMIN_B,
  ]);
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/clients', () => {
  it('lists the practice for the owner, sorted by record number, and records every read', async () => {
    const requestId = '00000000-0000-4000-8000-0000000000e1';
    const res = await list(authIdOf(0), '', requestId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClientListResponse;
    expect(body.note).toBeNull();
    expect(body.clients).toHaveLength(20);
    expect(body.clients.map((c) => c.mrn)).toEqual(data.clients.map((c) => c.mrn));
    const first = body.clients[0];
    expect(first?.givenName).toBe(data.clients[0]?.givenName);
    expect(first?.contact?.relationship).toBe('self');
    expect(typeof first?.age).toBe('number');
    expect(first?.emirate).toBe('DXB');
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from audit_log where action = 'list' and entity_type = 'client' " +
        'and request_id = $1 and actor_id = $2 and client_id = entity_id',
      [requestId, SEED_OWNER_USER_ID],
    );
    expect(rows[0]?.n).toBe(20);
  });

  it('gives a practitioner without an admin role an empty table with the schedule note, and logs no read', async () => {
    // The third seeded practitioner, not the second: the second now has
    // three households on their own day (db/seed/generate.ts, the board's
    // second practitioner, docs/SPEC/dispatch.md section 13), and the third
    // has none by any path — no appointment, no assessment, only a
    // credential, which names no client at all.
    const requestId = '00000000-0000-4000-8000-0000000000e2';
    const res = await list(authIdOf(2), '', requestId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ clients: [], note: 'schedule' });
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from audit_log where action in ('read', 'list') and request_id = $1",
      [requestId],
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('lists for the coordinator, who holds admin', async () => {
    const res = await list(authIdOf(3));
    expect(res.status).toBe(200);
    expect(((await res.json()) as ClientListResponse).clients).toHaveLength(20);
  });

  it('filters by status and searches names in both scripts and record numbers, escaping wildcards', async () => {
    const leads = (await (await list(authIdOf(0), '?status=lead')).json()) as ClientListResponse;
    expect(leads.clients).toHaveLength(data.clients.filter((c) => c.status === 'lead').length);
    const byName = (await (
      await list(authIdOf(0), `?q=${encodeURIComponent(data.clients[0]?.givenName ?? '')}`)
    ).json()) as ClientListResponse;
    expect(byName.clients.map((c) => c.mrn)).toEqual(['MW-000001']);
    const arabic = data.clients.find((c) => c.givenNameAr !== null);
    const byArabic = (await (
      await list(authIdOf(0), `?q=${encodeURIComponent(arabic?.givenNameAr ?? '')}`)
    ).json()) as ClientListResponse;
    expect(byArabic.clients.some((c) => c.id === arabic?.id)).toBe(true);
    const byMrn = (await (await list(authIdOf(0), '?q=MW-00001')).json()) as ClientListResponse;
    expect(byMrn.clients).toHaveLength(10);
    const wildcard = (await (await list(authIdOf(0), '?q=%25')).json()) as ClientListResponse;
    expect(wildcard.clients).toHaveLength(0);
    expect((await list(authIdOf(0), '?status=deleted')).status).toBe(400);
  });

  it('keeps erased records with the owner and lead practitioner, away from an admin', async () => {
    await owner.query("update client set status = 'erased' where mrn = 'MW-000020'");
    const asOwner = (await (
      await list(authIdOf(0), '?status=erased')
    ).json()) as ClientListResponse;
    expect(asOwner.clients.map((c) => c.mrn)).toEqual(['MW-000020']);
    const asAdmin = (await (await list(authIdOf(3))).json()) as ClientListResponse;
    expect(asAdmin.clients).toHaveLength(19);
    expect(asAdmin.clients.some((c) => c.status === 'erased')).toBe(false);
    await owner.query("update client set status = 'active' where mrn = 'MW-000020'");
  });

  it('shows another practice nothing, and a stranger nothing at all', async () => {
    const other = await list(ADMIN_B_AUTH);
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({ clients: [], note: null });
    expect((await list(STRANGER_AUTH)).status).toBe(403);
  });
});
