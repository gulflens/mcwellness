import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import type { TimelineResponse } from '../../app/api/audit/schema';
import { createApi } from '../../app/api/create-api';
import { applySeed } from '../../db/seed/apply';
import { generateSeed, SEED_TENANT_ID } from '../../db/seed/generate';
import { deriveIdentityKeys } from '../../domain/shared/identity';
import { asApiRole, freshDatabase, rolledBack } from './helpers';

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

/**
 * Writes one audit row straight into the chain, bypassing the app: the
 * fold-repeated-reads test (Task 8, walk-fixes-1) needs rows at exact,
 * controlled timestamps that a live request cannot promise. `entity_id`
 * carries no foreign key (070_audit_log.sql), so a synthetic appointment id
 * that names no real row is a legitimate row here, exactly as the direct
 * writes in tests/db/audit.test.ts are.
 */
async function insertAppointmentAudit(
  clientId: string,
  actorId: string,
  appointmentId: string,
  action: string,
  changedFields: string[] | null,
  occurredAt: string,
): Promise<void> {
  await owner.query(
    'insert into audit_log (tenant_id, actor_id, actor_type, actor_role, action, entity_type, ' +
      'entity_id, client_id, changed_fields, occurred_at) values ' +
      '($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8::uuid, $9::text[], $10::timestamptz)',
    [
      SEED_TENANT_ID,
      actorId,
      'user',
      'owner',
      action,
      'appointment',
      appointmentId,
      clientId,
      changedFields,
      occurredAt,
    ],
  );
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
      `${ownerName} recorded brain-map and neurofeedback information consent, version 1, by signature in the app`,
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
    const withoutReason = await get(authIdOf(0), `/api/clients/${client.id}/timeline`);
    expect(withoutReason.status).toBe(400);
    expect(((await withoutReason.json()) as { error: string }).error).toBe('reason_required');
    const withReason = await api.request(`/api/clients/${client.id}/timeline`, {
      headers: {
        authorization: `Bearer ${await mint(authIdOf(0))}`,
        'x-reason': 'Family asked what was held.',
      },
    });
    expect(withReason.status).toBe(200);
    // The reason a break-glass read is opened with is the whole point of the
    // row (docs/SPEC/audit.md section 6): a second read, still with the
    // record erased, shows the first read's own reason on the trail rather
    // than nulling it as an ordinary read would.
    const again = await api.request(`/api/clients/${client.id}/timeline`, {
      headers: {
        authorization: `Bearer ${await mint(authIdOf(0))}`,
        'x-reason': 'Checking again before the letter goes out.',
      },
    });
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as TimelineResponse;
    const ownerName = data.users[0]?.displayName ?? '';
    const priorRead = againBody.events.find(
      (e) => e.sentence === `${ownerName} viewed this record` && e.kind === 'read',
    );
    expect(priorRead?.reason).toBe('Family asked what was held.');
    expect((await get(authIdOf(3), `/api/clients/${client.id}/timeline`)).status).toBe(404);
    await owner.query("update client set status = 'active' where id = $1", [client.id]);
    expect(
      (await get(authIdOf(0), `/api/clients/${client.id}/timeline?before=9223372036854775808`))
        .status,
    ).toBe(400);
  });

  it('lets only owner, admin and lead practitioner read the trail, in the database itself', async () => {
    const client = clientAt(5);
    const countAs = (roles: string) =>
      rolledBack(owner, () =>
        asApiRole(
          owner,
          SEED_TENANT_ID,
          async () =>
            (
              await owner.query<{ n: number }>(
                'select count(*)::int as n from audit_log where client_id = $1',
                [client.id],
              )
            ).rows[0]?.n ?? -1,
          roles,
        ),
      );
    expect(await countAs('owner')).toBeGreaterThan(0);
    expect(await countAs('lead_practitioner')).toBeGreaterThan(0);
    expect(await countAs('practitioner')).toBe(0);
    expect(await countAs('finance')).toBe(0);
  });

  it('refuses a practitioner, and shows another practice nothing', async () => {
    const client = clientAt(5);
    expect((await get(authIdOf(1), `/api/clients/${client.id}/timeline`)).status).toBe(403);
    expect((await get(ADMIN_B_AUTH, `/api/clients/${client.id}/timeline`)).status).toBe(404);
  });

  // A quieter timeline (Task 8, walk-fixes-1): the walk of 10 September found a
  // client's timeline saying "recorded list on the appointment" nine times for
  // one booking. Reads of the same sentence by the same person inside one
  // minute fold into one line with a count; a change never folds, whatever its
  // sentence.
  it('folds three list reads of one appointment, by the same actor inside a minute, into one event with count 3', async () => {
    const client = clientAt(6);
    const ownerId = data.users[0]?.id;
    const ownerName = data.users[0]?.displayName ?? '';
    if (!ownerId) throw new Error('No seeded owner.');
    const appointmentId = '00000009-0000-4000-8000-000000000101';
    await insertAppointmentAudit(
      client.id,
      ownerId,
      appointmentId,
      'list',
      null,
      '2026-09-10T09:00:00.100Z',
    );
    await insertAppointmentAudit(
      client.id,
      ownerId,
      appointmentId,
      'list',
      null,
      '2026-09-10T09:00:20.000Z',
    );
    await insertAppointmentAudit(
      client.id,
      ownerId,
      appointmentId,
      'list',
      null,
      '2026-09-10T09:00:59.900Z',
    );

    const body = (await (
      await get(authIdOf(0), `/api/clients/${client.id}/timeline`)
    ).json()) as TimelineResponse;
    const folded = body.events.filter(
      (e) => e.sentence === `${ownerName} saw the appointment in the schedule`,
    );
    expect(folded).toHaveLength(1);
    expect(folded[0]?.count).toBe(3);
    expect(folded[0]?.kind).toBe('read');
  });

  it('never folds two changes with the same sentence, the same actor and the same minute', async () => {
    const client = clientAt(6);
    const ownerId = data.users[0]?.id;
    const ownerName = data.users[0]?.displayName ?? '';
    if (!ownerId) throw new Error('No seeded owner.');
    const appointmentId = '00000009-0000-4000-8000-000000000102';
    await insertAppointmentAudit(
      client.id,
      ownerId,
      appointmentId,
      'update',
      ['status'],
      '2026-09-10T09:01:00.000Z',
    );
    await insertAppointmentAudit(
      client.id,
      ownerId,
      appointmentId,
      'update',
      ['status'],
      '2026-09-10T09:01:10.000Z',
    );

    const body = (await (
      await get(authIdOf(0), `/api/clients/${client.id}/timeline`)
    ).json()) as TimelineResponse;
    const changed = body.events.filter(
      (e) => e.sentence === `${ownerName} changed the appointment (status)`,
    );
    expect(changed).toHaveLength(2);
    expect(changed.every((e) => e.count === 1)).toBe(true);
  });

  // Fix round 1 (Task 8): the first pass folded by the actor's display name,
  // which would merge two different people who happen to share one. An audit
  // line must never merge two people, so the fold now keys on the actor's id.
  it('never folds two different people who share a display name into one line', async () => {
    const client = clientAt(6);
    const readerA = '00000009-0000-4000-8000-000000000201';
    const readerB = '00000009-0000-4000-8000-000000000202';
    const sharedName = 'Synthetic Reader';
    await owner.query(
      'insert into app_user (id, tenant_id, display_name) values ($1, $2, $3), ($4, $2, $3)',
      [readerA, SEED_TENANT_ID, sharedName, readerB],
    );
    const appointmentId = '00000009-0000-4000-8000-000000000103';
    await insertAppointmentAudit(
      client.id,
      readerA,
      appointmentId,
      'list',
      null,
      '2026-09-10T09:02:00.000Z',
    );
    await insertAppointmentAudit(
      client.id,
      readerB,
      appointmentId,
      'list',
      null,
      '2026-09-10T09:02:10.000Z',
    );

    const body = (await (
      await get(authIdOf(0), `/api/clients/${client.id}/timeline`)
    ).json()) as TimelineResponse;
    const seen = body.events.filter(
      (e) => e.sentence === `${sharedName} saw the appointment in the schedule`,
    );
    expect(seen).toHaveLength(2);
    expect(seen.every((e) => e.count === 1)).toBe(true);
  });

  it('never folds two reads that straddle a calendar-minute boundary', async () => {
    // A fresh client (unused by the other fold tests above): this test's
    // filter matches on sentence text alone, and client 6 already carries a
    // folded "saw the appointment in the schedule" entry from an earlier case
    // in this file that would otherwise be counted here too.
    const client = clientAt(7);
    const ownerId = data.users[0]?.id;
    const ownerName = data.users[0]?.displayName ?? '';
    if (!ownerId) throw new Error('No seeded owner.');
    const appointmentId = '00000009-0000-4000-8000-000000000104';
    await insertAppointmentAudit(
      client.id,
      ownerId,
      appointmentId,
      'list',
      null,
      '2026-09-10T09:03:59.999Z',
    );
    await insertAppointmentAudit(
      client.id,
      ownerId,
      appointmentId,
      'list',
      null,
      '2026-09-10T09:04:00.000Z',
    );

    const body = (await (
      await get(authIdOf(0), `/api/clients/${client.id}/timeline`)
    ).json()) as TimelineResponse;
    const seen = body.events.filter(
      (e) => e.sentence === `${ownerName} saw the appointment in the schedule`,
    );
    expect(seen).toHaveLength(2);
    expect(seen.every((e) => e.count === 1)).toBe(true);
  });
});
