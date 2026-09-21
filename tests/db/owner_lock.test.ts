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
import { connect, requireDatabaseUrl } from '../../db/runner/apply';
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
/**
 * A member of staff who is also a contact of their own household: one working
 * role and client_contact beside it. Every refusal but the working-role
 * whitelist would let a revoke of their client_contact row through.
 */
const BOTH = '00000001-0000-4000-8000-0000000000d7';
/** Two working roles and nothing else touches them: the two-at-once case. */
const RACER = '00000001-0000-4000-8000-0000000000d8';
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

/**
 * Expects the statement to fail with 42501 AND with the message of the rule it
 * is named for, inside a savepoint so the transaction stays usable.
 *
 * app.revoke_staff_role raises the same SQLSTATE seven times over, so a case
 * that asserts the code alone can be refused by a rule it was not written
 * about and still pass — which is how the working-role whitelist came to be
 * covered by two assertions that neither of them actually needed it for
 * (review of this task, finding M2). Where the rule matters, the case says
 * which one spoke.
 */
async function refusesWith(
  client: pg.Client,
  phrase: string,
  sql: string,
  params: unknown[] = [],
): Promise<void> {
  await client.query('savepoint expect_refusal');
  let seen: { code?: string; message?: string } = {};
  try {
    await client.query(sql, params);
  } catch (error) {
    seen = error as { code?: string; message?: string };
  } finally {
    await client.query('rollback to savepoint expect_refusal');
  }
  expect(seen.code, sql).toBe('42501');
  expect(seen.message, sql).toContain(phrase);
}

/**
 * A connection of its own, in a transaction, stamped the way the API stamps
 * one: the role assumed, and the tenant, actor and roles set transaction-local
 * (.claude/rules/compliance.md).
 */
