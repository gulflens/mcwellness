import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countCompletedSessions,
  sessionWindow,
  type VisitForCount,
} from '../../../domain/reports/qeeg/sessionsCompleted';
import { seedClient, seedTenant } from '../../db/helpers';
import { clientToWriteAbout, householdOf, visitAt } from './qeeg-signing-support';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * `app.completed_session_count` (migration 605; brief S, fix round 1): the
 * number of a client's completed sessions between two recording days, the
 * same whoever of the practice asks. Row security would show a practitioner
 * only her own visits, so the count is made by the database on the practice's
 * behalf, behind the same gate as drafting a report, and refused, never
 * answered 0, to anyone else. `countCompletedSessions` is the rule's
 * reference; one fixture is run through both.
 *
 * Everything is invented: the seed's people, visits on made-up days.
 */

const NOW = () => new Date('2026-09-30T08:00:00.000Z');
const TENANT_B = '0000000b-0000-4000-8000-0000000000b0';
const OWNER_B = '0000000b-0000-4000-8000-0000000000b1';
const CLIENT_B = '0000000b-0000-4000-8000-0000000000c1';
const INSUFFICIENT_PRIVILEGE = '42501';

let h: Harness;
let clientId: string;
let clientIndex: number;
let otherClientId: string;
let erasedClientId: string;
let householdUserId: string;

/** The count, asked as the API role with these roles, this actor and this tenant. */
async function countAs(
  roles: string,
  actorId: string,
  args: [string, string, string],
  tenantId: string = h.data.tenant.id,
): Promise<{ count: number } | { code: string }> {
  await h.owner.query('begin');
  try {
    await h.owner.query('set local role app_role');
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', $3, true)",
      [tenantId, actorId, roles],
    );
    const { rows } = await h.owner.query<{ n: number }>(
      'select app.completed_session_count($1::uuid, $2::date, $3::date) as n',
      args,
    );
    return { count: Number(rows[0]?.n) };
  } catch (error) {
    return { code: String((error as { code?: string }).code) };
  } finally {
    await h.owner.query('rollback');
  }
}

function userOf(seeded: number): string {
  const id = h.data.users[seeded]?.id;
  if (!id) throw new Error(`No seeded user ${seeded}.`);
  return id;
}

function rolesOf(seeded: number): string {
  const id = userOf(seeded);
  return h.data.roles
    .filter((role) => role.userId === id)
    .map((role) => role.role)
    .join(',');
}

const WINDOW: [string, string] = ['2026-09-14', '2026-09-28'];

beforeAll(async () => {
  h = await startHarness(NOW);
  const client = clientToWriteAbout(h);
  clientId = client.id;
  clientIndex = client.index;
  await h.onSchedule(clientIndex, SEEDED.practitioner);
  const others = h.data.clients
    .map((c, at) => ({ c, at }))
    .filter(({ c, at }) => c.status === 'active' && at !== clientIndex);
  otherClientId = h.clientId(others[0]?.at ?? -1);
  erasedClientId = h.clientId(others[1]?.at ?? -1);

  // Inside the window: two by the owner, one by a colleague, one by the
  // practitioner who asks, and one checked in half an hour after midnight in
  // Dubai on the 20th (the 19th in UTC).
  await visitAt(h, clientId, '2026-09-15T09:00:00+04:00', { by: SEEDED.owner });
  await visitAt(h, clientId, '2026-09-16T09:00:00+04:00', { by: SEEDED.otherPractitioner });
  await visitAt(h, clientId, '2026-09-18T09:00:00+04:00', { by: SEEDED.practitioner });
  await visitAt(h, clientId, '2026-09-20T00:30:00+04:00', { by: SEEDED.owner });
  await visitAt(h, clientId, '2026-09-27T09:00:00+04:00', { by: SEEDED.owner });
  // Never counted.
  await visitAt(h, clientId, '2026-09-14T09:00:00+04:00'); // the earlier bound's day
  await visitAt(h, clientId, '2026-09-28T09:00:00+04:00'); // the later bound's day
  await visitAt(h, clientId, '2026-09-21T09:00:00+04:00', { status: 'voided' });
  await visitAt(h, clientId, '2026-09-22T09:00:00+04:00', { status: 'no_show' });
  await visitAt(h, clientId, '2026-09-23T09:00:00+04:00', { status: 'in_progress' });
  await visitAt(h, otherClientId, '2026-09-24T09:00:00+04:00');
  await visitAt(h, erasedClientId, '2026-09-24T09:00:00+04:00');
  await h.owner.query("update client set status = 'erased' where id = $1", [erasedClientId]);

  householdUserId = (
    await h.owner.query<{ id: string }>('select id from app_user where auth_id = $1', [
      await householdOf(h, clientId, 11),
    ])
  ).rows[0]?.id as string;

  // Another practice, with a client of its own and a visit on its books.
  await seedTenant(h.owner, TENANT_B, OWNER_B, 'Practice B');
  await seedClient(h.owner, TENANT_B, CLIENT_B, OWNER_B, 'Summit');
}, 240_000);

afterAll(async () => {
  await h.close();
});

