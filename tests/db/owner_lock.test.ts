import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  seedClient,
  seedTenant,
  seedUser,
} from './helpers';
import type pg from 'pg';

/**
 * The owner lock, and the one way a working role is taken away (migration 923;
 * docs/superpowers/specs/2026-09-21-team-profiles-and-access-design.md
 * sections 3, 4 and 5, the operator's decisions of 21 September 2026).
 *
 * Two owners, and "cannot be revoked by anyone" includes each of them. The
 * first four cases run with no role assumed at all — as the migrating
 * superuser, the strongest caller this database has — because a lock that only
 * binds the API role is a courtesy, not a lock.
 *
 * Every person is named from db/seed/names.ts and every id is synthetic.
 */

/** Tenant A's second owner, who also holds finance: the row the lock is about. */
const SECOND_OWNER = '00000001-0000-4000-8000-0000000000d1';
const ADMIN = '00000001-0000-4000-8000-0000000000d2';
/** A colleague with two working roles, so one of them can be taken away. */
const FINANCE = '00000001-0000-4000-8000-0000000000d3';
const HOUSEHOLD = '00000001-0000-4000-8000-0000000000d4';
/** The same shape of colleague, in another practice entirely. */
const ELSEWHERE = '00000001-0000-4000-8000-0000000000d5';
/** The row an admin is allowed to insert: a person with no role yet. */
const INVITED = '00000001-0000-4000-8000-0000000000d6';
/** The sign-in an owner arrives with, and the one nobody may move it to. */
const FIRST_SIGN_IN = '00000001-0000-4000-8000-0000000000d9';
const MOVED_SIGN_IN = '00000001-0000-4000-8000-0000000000da';
/** A household whose contact signs in as the second owner (the erasure case). */
const CLIENT = '00000001-0000-4000-8000-0000000000db';
const CLIENT_CONTACT = '00000001-0000-4000-8000-0000000000dc';
const ERASURE_REQUEST = '00000001-0000-4000-8000-0000000000dd';
const OWNER_PHONE = '+971500000051';

let db: pg.Client;

/**
 * app.actor_id alone, transaction-local: who is asking. asApiRole sets the
 * tenant and the roles and deliberately not this, and both triggers and
 * app.revoke_staff_role read it.
 */
async function setActor(client: pg.Client, actorId: string): Promise<void> {
  await client.query("select set_config('app.actor_id', $1, true)", [actorId]);
}

beforeAll(async () => {
  db = await freshDatabase();
  await seedTenant(db, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await seedTenant(db, IDS.tenantB, IDS.ownerB, 'Other Studio');
  await seedUser(db, {
    id: SECOND_OWNER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Hazel Lagoon',
    roles: ['owner', 'finance'],
  });
  await seedUser(db, {
    id: ADMIN,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Iris Harbour',
    roles: ['admin'],
  });
  await seedUser(db, {
    id: FINANCE,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Pearl Cove',
    roles: ['finance', 'practitioner'],
  });
  await seedUser(db, {
    id: HOUSEHOLD,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Cedar Meadow',
    roles: ['client_contact'],
  });
  await seedUser(db, {
    id: ELSEWHERE,
    tenantId: IDS.tenantB,
    authId: null,
    displayName: 'Rowan Ridge',
    roles: ['finance', 'practitioner'],
  });

  // A household whose only contact signs in on the second owner's account.
  // Nothing about the practice's own staff is meant to be reachable this way;
  // it is the shape app.erase_client walks, and the last case below is what it
  // meets now.
  await seedClient(db, IDS.tenantA, CLIENT, IDS.ownerA, 'Valley');
  await db.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent, user_id) ' +
      "values ($1, $2, $3, 'self', true, $4)",
    [CLIENT_CONTACT, IDS.tenantA, CLIENT, SECOND_OWNER],
  );
  await db.query(
    'insert into erasure_request (id, tenant_id, client_id, reason, created_by) ' +
      'values ($1, $2, $3, $4, $5)',
    [
      ERASURE_REQUEST,
      IDS.tenantA,
      CLIENT,
      'The household asked for their record to be removed.',
      IDS.ownerA,
    ],
  );

  // asApiRole and rejectsWith use savepoints, which Postgres only allows inside
  // an explicit transaction block (the pattern tests/db/rls.test.ts uses): one
  // transaction for the whole file, rolled back at the end.
  await db.query('begin');
});

afterAll(async () => {
  await db.query('rollback');
  await db.end();
});

