import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, asApiRole, freshDatabase, seedClient, seedTenant, seedUser } from './helpers';
import type pg from 'pg';

/**
 * An act aimed at a household spares a colleague (migration 968; trunk round
 * 59, the operator's decision of 22 September 2026): ending a household's
 * access ends the LINK between a contact row and an account, and ends the
 * ACCOUNT only when that account is a household's and nothing else. A member of
 * staff whose own sign-in is also linked as a contact keeps working, untouched,
 * whether the household is erased or its access is revoked.
 *
 * Before this round `app.erase_client` archived and unlinked the account of
 * every contact — a colleague's included — and, since round 58's owner lock,
 * refused the whole erasure when that colleague was an owner
 * (tests/db/owner_lock.test.ts pinned the refusal so the day it changed was
 * noticed; this file is that day).
 *
 * Every person is named from db/seed/names.ts and every id is synthetic.
 */

/** Tenant A's second owner, who also holds finance, linked as a household's contact. */
const SECOND_OWNER = '00000002-0000-4000-8000-0000000000e1';
const ADMIN = '00000002-0000-4000-8000-0000000000e2';
/** A practitioner who is a contact of TWO households: the portal role outlives the first erasure. */
const COLLEAGUE = '00000002-0000-4000-8000-0000000000e3';
/** A household's own account and nothing else: the shape erasure still archives. */
const HOUSEHOLD = '00000002-0000-4000-8000-0000000000e4';
/** A colleague who is nobody's contact: the unlink function must refuse to find a link. */
const FINANCE = '00000002-0000-4000-8000-0000000000e5';
/** The same shape of colleague-as-contact, in another practice entirely. */
const ELSEWHERE = '00000002-0000-4000-8000-0000000000e6';
const OWNER_SIGN_IN = '00000002-0000-4000-8000-0000000000e7';
const COLLEAGUE_SIGN_IN = '00000002-0000-4000-8000-0000000000e8';

const CLIENT_OWNER = '00000002-0000-4000-8000-0000000000f1';
const CONTACT_OWNER = '00000002-0000-4000-8000-0000000000f2';
const REQUEST_OWNER = '00000002-0000-4000-8000-0000000000f3';
const CLIENT_ONE = '00000002-0000-4000-8000-0000000000f4';
const CONTACT_ONE = '00000002-0000-4000-8000-0000000000f5';
const REQUEST_ONE = '00000002-0000-4000-8000-0000000000f6';
const CLIENT_TWO = '00000002-0000-4000-8000-0000000000f7';
const CONTACT_TWO = '00000002-0000-4000-8000-0000000000f8';
const REQUEST_TWO = '00000002-0000-4000-8000-0000000000f9';
const CLIENT_HOUSEHOLD = '00000002-0000-4000-8000-0000000000fa';
const CONTACT_HOUSEHOLD = '00000002-0000-4000-8000-0000000000fb';
const REQUEST_HOUSEHOLD = '00000002-0000-4000-8000-0000000000fc';
const CLIENT_ELSEWHERE = '00000002-0000-4000-8000-0000000000fd';
const CONTACT_ELSEWHERE = '00000002-0000-4000-8000-0000000000fe';
const NOBODY = '00000002-0000-4000-8000-0000000000ff';

let db: pg.Client;

/** The roles a person holds, sorted, as the runbook's own query reads them. */
async function rolesOf(client: pg.Client, userId: string): Promise<string[]> {
  const { rows } = await client.query<{ roles: string[] | null }>(
    'select array_agg(role::text order by role::text) as roles from user_role where user_id = $1',
    [userId],
  );
  return rows[0]?.roles ?? [];
}

async function accountOf(
  client: pg.Client,
  userId: string,
): Promise<{ status: string; display_name: string; auth_id: string | null }> {
  const { rows } = await client.query<{
    status: string;
    display_name: string;
    auth_id: string | null;
  }>('select status::text as status, display_name, auth_id from app_user where id = $1', [userId]);
  return rows[0] as { status: string; display_name: string; auth_id: string | null };
}

async function linkOf(client: pg.Client, contactId: string): Promise<string | null> {
  const { rows } = await client.query<{ user_id: string | null }>(
    'select user_id from contact where id = $1',
    [contactId],
  );
  return rows[0]?.user_id ?? null;
}

/**
 * Runs an erasure the way the API does: the tenant, the actor and the roles
 * stamped transaction-local, then the function. As the superuser, not the API
 * role — the point is what the FUNCTION does, and app.erase_client is security
 * definer either way. Inside a savepoint so the file's transaction stays
 * usable and every case starts from the same rows.
 */
