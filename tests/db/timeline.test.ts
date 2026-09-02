import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import type { TimelineResponse } from '../../app/api/audit/schema';
import { createApi } from '../../app/api/create-api';
import { applySeed } from '../../db/seed/apply';
import { generateSeed } from '../../db/seed/generate';
import { deriveIdentityKeys } from '../../domain/shared';
import { freshDatabase } from './helpers';

// Everything synthetic: the seeded practice, a test secret that unlocks nothing,
// and a second practice with one admin to prove the fence between practices.
const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const TENANT_B = '00000000-0000-4000-8000-0000000000b0';
const ADMIN_B = '00000000-0000-4000-8000-0000000000b1';
const ADMIN_B_AUTH = '00000000-0000-4000-8000-0000000000b2';
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

async function get(sub: string, path: string, requestId?: string): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${await mint(sub)}` };
  if (requestId) headers['x-request-id'] = requestId;
  return api.request(path, { headers });
}

function authIdOf(index: number): string {
  const user = data.users[index];
  if (!user) throw new Error(`No seeded user ${index}.`);
  return user.authId;
}

function clientAt(n: number): { id: string; mrn: string } {
  const client = data.clients[n - 1];
  if (!client) throw new Error(`No seeded client ${n}.`);
  return client;
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

describe('GET /api/clients/:id/timeline', () => {
  it('tells the owner the story of a seeded client, newest first, in sentences', async () => {
    const client = clientAt(5);
    const res = await get(authIdOf(0), `/api/clients/${client.id}/timeline`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TimelineResponse;
    const sentences = body.events.map((e) => e.sentence);
    const ownerName = data.users[0]?.displayName ?? '';
    expect(sentences).toContain(`${ownerName} created the record`);
    expect(sentences).toContain(`${ownerName} added a contact (self)`);
    expect(sentences).toContain(`${ownerName} added a home location in Umm Al Quwain`);
    expect(sentences).toContain(
      `${ownerName} recorded participation consent, version 1, by signature in the app`,
    );
    expect(sentences).toContain(
      `${ownerName} recorded photo and video consent, version 1, by signature in the app`,
    );
    expect(sentences).toContain(`${ownerName} set the primary contact`);
    const ids = body.events.map((e) => Number(e.id));
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
    expect(body.events.every((e) => e.actor?.roles.includes('owner'))).toBe(true);
    expect(body.hasMore).toBe(false);
    for (const e of body.events) expect(e.sentence).not.toMatch(/[{}"]/);
  });

  it('speaks Arabic on request', async () => {
    const client = clientAt(5);
    const body = (await (
      await get(authIdOf(0), `/api/clients/${client.id}/timeline?locale=ar`)
    ).json()) as TimelineResponse;
    expect(body.events.some((e) => e.sentence.endsWith('أنشأ السجل'))).toBe(true);
  });

  it('shows who has viewed the record, and records the timeline view itself', async () => {
    const client = clientAt(5);
    await get(authIdOf(3), '/api/clients');
    const requestId = '00000000-0000-4000-8000-0000000000f1';
    const body = (await (
      await get(authIdOf(0), `/api/clients/${client.id}/timeline`, requestId)
    ).json()) as TimelineResponse;
    const coordinator = data.users[3]?.displayName ?? '';
    const viewed = body.events.filter((e) => e.kind === 'read');
    expect(viewed.some((e) => e.sentence === `${coordinator} saw this record in a list`)).toBe(
      true,
    );
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from audit_log where action = 'read' and client_id = $1 and request_id = $2",
      [client.id, requestId],
    );
    expect(rows[0]?.n).toBe(1);
    const again = (await (
      await get(authIdOf(0), `/api/clients/${client.id}/timeline`)
    ).json()) as TimelineResponse;
    const ownerName = data.users[0]?.displayName ?? '';
    expect(again.events[0]?.sentence).toBe(`${ownerName} viewed this record`);
  });

  it('pages backwards by audit id', async () => {
    const client = clientAt(5);
    const first = (await (
      await get(authIdOf(0), `/api/clients/${client.id}/timeline?limit=2`)
    ).json()) as TimelineResponse;
    expect(first.hasMore).toBe(true);
    expect(first.nextBefore).not.toBeNull();
    const second = (await (
      await get(
        authIdOf(0),
        `/api/clients/${client.id}/timeline?limit=2&before=${first.nextBefore}`,
      )
    ).json()) as TimelineResponse;
    const firstIds = first.events.map((e) => e.id);
    expect(
      second.events.every(
        (e) => !firstIds.includes(e.id) && Number(e.id) < Number(first.nextBefore),
      ),
    ).toBe(true);
    expect((await get(authIdOf(0), `/api/clients/${client.id}/timeline?limit=0`)).status).toBe(400);
    expect((await get(authIdOf(0), '/api/clients/not-a-uuid/timeline')).status).toBe(400);
  });

  it("keeps an erased record's history with the owner and lead practitioner, away from an admin", async () => {
    const client = clientAt(20);
    await owner.query("update client set status = 'erased' where id = $1", [client.id]);
    expect((await get(authIdOf(0), `/api/clients/${client.id}/timeline`)).status).toBe(200);
    expect((await get(authIdOf(3), `/api/clients/${client.id}/timeline`)).status).toBe(404);
    await owner.query("update client set status = 'active' where id = $1", [client.id]);
    expect(
      (await get(authIdOf(0), `/api/clients/${client.id}/timeline?before=9223372036854775808`))
        .status,
    ).toBe(400);
  });

  it('refuses a practitioner, and shows another practice nothing', async () => {
    const client = clientAt(5);
    expect((await get(authIdOf(1), `/api/clients/${client.id}/timeline`)).status).toBe(403);
    expect((await get(ADMIN_B_AUTH, `/api/clients/${client.id}/timeline`)).status).toBe(404);
  });
});