// The lock holds for every caller: these run as the SUPERUSER, not as app_role.
describe('an ownership row, and the person who holds it', () => {
  it('refuses any update or delete of an ownership row, for every caller', async () => {
    await rejectsWith(db, '42501', "delete from user_role where user_id = $1 and role = 'owner'", [
      SECOND_OWNER,
    ]);
    await rejectsWith(
      db,
      '42501',
      "update user_role set role = 'admin' where user_id = $1 and role = 'owner'",
      [SECOND_OWNER],
    );
  });

  it("refuses to suspend or archive an owner, or to move an owner's sign-in", async () => {
    // Linking a sign-in for the first time is how an owner arrives, so this one
    // stands outside a savepoint: the refusals below are of a MOVE.
    await db.query('update app_user set auth_id = $1 where id = $2', [FIRST_SIGN_IN, SECOND_OWNER]);
    await rejectsWith(db, '42501', "update app_user set status = 'suspended' where id = $1", [
      SECOND_OWNER,
    ]);
    await rejectsWith(db, '42501', "update app_user set status = 'archived' where id = $1", [
      SECOND_OWNER,
    ]);
    await rejectsWith(db, '42501', 'update app_user set auth_id = $1 where id = $2', [
      MOVED_SIGN_IN,
      SECOND_OWNER,
    ]);
  });

  it("lets an owner change their own name and refuses the other owner's", async () => {
    await setActor(db, IDS.ownerA);
    await rejectsWith(
      db,
      '42501',
      "update app_user set display_name = 'Somebody Else' where id = $1",
      [SECOND_OWNER],
    );
    await setActor(db, SECOND_OWNER);
    expect(
      (
        await db.query("update app_user set display_name = 'Hazel Lagoon' where id = $1", [
          SECOND_OWNER,
        ])
      ).rowCount,
    ).toBe(1);
    // That name is the one she already has, and the guard never reaches the
    // actor for a column that did not move. One line more with a value that
    // really changes, so this case would fail if the actor arm went.
    expect(
      (await db.query('update app_user set phone = $2 where id = $1', [SECOND_OWNER, OWNER_PHONE]))
        .rowCount,
    ).toBe(1);
    await setActor(db, IDS.ownerA);
    await rejectsWith(db, '42501', 'update app_user set phone = null where id = $1', [
      SECOND_OWNER,
    ]);
  });

  it('leaves a colleague who is not an owner editable and suspendable', async () => {
    expect(
      (await db.query("update app_user set status = 'suspended' where id = $1", [FINANCE]))
        .rowCount,
    ).toBe(1);
    await db.query("update app_user set status = 'active' where id = $1", [FINANCE]);
  });
});

// The revoke function, as app_role.
describe('app.revoke_staff_role', () => {
  it('removes a working role for an owner and leaves a delete in the trail', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        await setActor(db, IDS.ownerA);
        const { rows } = await db.query<{ gone: boolean }>(
          "select app.revoke_staff_role($1, 'practitioner') as gone",
          [FINANCE],
        );
        expect(rows[0]?.gone).toBe(true);
        const left = await db.query(
          "select 1 from user_role where user_id = $1 and role = 'practitioner'",
          [FINANCE],
        );
        expect(left.rowCount).toBe(0);
        // Deleted, not marked: app.audit_row keeps the old values, so the trail
        // is where the role that was taken away still reads.
        const trail = await db.query<{ n: string }>(
          "select count(*)::text as n from audit_log where action = 'delete' " +
            "and entity_type = 'user_role' and actor_id = $2 " +
            "and old_values ->> 'user_id' = $1 and old_values ->> 'role' = 'practitioner'",
          [FINANCE, IDS.ownerA],
        );
        expect(trail.rows[0]?.n).toBe('1');
      },
      'owner',
    );
  });

  it('answers false, and changes nothing, for a role the person does not hold', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        await setActor(db, IDS.ownerA);
        const { rows } = await db.query<{ gone: boolean }>(
          "select app.revoke_staff_role($1, 'admin') as gone",
          [FINANCE],
        );
        expect(rows[0]?.gone).toBe(false);
        const kept = await db.query<{ role: string }>(
          'select role::text as role from user_role where user_id = $1 order by 1',
          [FINANCE],
        );
        expect(kept.rows.map((row) => row.role)).toEqual(['finance', 'practitioner']);
      },
      'owner',
    );
  });

  it('refuses an admin', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        await setActor(db, ADMIN);
        await rejectsWith(db, '42501', "select app.revoke_staff_role($1, 'practitioner')", [
          FINANCE,
        ]);
      },
      'admin',
    );
    expect(
      (
        await db.query("select 1 from user_role where user_id = $1 and role = 'practitioner'", [
          FINANCE,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it('refuses ownership and a household contact as the role', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        await setActor(db, IDS.ownerA);
        await rejectsWith(db, '42501', "select app.revoke_staff_role($1, 'owner')", [SECOND_OWNER]);
        await rejectsWith(db, '42501', "select app.revoke_staff_role($1, 'client_contact')", [
          HOUSEHOLD,
        ]);
      },
      'owner',
    );
  });

  it('refuses an owner as the target, working roles included', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        await setActor(db, IDS.ownerA);
        await rejectsWith(db, '42501', "select app.revoke_staff_role($1, 'finance')", [
          SECOND_OWNER,
        ]);
        expect(
          (
            await db.query("select 1 from user_role where user_id = $1 and role = 'finance'", [
              SECOND_OWNER,
            ])
          ).rowCount,
        ).toBe(1);
      },
      'owner',
    );
  });

  it('refuses yourself', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        // The actor is the target, and is deliberately somebody who is not an
        // owner: the rule about yourself is then the only one that can refuse
        // this, because 'practitioner' would leave 'finance' standing.
        await setActor(db, FINANCE);
        await rejectsWith(db, '42501', "select app.revoke_staff_role($1, 'practitioner')", [
          FINANCE,
        ]);
        // And an owner does not strip their own working role either.
        await setActor(db, SECOND_OWNER);
        await rejectsWith(db, '42501', "select app.revoke_staff_role($1, 'finance')", [
          SECOND_OWNER,
        ]);
      },
      'owner',
    );
  });

  it('refuses the last working role', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        await setActor(db, IDS.ownerA);
        const { rows } = await db.query<{ gone: boolean }>(
          "select app.revoke_staff_role($1, 'practitioner') as gone",
          [FINANCE],
        );
        expect(rows[0]?.gone).toBe(true);
        await rejectsWith(db, '42501', "select app.revoke_staff_role($1, 'finance')", [FINANCE]);
        expect(
          (
            await db.query("select 1 from user_role where user_id = $1 and role = 'finance'", [
              FINANCE,
            ])
          ).rowCount,
        ).toBe(1);
      },
      'owner',
    );
  });

  it('refuses a colleague in another practice', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        await setActor(db, IDS.ownerA);
        await rejectsWith(db, '42501', "select app.revoke_staff_role($1, 'practitioner')", [
          ELSEWHERE,
        ]);
      },
      'owner',
    );
    // Read outside the tenant A block, because tenant B's rows are invisible
    // inside it: the other practice's colleague still holds both roles.
    expect(
      (await db.query('select 1 from user_role where user_id = $1', [ELSEWHERE])).rowCount,
    ).toBe(2);
  });
});

