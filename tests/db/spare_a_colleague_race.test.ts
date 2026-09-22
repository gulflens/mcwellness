import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, freshDatabase, seedClient, seedTenant, seedUser } from './helpers';
import { connect, requireDatabaseUrl } from '../../db/runner/apply';
import type pg from 'pg';

/**
 * A revoke and an erasure on the same colleague at once (trunk round 59, item 3
 * of round 58's "found beside it").
 *
 * Before this round the two took two rows in opposite orders:
 * app.revoke_staff_role locked the colleague's app_user row and then, through
 * the audit trigger on its delete, the audit chain's; app.erase_client wrote
 * its first audited row — the client's — and so took the chain first, and then
 * archived the colleague's app_user row. On a person who is both a household's
 * contact and a member of staff that is a deadlock, and Postgres aborts one of
 * them whole (40P01).
 *
 * Since migration 968 an erasure never touches a colleague's app_user row at
 * all, so there is no second row for the two to disagree about. This file
 * arranges exactly the old geometry — the chain held by the erasure's side
 * first, the app_user row held by the revoke's side — and asserts both finish.
 *
 * It needs committed data and three connections of its own, so it is a file
 * of its own rather than a case in spare_a_colleague.test.ts (round 58's
 * review asked for exactly that). Every person is named from db/seed/names.ts
 * and every id is synthetic.
 */

/** Two working roles, a portal role, and a household that links to them. */
const RACER = '00000003-0000-4000-8000-0000000000e1';
const CLIENT = '00000003-0000-4000-8000-0000000000f1';
const CONTACT = '00000003-0000-4000-8000-0000000000f2';
const REQUEST = '00000003-0000-4000-8000-0000000000f3';

let db: pg.Client;

/**
 * A connection of its own, in a transaction, stamped the way the API stamps
 * one: the tenant, the actor, the roles and a request id, transaction-local.
 * As the superuser rather than app_role, because app.erase_client is security
 * definer either way and the case is about locks, not policies.
 */
async function stamped(actorId: string): Promise<pg.Client> {
  const client = await connect(requireDatabaseUrl());
  await client.query('begin');
  await client.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
      "set_config('app.actor_roles', 'owner', true), set_config('app.request_id', $3, true)",
    [IDS.tenantA, actorId, REQUEST],
  );
  return client;
}

/** Polls pg_locks until the backend is waiting on a lock, or gives up. */
async function waitUntilBlocked(pid: number): Promise<boolean> {
  for (let i = 0; i < 100; i += 1) {
    const { rows } = await db.query<{ waiting: boolean }>(
      'select exists (select 1 from pg_locks where pid = $1 and not granted) as waiting',
      [pid],
    );
    if (rows[0]?.waiting) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

beforeAll(async () => {
  db = await freshDatabase();
  await seedTenant(db, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await seedUser(db, {
    id: RACER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Willow Bay',
    roles: ['finance', 'practitioner', 'client_contact'],
  });
  await seedClient(db, IDS.tenantA, CLIENT, IDS.ownerA, 'Creek');
  await db.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent, user_id) ' +
      "values ($1, $2, $3, 'self', true, $4)",
    [CONTACT, IDS.tenantA, CLIENT, RACER],
  );
  await db.query(
    'insert into erasure_request (id, tenant_id, client_id, reason, created_by) ' +
      'values ($1, $2, $3, $4, $5)',
    [
      REQUEST,
      IDS.tenantA,
      CLIENT,
      'The household asked for their record to be removed.',
      IDS.ownerA,
    ],
  );
});

afterAll(async () => {
  await db.end();
});

describe('an erasure and a revoke on the same colleague at once', () => {
  it('both finish: the erasure never asks for the row the revoke is holding', async () => {
    const erasing = await stamped(IDS.ownerA);
    const revoking = await stamped(IDS.ownerA);
    try {
      const { rows: pid } = await revoking.query<{ pid: number }>('select pg_backend_pid() as pid');
      const revokingPid = pid[0]?.pid as number;

      // The erasure's side takes the audit chain first, with an ordinary
      // audited write on the household it is about to erase — which is what
      // app.erase_client's own first statement does a moment later.
      await erasing.query("update client set referral_source = 'walk-in' where id = $1", [CLIENT]);

      // The revoke takes the colleague's app_user row and then, through the
      // audit trigger on its delete, asks for the chain — and waits, because
      // the erasure's side holds it. Not awaited: the point is where it stops.
      const revoked = revoking.query<{ gone: boolean }>(
        "select app.revoke_staff_role($1, 'practitioner') as gone",
        [RACER],
      );
      revoked.catch(() => undefined);
      expect(await waitUntilBlocked(revokingPid)).toBe(true);

      // Now the erasure. Before 968 it archived the colleague's app_user row —
      // the row the revoke is holding — and one of the two died of 40P01. Now
      // it spares the colleague, finishes, and commits, and the revoke goes on.
      const { rows } = await erasing.query<{ summary: Record<string, unknown> }>(
        'select app.erase_client($1, $2) as summary',
        [CLIENT, REQUEST],
      );
      expect(rows[0]?.summary).toMatchObject({ portalAccountsArchived: 0, staffAccountsSpared: 1 });
      await erasing.query('commit');

      const gone = await revoked;
      expect(gone.rows[0]?.gone).toBe(true);
      await revoking.query('commit');

      // Both acts stand: practitioner taken by the revoke, client_contact
      // dropped by the erasure, finance and the sign-in row untouched.
      const { rows: roles } = await db.query<{ roles: string[] }>(
        'select array_agg(role::text order by role::text) as roles from user_role where user_id = $1',
        [RACER],
      );
      expect(roles[0]?.roles).toEqual(['finance']);
      const { rows: account } = await db.query<{ status: string; display_name: string }>(
        'select status::text as status, display_name from app_user where id = $1',
        [RACER],
      );
      expect(account[0]).toEqual({ status: 'active', display_name: 'Willow Bay' });
      const { rows: chain } = await db.query<{ broken: string | null }>(
        'select app.verify_audit_chain()::text as broken',
      );
      expect(chain[0]?.broken).toBeNull();
    } finally {
      await erasing.end().catch(() => undefined);
      await revoking.end().catch(() => undefined);
    }
  });
});