async function erase(
  clientId: string,
  requestId: string,
  fn: (summary: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  await db.query('savepoint erasure');
  try {
    await db.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', 'owner', true), set_config('app.request_id', $3, true)",
      [IDS.tenantA, IDS.ownerA, requestId],
    );
    const { rows } = await db.query<{ summary: Record<string, unknown> }>(
      'select app.erase_client($1, $2) as summary',
      [clientId, requestId],
    );
    await fn(rows[0]?.summary as Record<string, unknown>);
  } finally {
    await db.query('rollback to savepoint erasure');
  }
}

/**
 * Expects the statement to fail with 42501 AND with the message of the rule it
 * is named for — the function raises the same SQLSTATE for every refusal, so a
 * case that asserts the code alone could pass on the wrong rule.
 */
async function refusesWith(phrase: string, sql: string, params: unknown[] = []): Promise<void> {
  await db.query('savepoint expect_refusal');
  let seen: { code?: string; message?: string } = {};
  try {
    await db.query(sql, params);
  } catch (error) {
    seen = error as { code?: string; message?: string };
  } finally {
    await db.query('rollback to savepoint expect_refusal');
  }
  expect(seen.code, sql).toBe('42501');
  expect(seen.message, sql).toContain(phrase);
}

async function seedHousehold(
  clientId: string,
  contactId: string,
  requestId: string | null,
  linkedTo: string | null,
  tenantId = IDS.tenantA,
  ownerId = IDS.ownerA,
): Promise<void> {
  await seedClient(db, tenantId, clientId, ownerId, 'Valley');
  await db.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent, user_id) ' +
      "values ($1, $2, $3, 'self', true, $4)",
    [contactId, tenantId, clientId, linkedTo],
  );
  if (requestId) {
    await db.query(
      'insert into erasure_request (id, tenant_id, client_id, reason, created_by) ' +
        'values ($1, $2, $3, $4, $5)',
      [
        requestId,
        tenantId,
        clientId,
        'The household asked for their record to be removed.',
        ownerId,
      ],
    );
  }
}

