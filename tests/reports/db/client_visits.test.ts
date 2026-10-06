import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedClient, seedTenant } from '../../db/helpers';
import { clientToWriteAbout, householdOf, visitAt } from './qeeg-signing-support';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * `app.client_completed_visits` (migration 606): a client's completed visits,
 * as a progress report reads them, the same whoever of the practice writes the
 * report. The operator's decision of 6 October 2026: the practice has one
 * practitioner and her family help, so a progress report covers every visit,
 * not only those row security shows the person writing it. Behind the same
 * gate as drafting a report, and refused, never answered empty, to anyone else.
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
let erasedClientId: string;
let householdUserId: string;

/** The visits' days, asked as the API role with these roles, this actor and this tenant. */
async function visitsAs(
  roles: string,
  actorId: string,
  client: string,
  tenantId: string = h.data.tenant.id,
): Promise<{ days: string[] } | { code: string }> {
  await h.owner.query('begin');
  try {
    await h.owner.query('set local role app_role');
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', $3, true)",
      [tenantId, actorId, roles],
    );
    const { rows } = await h.owner.query<{ on_day: string }>(
      "select on_day from app.client_completed_visits($1::uuid, 'Asia/Dubai')",
      [client],
    );
    return { days: rows.map((row) => row.on_day) };
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

beforeAll(async () => {
  h = await startHarness(NOW);
  const client = clientToWriteAbout(h);
  clientId = client.id;
  await h.onSchedule(client.index, SEEDED.practitioner);
  const others = h.data.clients
    .map((c, at) => ({ c, at }))
    .filter(({ c, at }) => c.status === 'active' && at !== client.index);
  erasedClientId = h.clientId(others[0]?.at ?? -1);

  // Completed: one by the owner, one by a colleague, one by the practitioner
  // who asks. Not completed: a no-show.
  await visitAt(h, clientId, '2026-09-15T09:00:00+04:00', { by: SEEDED.owner });
  await visitAt(h, clientId, '2026-09-16T09:00:00+04:00', { by: SEEDED.otherPractitioner });
  await visitAt(h, clientId, '2026-09-18T09:00:00+04:00', { by: SEEDED.practitioner });
  await visitAt(h, clientId, '2026-09-22T09:00:00+04:00', { status: 'no_show' });
  await visitAt(h, erasedClientId, '2026-09-24T09:00:00+04:00');
  await h.owner.query("update client set status = 'erased' where id = $1", [erasedClientId]);

  householdUserId = (
    await h.owner.query<{ id: string }>('select id from app_user where auth_id = $1', [
      await householdOf(h, clientId, 12),
    ])
  ).rows[0]?.id as string;

  await seedTenant(h.owner, TENANT_B, OWNER_B, 'Practice B');
  await seedClient(h.owner, TENANT_B, CLIENT_B, OWNER_B, 'Summit');
}, 240_000);

afterAll(async () => {
  await h.close();
});

describe('the visits a progress report reads', () => {
  it('gives an on-schedule practitioner every completed visit, a colleague’s included', async () => {
    const owner = await visitsAs(rolesOf(SEEDED.owner), userOf(SEEDED.owner), clientId);
    const practitioner = await visitsAs(
      rolesOf(SEEDED.practitioner),
      userOf(SEEDED.practitioner),
      clientId,
    );
    expect(practitioner).toEqual(owner);
    expect(owner).toMatchObject({
      days: expect.arrayContaining(['2026-09-15', '2026-09-16', '2026-09-18']),
    });
    expect((owner as { days: string[] }).days).not.toContain('2026-09-22');
  });
});

describe('who is refused, never answered empty', () => {
  it('refuses an admin, a household and an off-schedule practitioner', async () => {
    for (const [roles, actor, who] of [
      ['admin', userOf(SEEDED.admin), 'admin'],
      ['client_contact', householdUserId, 'household'],
      ['practitioner', userOf(SEEDED.otherPractitioner), 'off-schedule practitioner'],
    ] as const) {
      expect(await visitsAs(roles, actor, clientId), who).toEqual({ code: INSUFFICIENT_PRIVILEGE });
    }
  });

  it('refuses an erased client, and another practice’s', async () => {
    expect(await visitsAs(rolesOf(SEEDED.owner), userOf(SEEDED.owner), erasedClientId)).toEqual({
      code: INSUFFICIENT_PRIVILEGE,
    });
    expect(await visitsAs('owner', OWNER_B, clientId, TENANT_B)).toEqual({
      code: INSUFFICIENT_PRIVILEGE,
    });
  });
});

describe('how it is declared', () => {
  it('runs as its definer with a pinned search path, for the API role alone', async () => {
    const { rows } = await h.owner.query<{
      prosecdef: boolean;
      proconfig: string[] | null;
      from_public: boolean;
      app_role: boolean;
    }>(
      'select p.prosecdef, p.proconfig, ' +
        "has_function_privilege('public', p.oid, 'execute') as from_public, " +
        "has_function_privilege('app_role', p.oid, 'execute') as app_role " +
        "from pg_proc p where p.oid = 'app.client_completed_visits(uuid, text)'::regprocedure",
    );
    expect(rows[0]).toEqual({
      prosecdef: true,
      proconfig: ['search_path=pg_catalog, pg_temp'],
      from_public: false,
      app_role: true,
    });
  });
});