// role_guard.sql, as app_role.
describe('who writes to app_user and user_role', () => {
  it('lets an admin invite and suspend a household contact, and nothing else on these tables', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        // A row with no role is inert, and inviting a household starts with one.
        await db.query('insert into app_user (id, tenant_id, display_name) values ($1, $2, $3)', [
          INVITED,
          IDS.tenantA,
          'Sage Orchard',
        ]);
        await db.query(
          "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'client_contact')",
          [IDS.tenantA, INVITED],
        );
        await rejectsWith(
          db,
          '42501',
          "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'finance')",
          [IDS.tenantA, INVITED],
        );
        // Suspending that household's access is the other half of the carve-out.
        expect(
          (await db.query("update app_user set status = 'suspended' where id = $1", [HOUSEHOLD]))
            .rowCount,
        ).toBe(1);
        // A member of staff's row is not an admin's to edit: row security hides
        // it, so this is a silent nothing rather than a refusal.
        expect(
          (
            await db.query("update app_user set display_name = 'Sage Ridge' where id = $1", [
              FINANCE,
            ])
          ).rowCount,
        ).toBe(0);
      },
      'admin',
    );
  });

  it('lets an owner do all of it', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        await db.query(
          "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'finance')",
          [IDS.tenantA, ADMIN],
        );
        expect(
          (
            await db.query("update app_user set display_name = 'Pearl Ridge' where id = $1", [
              FINANCE,
            ])
          ).rowCount,
        ).toBe(1);
      },
      'owner',
    );
  });
});

describe('an erasure that reaches a member of staff', () => {
  // This is a loud refusal where there used to be a silent, terminal archive of
  // the owner's sign-in: app.erase_client archives and unlinks the app_user of
  // every contact of the erased household (migration 964), with no check that
  // the account belongs to a member of staff. The erasure rule learning to skip
  // staff accounts is its own round (operator approved it on 21 September 2026
  // as the round after this one).
  it("refuses an erasure that would archive an owner's sign-in, and changes nothing", async () => {
    let seen: { code?: string; message?: string } = {};
    await db.query('savepoint erasure');
    try {
      await db.query(
        "select set_config('app.tenant_id', $1, true), " +
          "set_config('app.actor_roles', 'owner', true)",
        [IDS.tenantA],
      );
      await db.query('select app.erase_client($1, $2)', [CLIENT, ERASURE_REQUEST]);
    } catch (error) {
      seen = error as { code?: string; message?: string };
    } finally {
      await db.query('rollback to savepoint erasure');
    }
    expect(seen.code).toBe('42501');
    // Named, so this case cannot pass on some other refusal — the tenant check
    // inside app.erase_client raises 42501 too.
    expect(seen.message).toContain('an owner is not suspended or archived');

    const owner = await db.query<{ status: string; display_name: string }>(
      'select status::text as status, display_name from app_user where id = $1',
      [SECOND_OWNER],
    );
    expect(owner.rows[0]).toEqual({ status: 'active', display_name: 'Hazel Lagoon' });
    const household = await db.query<{ status: string }>(
      'select status::text as status from client where id = $1',
      [CLIENT],
    );
    expect(household.rows[0]?.status).not.toBe('erased');
  });
});

describe('the trail these cases wrote', () => {
  it('leaves the audit chain intact', async () => {
    expect(
      (await db.query('select app.verify_audit_chain() as broken')).rows[0]?.broken,
    ).toBeNull();
  });
});