beforeAll(async () => {
  db = await freshDatabase();
  await seedTenant(db, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await seedTenant(db, IDS.tenantB, IDS.ownerB, 'Other Studio');
  await seedUser(db, {
    id: SECOND_OWNER,
    tenantId: IDS.tenantA,
    authId: OWNER_SIGN_IN,
    displayName: 'Fern Ridge',
    roles: ['owner', 'finance', 'client_contact'],
  });
  await seedUser(db, {
    id: ADMIN,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Olive Cliff',
    roles: ['admin'],
  });
  await seedUser(db, {
    id: COLLEAGUE,
    tenantId: IDS.tenantA,
    authId: COLLEAGUE_SIGN_IN,
    displayName: 'Sage Orchard',
    roles: ['practitioner', 'client_contact'],
  });
  await seedUser(db, {
    id: HOUSEHOLD,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Reed Dune',
    roles: ['client_contact'],
  });
  await seedUser(db, {
    id: FINANCE,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Pearl Quarry',
    roles: ['finance'],
  });
  await seedUser(db, {
    id: ELSEWHERE,
    tenantId: IDS.tenantB,
    authId: null,
    displayName: 'Rowan Ridge',
    roles: ['practitioner', 'client_contact'],
  });

  await seedHousehold(CLIENT_OWNER, CONTACT_OWNER, REQUEST_OWNER, SECOND_OWNER);
  await seedHousehold(CLIENT_ONE, CONTACT_ONE, REQUEST_ONE, COLLEAGUE);
  await seedHousehold(CLIENT_TWO, CONTACT_TWO, REQUEST_TWO, COLLEAGUE);
  await seedHousehold(CLIENT_HOUSEHOLD, CONTACT_HOUSEHOLD, REQUEST_HOUSEHOLD, HOUSEHOLD);
  await seedHousehold(
    CLIENT_ELSEWHERE,
    CONTACT_ELSEWHERE,
    null,
    ELSEWHERE,
    IDS.tenantB,
    IDS.ownerB,
  );

  // Savepoints only exist inside an explicit transaction: one for the file,
  // rolled back at the end (the pattern tests/db/owner_lock.test.ts uses).
  await db.query('begin');
});

afterAll(async () => {
  await db.query('rollback');
  await db.end();
});

describe('an erasure that reaches a colleague', () => {
  it("completes for a household whose contact is an owner, and leaves the owner's sign-in alone", async () => {
    await erase(CLIENT_OWNER, REQUEST_OWNER, async (summary) => {
      expect(summary).toMatchObject({
        contactsAnonymised: 1,
        portalAccountsArchived: 0,
        staffAccountsSpared: 1,
      });
      // The household is gone from the record; the colleague is not.
      expect(await linkOf(db, CONTACT_OWNER)).toBeNull();
      expect(await accountOf(db, SECOND_OWNER)).toEqual({
        status: 'active',
        display_name: 'Fern Ridge',
        auth_id: OWNER_SIGN_IN,
      });
      const household = await db.query<{ status: string }>(
        'select status::text as status from client where id = $1',
        [CLIENT_OWNER],
      );
      expect(household.rows[0]?.status).toBe('erased');
    });
  });

  it('drops the portal role of a spared colleague once no contact row links to them', async () => {
    await erase(CLIENT_OWNER, REQUEST_OWNER, async () => {
      // The owner's only household is erased: client_contact goes, the rest stays.
      expect(await rolesOf(db, SECOND_OWNER)).toEqual(['finance', 'owner']);
    });
  });

  it('keeps the portal role while another household still links to the colleague', async () => {
    await db.query('savepoint two_households');
    try {
      await db.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
          "set_config('app.actor_roles', 'owner', true)",
        [IDS.tenantA, IDS.ownerA],
      );
      const first = await db.query<{ summary: Record<string, unknown> }>(
        'select app.erase_client($1, $2) as summary',
        [CLIENT_ONE, REQUEST_ONE],
      );
      expect(first.rows[0]?.summary).toMatchObject({ staffAccountsSpared: 1 });
      expect(await linkOf(db, CONTACT_ONE)).toBeNull();
      expect(await linkOf(db, CONTACT_TWO)).toBe(COLLEAGUE);
      expect(await rolesOf(db, COLLEAGUE)).toEqual(['client_contact', 'practitioner']);

      const second = await db.query<{ summary: Record<string, unknown> }>(
        'select app.erase_client($1, $2) as summary',
        [CLIENT_TWO, REQUEST_TWO],
      );
      expect(second.rows[0]?.summary).toMatchObject({ staffAccountsSpared: 1 });
      expect(await rolesOf(db, COLLEAGUE)).toEqual(['practitioner']);
      expect(await accountOf(db, COLLEAGUE)).toEqual({
        status: 'active',
        display_name: 'Sage Orchard',
        auth_id: COLLEAGUE_SIGN_IN,
      });
    } finally {
      await db.query('rollback to savepoint two_households');
    }
  });

  it("still archives and unlinks a household's own account, as it always has", async () => {
    await erase(CLIENT_HOUSEHOLD, REQUEST_HOUSEHOLD, async (summary) => {
      expect(summary).toMatchObject({ portalAccountsArchived: 1, staffAccountsSpared: 0 });
      expect(await accountOf(db, HOUSEHOLD)).toEqual({
        status: 'archived',
        display_name: 'Erased user',
        auth_id: null,
      });
      expect(await linkOf(db, CONTACT_HOUSEHOLD)).toBeNull();
    });
  });
});