describe('the count', () => {
  it('counts completed, closed visits strictly between the two days, whoever ran them', async () => {
    expect(
      await countAs(rolesOf(SEEDED.owner), userOf(SEEDED.owner), [clientId, ...WINDOW]),
    ).toEqual({ count: 5 });
  });

  it('gives an on-schedule practitioner the owner’s count, a colleague’s visits included', async () => {
    const owner = await countAs(rolesOf(SEEDED.owner), userOf(SEEDED.owner), [clientId, ...WINDOW]);
    const practitioner = await countAs(rolesOf(SEEDED.practitioner), userOf(SEEDED.practitioner), [
      clientId,
      ...WINDOW,
    ]);
    expect(owner).toEqual({ count: 5 });
    expect(practitioner).toEqual(owner);
    // Row security alone would show her one visit: her own.
    const own = await h.asPerson(SEEDED.practitioner, async (db) => {
      await db.query('set local role app_role');
      await db.query("select set_config('app.tenant_id', $1, true)", [h.data.tenant.id]);
      const { rows } = await db.query<{ n: string }>(
        "select count(*)::text as n from session where client_id = $1 and status = 'completed'",
        [clientId],
      );
      return Number(rows[0]?.n);
    });
    expect(own).toBeLessThan(5);
  });

  it('counts a check-in just after midnight in Dubai on the Dubai day', async () => {
    const owner = [rolesOf(SEEDED.owner), userOf(SEEDED.owner)] as const;
    expect(await countAs(...owner, [clientId, '2026-09-19', '2026-09-21'])).toEqual({ count: 1 });
    expect(await countAs(...owner, [clientId, '2026-09-18', '2026-09-20'])).toEqual({ count: 0 });
  });

  it('answers 0 when the bounds hold no day', async () => {
    const owner = [rolesOf(SEEDED.owner), userOf(SEEDED.owner)] as const;
    expect(await countAs(...owner, [clientId, '2026-09-20', '2026-09-20'])).toEqual({ count: 0 });
    expect(await countAs(...owner, [clientId, '2026-09-28', '2026-09-14'])).toEqual({ count: 0 });
  });

  it('agrees with the domain’s rule on the same fixture', async () => {
    const { rows } = await h.owner.query<{ status: string; closed: boolean; day: string }>(
      'select status::text as status, closed_at is not null as closed, ' +
        "to_char(checked_in_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') as day " +
        'from session where client_id = $1',
      [clientId],
    );
    const visits: VisitForCount[] = rows.map((row) => ({ clientId, ...row }));
    for (const [after, before] of [
      WINDOW,
      ['2026-09-19', '2026-09-21'],
      ['2026-09-15', '2026-09-27'],
      ['2026-09-01', '2026-10-01'],
    ] as const) {
      const reference = countCompletedSessions(
        visits,
        clientId,
        sessionWindow(after, before, '2026-09-30'),
      );
      expect(
        await countAs(rolesOf(SEEDED.owner), userOf(SEEDED.owner), [clientId, after, before]),
        `${after} to ${before}`,
      ).toEqual({ count: reference });
    }
  });
});

describe('who is refused, never answered 0', () => {
  it('refuses an admin, finance, a household and an off-schedule practitioner', async () => {
    for (const [roles, actor, who] of [
      ['admin', userOf(SEEDED.admin), 'admin'],
      ['finance', userOf(SEEDED.admin), 'finance'],
      ['client_contact', householdUserId, 'household'],
      ['practitioner', userOf(SEEDED.otherPractitioner), 'off-schedule practitioner'],
    ] as const) {
      expect(await countAs(roles, actor, [clientId, ...WINDOW]), who).toEqual({
        code: INSUFFICIENT_PRIVILEGE,
      });
    }
  });

  it('refuses an erased client, the owner too', async () => {
    expect(
      await countAs(rolesOf(SEEDED.owner), userOf(SEEDED.owner), [erasedClientId, ...WINDOW]),
    ).toEqual({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('refuses another practice’s client, and a practice asking of ours', async () => {
    expect(
      await countAs(rolesOf(SEEDED.owner), userOf(SEEDED.owner), [CLIENT_B, ...WINDOW]),
    ).toEqual({ code: INSUFFICIENT_PRIVILEGE });
    expect(await countAs('owner', OWNER_B, [clientId, ...WINDOW], TENANT_B)).toEqual({
      code: INSUFFICIENT_PRIVILEGE,
    });
  });
});

describe('how it is declared', () => {
  it('runs as its definer with a pinned search path, for the API role alone', async () => {
    const { rows } = await h.owner.query<{
      prosecdef: boolean;
      proconfig: string[] | null;
      provolatile: string;
      from_public: boolean;
      app_role: boolean;
    }>(
      'select p.prosecdef, p.proconfig, p.provolatile, ' +
        "has_function_privilege('public', p.oid, 'execute') as from_public, " +
        "has_function_privilege('app_role', p.oid, 'execute') as app_role " +
        "from pg_proc p where p.oid = 'app.completed_session_count(uuid, date, date)'::regprocedure",
    );
    expect(rows[0]).toEqual({
      prosecdef: true,
      proconfig: ['search_path=pg_catalog, pg_temp'],
      provolatile: 's',
      from_public: false,
      app_role: true,
    });
    for (const role of ['anon', 'authenticated', 'mcwellness_api']) {
      const exists = await h.owner.query('select 1 from pg_roles where rolname = $1', [role]);
      if (exists.rowCount === 0) continue;
      const granted = await h.owner.query<{ ok: boolean }>(
        "select has_function_privilege($1, 'app.completed_session_count(uuid, date, date)', " +
          "'execute') as ok from pg_roles where rolname = $1 and not rolinherit",
        [role],
      );
      // A role that does not inherit app_role holds nothing of its own here.
      if (granted.rows[0]) expect(granted.rows[0].ok, role).toBe(false);
    }
  });
});