async function stampedConnection(actorId: string): Promise<pg.Client> {
  const client = await connect(requireDatabaseUrl());
  await client.query('begin');
  await client.query('set local role app_role');
  await client.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
      "set_config('app.actor_roles', 'owner', true)",
    [IDS.tenantA, actorId],
  );
  return client;
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
    displayName: 'Pearl Quarry',
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
  await seedUser(db, {
    id: BOTH,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Laurel Summit',
    roles: ['practitioner', 'client_contact'],
  });
  // Seeded here with everything else, and so already committed: the two-at-once
  // case below runs on its own connections and cannot see this file's
  // transaction. Nothing else in this file touches this person, because that
  // case really does delete one of these two rows.
  await seedUser(db, {
    id: RACER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Juniper Creek',
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

  it("refuses to move an owner's row to another practice", async () => {
    // The identity columns were guarded and the row's own place was not: a row
    // moved to another tenant takes its ownership with it, because the trigger
    // that reads "does this row hold ownership" reads user_role by
    // (user_id, tenant_id) and would then find nothing — so the lock would
    // unlock itself. Named, because three other rules in this trigger raise the
    // same SQLSTATE. Found by the round's schema review.
    await refusesWith(
      db,
      "an owner's row does not move",
      'update app_user set tenant_id = $1 where id = $2',
      [IDS.tenantB, SECOND_OWNER],
    );
    expect(
      (
        await db.query<{ tenant_id: string }>('select tenant_id from app_user where id = $1', [
          SECOND_OWNER,
        ])
      ).rows[0]?.tenant_id,
    ).toBe(IDS.tenantA);
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
        await refusesWith(
          db,
          'only an owner takes a role away',
          "select app.revoke_staff_role($1, 'practitioner')",
          [FINANCE],
        );
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
        await refusesWith(db, 'not a working role', "select app.revoke_staff_role($1, 'owner')", [
          SECOND_OWNER,
        ]);
        await refusesWith(
          db,
          'not a working role',
          "select app.revoke_staff_role($1, 'client_contact')",
          [HOUSEHOLD],
        );
      },
      'owner',
    );
  });

  it('refuses a null role, which is not a working role either', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        await setActor(db, IDS.ownerA);
        // A null role is not a working role. Without the null arm the whitelist
        // reads as unknown rather than false, every rule below it reads the same
        // way, and the function reaches its own delete and answers `false` — a
        // caller told nothing happened by the same word that says a role was
        // already absent. Found by the round's schema review.
        await refusesWith(db, 'not a working role', 'select app.revoke_staff_role($1, null)', [
          FINANCE,
        ]);
        expect(
          (await db.query('select 1 from user_role where user_id = $1', [FINANCE])).rowCount,
        ).toBe(2);
      },
      'owner',
    );
  });

  it('refuses a role outside the four even when every other rule would allow it', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        await setActor(db, IDS.ownerA);
        // Laurel Summit holds practitioner AND client_contact. Not an owner,
        // not the actor, in this practice, and taking client_contact away
        // would still leave a working role standing — so the whitelist is the
        // only rule that can refuse this, and the message proves it is the one
        // that did. The two assertions in the case above are both caught by
        // the whitelist first and would be caught by another rule without it,
        // which is why this third person exists.
        await refusesWith(
          db,
          'not a working role',
          "select app.revoke_staff_role($1, 'client_contact')",
          [BOTH],
        );
        expect(
          (
            await db.query(
              "select 1 from user_role where user_id = $1 and role = 'client_contact'",
              [BOTH],
            )
          ).rowCount,
        ).toBe(1);
      },
      'owner',
    );
  });

  it("takes the database's word for who is an owner, not the session's", async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        // app.actor_roles and app.actor_id are stamped separately by the
        // middleware and can disagree. This caller's roles say owner and their
        // user_role rows say admin; user_role is what decides, so the colleague
        // keeps both roles. Without that, the session's own word would be the
        // whole boundary of the one function that can remove access.
        await setActor(db, ADMIN);
        await refusesWith(
          db,
          'only an owner takes a role away',
          "select app.revoke_staff_role($1, 'practitioner')",
          [FINANCE],
        );
        // And nobody at all when the actor is not stamped, which is its own
        // refusal rather than a fall-through to the line above.
        await db.query("select set_config('app.actor_id', '', true)");
        await refusesWith(
          db,
          'without being named',
          "select app.revoke_staff_role($1, 'practitioner')",
          [FINANCE],
        );
        expect(
          (
            await db.query("select 1 from user_role where user_id = $1 and role = 'practitioner'", [
              FINANCE,
            ])
          ).rowCount,
        ).toBe(1);
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
        // Only an owner reaches this rule at all now, so the actor and the
        // target are the same real owner taking away her own second role. The
        // rule about an owner as the target would refuse this too, which is
        // why the message is asserted: it names the rule that spoke first, and
        // it would change if the rule about yourself went.
        await setActor(db, SECOND_OWNER);
        await refusesWith(
          db,
          'nobody changes their own access',
          "select app.revoke_staff_role($1, 'finance')",
          [SECOND_OWNER],
        );
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

  it('lets no caller under the API role grant ownership, an owner included', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        // Until the round's security review, `owner_grants_owner` admitted an
        // ownership row from an owner, and one TypeScript line — `isStaffRole`,
        // in app/api/team/roles.ts — was the whole barrier between a screen and
        // a permanent grant of full access. The row it would write can never be
        // updated or deleted by anybody, so the floor is unconditional now:
        // ownership is granted by an audited data step and by nothing the API
        // role can reach.
        await rejectsWith(
          db,
          '42501',
          "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'owner')",
          [IDS.tenantA, ADMIN],
        );
        // And an existing row is not turned into one, which is the same act from
        // the other side. `guard_owner_role` says nothing here: it judges OLD,
        // and OLD is a finance row.
        await rejectsWith(
          db,
          '42501',
          "update user_role set role = 'owner' where user_id = $1 and role = 'finance'",
          [FINANCE],
        );
      },
      'owner',
    );
  });

  it('leaves the audited data step able to grant it, which is where ownership comes from', async () => {
    // The runbook's own path (docs/RUNBOOK/second-owner.md): a `do` block at a
    // psql prompt runs as the connecting role and never `set local role
    // app_role`, so no policy is in the way. Rolled back, because every case
    // after this one asks what an admin may do.
    await db.query('savepoint data_step');
    try {
      expect(
        (
          await db.query(
            "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'owner')",
            [IDS.tenantA, ADMIN],
          )
        ).rowCount,
      ).toBe(1);
    } finally {
      await db.query('rollback to savepoint data_step');
    }
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

describe('two owners revoking from the same colleague at once', () => {
  // This case needs data that is really committed and two more connections, so
  // this file's own transaction is closed for it and reopened afterwards. That
  // is not tidiness: every audit insert in the database queues on one row of
  // app.audit_chain until the previous writer commits (070_audit_log.sql), and
  // this file's transaction has held that row since its first audited write —
  // so connection A's delete would block on THIS FILE rather than on the row
  // lock the case is about, and the case would hang instead of proving
  // anything.
  beforeAll(async () => {
    await db.query('rollback');
  });
  afterAll(async () => {
    await db.query('begin');
  });

  it('lets no two of them leave that colleague with no working role', async () => {
    const first = await stampedConnection(IDS.ownerA);
    const second = await stampedConnection(SECOND_OWNER);
    try {
      const { rows: pid } = await second.query<{ pid: number }>('select pg_backend_pid() as pid');
      const secondPid = pid[0]?.pid as number;

      // One owner takes 'practitioner' away and has not committed yet.
      const taken = await first.query<{ gone: boolean }>(
        "select app.revoke_staff_role($1, 'practitioner') as gone",
        [RACER],
      );
      expect(taken.rows[0]?.gone).toBe(true);

      // The other starts on 'finance' in the same moment. Not awaited: the
      // point is that it does not finish.
      let settled = false;
      const racing = second
        .query<{ gone: boolean }>("select app.revoke_staff_role($1, 'finance') as gone", [RACER])
        .then(
          (result) => {
            settled = true;
            return result;
          },
          (error) => {
            settled = true;
            throw error;
          },
        );
      racing.catch(() => {
        // Awaited properly below; this only keeps the rejection from being
        // reported as unhandled while we wait.
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled, 'the second owner finished before the first committed').toBe(false);

      // Blocked on the colleague, specifically. Without the row lock the
      // second owner would get this far and block on app.audit_chain instead —
      // which also looks like waiting, and proves nothing about this rule. A
      // waiter holds a tuple lock on the row it is queued for, so the
      // catalogue says which row that is.
      const waiting = await db.query<{ on: string }>(
        'select l.relation::regclass::text as on from pg_locks l ' +
          "where l.pid = $1 and l.locktype = 'tuple'",
        [secondPid],
      );
      expect(waiting.rows.map((row) => row.on)).toEqual(['app_user']);

      await first.query('commit');

      // Released, the second owner reads the practitioner row as gone — a new
      // statement takes a new snapshot — and 'finance' is now the last working
      // role there is.
      let refusal: { code?: string; message?: string } = {};
      try {
        await racing;
      } catch (error) {
        refusal = error as { code?: string; message?: string };
      }
      expect(refusal.code).toBe('42501');
      expect(refusal.message).toContain('a person keeps at least one working role');

      const left = await db.query<{ role: string }>(
        'select role::text as role from user_role where user_id = $1 order by 1',
        [RACER],
      );
      expect(left.rows.map((row) => row.role)).toEqual(['finance']);
    } finally {
      await first.query('rollback').catch(() => undefined);
      await second.query('rollback').catch(() => undefined);
      await first.end();
      await second.end();
    }
  });
});

describe('the trail these cases wrote', () => {
  it('leaves the audit chain intact', async () => {
    expect(
      (await db.query('select app.verify_audit_chain() as broken')).rows[0]?.broken,
    ).toBeNull();
  });
});