describe('app.unlink_household_contact', () => {
  /** As the API role, with the actor named: the way the Portal screen's route calls it. */
  async function unlinkAs(
    actorId: string,
    roles: string,
    contactId: string,
    fn: (result: boolean) => Promise<void>,
  ): Promise<void> {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        await db.query("select set_config('app.actor_id', $1, true)", [actorId]);
        const { rows } = await db.query<{ unlinked: boolean }>(
          'select app.unlink_household_contact($1) as unlinked',
          [contactId],
        );
        await fn(rows[0]?.unlinked as boolean);
      },
      roles,
    );
  }

  it("unlinks a colleague's contact row for an owner and leaves their sign-in and working roles alone", async () => {
    await unlinkAs(IDS.ownerA, 'owner', CONTACT_OWNER, async (unlinked) => {
      expect(unlinked).toBe(true);
      expect(await linkOf(db, CONTACT_OWNER)).toBeNull();
      expect(await rolesOf(db, SECOND_OWNER)).toEqual(['finance', 'owner']);
      expect(await accountOf(db, SECOND_OWNER)).toEqual({
        status: 'active',
        display_name: 'Fern Ridge',
        auth_id: OWNER_SIGN_IN,
      });
    });
  });

  it('keeps the portal role while another contact row still links to the account', async () => {
    await unlinkAs(IDS.ownerA, 'owner', CONTACT_ONE, async (unlinked) => {
      expect(unlinked).toBe(true);
      expect(await linkOf(db, CONTACT_ONE)).toBeNull();
      expect(await linkOf(db, CONTACT_TWO)).toBe(COLLEAGUE);
      expect(await rolesOf(db, COLLEAGUE)).toEqual(['client_contact', 'practitioner']);
    });
  });

  it('lets an admin do it, because the Portal screen is theirs too', async () => {
    await unlinkAs(ADMIN, 'admin', CONTACT_ONE, async (unlinked) => {
      expect(unlinked).toBe(true);
      expect(await linkOf(db, CONTACT_ONE)).toBeNull();
    });
  });

  it('writes the unlink and the dropped role to the trail under the person who did it', async () => {
    await unlinkAs(IDS.ownerA, 'owner', CONTACT_OWNER, async () => {
      const { rows } = await db.query<{ entity_type: string; action: string; actor_id: string }>(
        'select entity_type, action, actor_id from audit_log ' +
          "where ((entity_type = 'contact' and entity_id = $1) or entity_type = 'user_role') " +
          "and action in ('update', 'delete') order by id",
        [CONTACT_OWNER],
      );
      expect(rows.map((r) => `${r.entity_type}.${r.action}`)).toEqual([
        'contact.update',
        'user_role.delete',
      ]);
      expect(rows.every((r) => r.actor_id === IDS.ownerA)).toBe(true);
    });
  });

  it('answers false, and changes nothing, for a contact with no account behind it', async () => {
    await db.query('savepoint no_account');
    try {
      await db.query('update contact set user_id = null where id = $1', [CONTACT_HOUSEHOLD]);
      await unlinkAs(IDS.ownerA, 'owner', CONTACT_HOUSEHOLD, async (unlinked) => {
        expect(unlinked).toBe(false);
      });
    } finally {
      await db.query('rollback to savepoint no_account');
    }
  });

  it("refuses a household's own account, which is the route's suspend to end and not this", async () => {
    await asApiRole(db, IDS.tenantA, async () => {
      await db.query("select set_config('app.actor_id', $1, true)", [IDS.ownerA]);
      await refusesWith(
        "that account is a household's, not a colleague's",
        'select app.unlink_household_contact($1)',
        [CONTACT_HOUSEHOLD],
      );
      expect(await linkOf(db, CONTACT_HOUSEHOLD)).toBe(HOUSEHOLD);
    });
  });

  it('refuses a practitioner, and refuses a caller with no name', async () => {
    await asApiRole(
      db,
      IDS.tenantA,
      async () => {
        await db.query("select set_config('app.actor_id', $1, true)", [FINANCE]);
        await refusesWith(
          "only an owner or an admin ends a household's access",
          'select app.unlink_household_contact($1)',
          [CONTACT_OWNER],
        );
      },
      'finance',
    );
    await asApiRole(db, IDS.tenantA, async () => {
      await refusesWith(
        "nobody ends a household's access without being named",
        'select app.unlink_household_contact($1)',
        [CONTACT_OWNER],
      );
    });
    expect(await linkOf(db, CONTACT_OWNER)).toBe(SECOND_OWNER);
  });

  it("takes the database's word for who is an owner or an admin, not the session's", async () => {
    // The session claims owner; the named actor holds finance and nothing else.
    await asApiRole(db, IDS.tenantA, async () => {
      await db.query("select set_config('app.actor_id', $1, true)", [FINANCE]);
      await refusesWith(
        "only an owner or an admin ends a household's access",
        'select app.unlink_household_contact($1)',
        [CONTACT_OWNER],
      );
    });
  });

  it('refuses a contact of another practice, and one that does not exist, alike', async () => {
    await asApiRole(db, IDS.tenantA, async () => {
      await db.query("select set_config('app.actor_id', $1, true)", [IDS.ownerA]);
      await refusesWith('no such contact', 'select app.unlink_household_contact($1)', [
        CONTACT_ELSEWHERE,
      ]);
      await refusesWith('no such contact', 'select app.unlink_household_contact($1)', [NOBODY]);
    });
    expect(await linkOf(db, CONTACT_ELSEWHERE)).toBe(ELSEWHERE);
  });

  it('is not callable by public', async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      "select has_function_privilege('app_role', 'app.unlink_household_contact(uuid)', 'execute') as ok " +
        'union all ' +
        "select exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x " +
        "where x.grantee = 0 and x.privilege_type = 'EXECUTE') " +
        "from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'unlink_household_contact'",
    );
    expect(rows.map((r) => r.ok)).toEqual([true, false]);
  });
});

describe('the trail these cases wrote', () => {
  it('leaves the audit chain intact', async () => {
    const { rows } = await db.query<{ broken: string | null }>(
      'select app.verify_audit_chain()::text as broken',
    );
    expect(rows[0]?.broken).toBeNull();
  });
});
