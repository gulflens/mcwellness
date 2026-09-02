import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedContact,
  seedLocation,
  seedTenant,
  seedUser,
  setAuditContext,
} from '../../db/helpers';

/**
 * The client-record restrictive policies (db/policies/client/readers.sql and
 * writers.sql): one deny case per rule named in "Client Record Plan" PR 2 —
 * finance and a goal, a practitioner while the scheduling door is shut, a
 * client contact scoped to their own client, and an erased record's short
 * allow-list — plus, from the third review round (issues 7 and 15), the
 * document reader policy and a deny case for every write policy, including
 * the cross-tenant cases for the three tables this worktree owns outright.
 */

const RLS_VIOLATION = '42501';

const ADMIN = '00000000-0000-4000-8000-0000000000d0';
const FINANCE = '00000000-0000-4000-8000-0000000000d1';
const PRACTITIONER = '00000000-0000-4000-8000-0000000000d2';
const CLIENT_CONTACT_USER = '00000000-0000-4000-8000-0000000000d3';
const LEAD_PRACTITIONER = '00000000-0000-4000-8000-0000000000d4';
const CLIENT_B = '00000000-0000-4000-8000-0000000000c9';
const GOAL = '00000000-0000-4000-8000-0000000000cb';
const DOCUMENT_CLIENT_A = '00000000-0000-4000-8000-0000000000cc';
const DOCUMENT_PRACTICE = '00000000-0000-4000-8000-0000000000cd';
const DOCUMENT_CLIENT_B = '00000000-0000-4000-8000-0000000000ce';

// A second tenant, for the cross-tenant deny cases (issue 15): tests/db/rls.test.ts
// already proves tenant isolation in general; these three tables are this worktree's
// own, so their cross-tenant cases belong here.
const TENANT_B = '00000000-0000-4000-8000-0000000000e0';
const OWNER_B = '00000000-0000-4000-8000-0000000000e1';
const CLIENT_IN_B = '00000000-0000-4000-8000-0000000000e2';
const GOAL_IN_B = '00000000-0000-4000-8000-0000000000e4';
const ERASURE_REQUEST_IN_B = '00000000-0000-4000-8000-0000000000e5';

let owner: pg.Client;
let goalCategoryA: string;
let goalCategoryInB: string;

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await seedUser(owner, {
    id: ADMIN,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Admin',
    roles: ['admin'],
  });
  await seedUser(owner, {
    id: FINANCE,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Finance',
    roles: ['finance'],
  });
  await seedUser(owner, {
    id: PRACTITIONER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Practitioner',
    roles: ['practitioner'],
  });
  await seedUser(owner, {
    id: LEAD_PRACTITIONER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Lead Practitioner',
    roles: ['lead_practitioner'],
  });
  await seedUser(owner, {
    id: CLIENT_CONTACT_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Household',
    roles: ['client_contact'],
  });

  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await seedContact(owner, IDS.tenantA, IDS.contactA, IDS.clientA, 'x-policy-test-1');
  await owner.query('update contact set user_id = $1 where id = $2', [
    CLIENT_CONTACT_USER,
    IDS.contactA,
  ]);
  await seedLocation(owner, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);

  await owner.query(
    'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, entrance_point, created_by) ' +
      "values ($1, $2, 'tenant', $2, 'studio', 'DXB', " +
      "extensions.st_geogfromtext('SRID=4326;POINT(55.27 25.19)'), $3)",
    ['00000000-0000-4000-8000-0000000000cd', IDS.tenantA, IDS.ownerA],
  );

  await owner.query(
    'insert into client (id, tenant_id, mrn, given_name, family_name, created_by) ' +
      "values ($1, $2, 'MW-CLIENTB', 'Synthetic', 'Beta', $3)",
    [CLIENT_B, IDS.tenantA, IDS.ownerA],
  );

  // seedTenant's tenant insert already seeds the six starting categories
  // (app.seed_goal_categories(), db/migrations/100_client_record.sql), 'focus' among
  // them, so this reuses that row rather than colliding with it on (tenant_id, code).
  const focus = await owner.query<{ id: string }>(
    "select id from goal_category where tenant_id = $1 and code = 'focus'",
    [IDS.tenantA],
  );
  goalCategoryA = focus.rows[0]?.id ?? '';
  if (!goalCategoryA) throw new Error('seedTenant did not seed the "focus" goal category.');
  await owner.query(
    'insert into goal (id, tenant_id, client_id, category_id, description) values ($1, $2, $3, $4, $5)',
    [GOAL, IDS.tenantA, IDS.clientA, goalCategoryA, 'Better focus at school'],
  );

  await owner.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
      "values ($1, $2, $3, 'setup_photo', 'policy-test/client-a.jpg', 'image/jpeg', sha256('a'::bytea))",
    [DOCUMENT_CLIENT_A, IDS.tenantA, IDS.clientA],
  );
  await owner.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
      "values ($1, $2, $3, 'setup_photo', 'policy-test/client-b.jpg', 'image/jpeg', sha256('c'::bytea))",
    [DOCUMENT_CLIENT_B, IDS.tenantA, CLIENT_B],
  );
  await owner.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
      "values ($1, $2, null, 'certificate', 'policy-test/practice.pdf', 'application/pdf', sha256('b'::bytea))",
    [DOCUMENT_PRACTICE, IDS.tenantA],
  );

  await seedTenant(owner, TENANT_B, OWNER_B, 'Synthetic Studio B');
  await seedClient(owner, TENANT_B, CLIENT_IN_B, OWNER_B, 'Beta');
  const focusInB = await owner.query<{ id: string }>(
    "select id from goal_category where tenant_id = $1 and code = 'focus'",
    [TENANT_B],
  );
  goalCategoryInB = focusInB.rows[0]?.id ?? '';
  if (!goalCategoryInB)
    throw new Error('seedTenant did not seed the "focus" goal category for tenant B.');
  await owner.query(
    'insert into goal (id, tenant_id, client_id, category_id, description) values ($1, $2, $3, $4, $5)',
    [GOAL_IN_B, TENANT_B, CLIENT_IN_B, goalCategoryInB, 'A goal that belongs to tenant B'],
  );
  await owner.query(
    'insert into erasure_request (id, tenant_id, client_id, reason) values ($1, $2, $3, $4)',
    [ERASURE_REQUEST_IN_B, TENANT_B, CLIENT_IN_B, 'A request that belongs to tenant B'],
  );
});

afterAll(async () => {
  await owner.end();
});

// Issue 10 (third review round): a tenant created after this migration ran gets the same
// six starting categories the backfill gave the tenant that already existed
// (app.seed_goal_categories(), db/migrations/100_client_record.sql). Both tenants in this
// file's own fixtures were created by seedTenant, after the migration ran, so this is
// really a check on the trigger, not the one-off backfill.
describe('goal_category: seeded for a tenant created after the migration', () => {
  it('gives a newly created tenant exactly the six starting categories', async () => {
    const rows = await owner.query<{ code: string }>(
      'select code from goal_category where tenant_id = $1 order by code',
      [TENANT_B],
    );
    expect(rows.rowCount).toBe(6);
    expect(rows.rows.map((r) => r.code)).toEqual(
      ['behaviour', 'calm', 'focus', 'mood', 'performance', 'sleep'].sort(),
    );
  });
});

describe('goal: finance sees none', () => {
  it('is invisible to finance even though the client and contact are not', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, FINANCE);
      const goals = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from goal where id = $1', [GOAL]),
        'finance',
      );
      expect(goals.rowCount).toBe(0);

      const clients = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from client where id = $1', [IDS.clientA]),
        'finance',
      );
      expect(clients.rowCount).toBe(1);
    });
  });

  it('sees a contact but never a location (corrected after the round 2 review)', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, FINANCE);
      const contacts = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from contact where id = $1', [IDS.contactA]),
        'finance',
      );
      expect(contacts.rowCount).toBe(1);

      const locations = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from location where id = $1', [IDS.locationA]),
        'finance',
      );
      expect(locations.rowCount).toBe(0);
    });
  });
});

describe('practitioner: the scheduling door is shut', () => {
  it('sees no client, contact, location or goal while app.client_visible_to_practitioner says no', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PRACTITIONER);
      const asPractitioner = <T extends pg.QueryResultRow>(sql: string, params: unknown[]) =>
        asApiRole(owner, IDS.tenantA, () => owner.query<T>(sql, params), 'practitioner');

      expect(
        (await asPractitioner('select id from client where id = $1', [IDS.clientA])).rowCount,
      ).toBe(0);
      expect(
        (await asPractitioner('select id from contact where id = $1', [IDS.contactA])).rowCount,
      ).toBe(0);
      expect(
        (await asPractitioner('select id from location where id = $1', [IDS.locationA])).rowCount,
      ).toBe(0);
      expect((await asPractitioner('select id from goal where id = $1', [GOAL])).rowCount).toBe(0);
    });
  });

  it('still sees the tenant-owned studio location', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PRACTITIONER);
      const studio = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query("select id from location where owner_type = 'tenant'", []),
        'practitioner',
      );
      expect(studio.rowCount).toBeGreaterThan(0);
    });
  });
});

describe('client contact: scoped to their own client', () => {
  it('sees their own client and not another in the same practice', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, CLIENT_CONTACT_USER);
      const own = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from client where id = $1', [IDS.clientA]),
        'client_contact',
      );
      expect(own.rowCount).toBe(1);

      const other = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from client where id = $1', [CLIENT_B]),
        'client_contact',
      );
      expect(other.rowCount).toBe(0);
    });
  });

  it('never sees a goal (practice-side, not portal-visible)', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, CLIENT_CONTACT_USER);
      const goals = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from goal where id = $1', [GOAL]),
        'client_contact',
      );
      expect(goals.rowCount).toBe(0);
    });
  });
});

describe('an erased client: owner and lead practitioner only', () => {
  it('opens for the owner and the lead practitioner, and no one else', async () => {
    await rolledBack(owner, async () => {
      await owner.query("update client set status = 'erased' where id = $1", [IDS.clientA]);

      await setAuditContext(owner, IDS.ownerA);
      const asOwner = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from client where id = $1', [IDS.clientA]),
        'owner',
      );
      expect(asOwner.rowCount).toBe(1);

      const asLead = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from client where id = $1', [IDS.clientA]),
        'lead_practitioner',
      );
      expect(asLead.rowCount).toBe(1);

      for (const roles of ['admin', 'finance', 'practitioner']) {
        const denied = await asApiRole(
          owner,
          IDS.tenantA,
          () => owner.query('select id from client where id = $1', [IDS.clientA]),
          roles,
        );
        expect(denied.rowCount, roles).toBe(0);
      }
    });
  });
});

// Issue 7 (third review round): document had no restrictive read policy at all until
// now, the same scope as consent for a client's own document, plus a practice document
// (client_id null) treated the way a tenant-owned location already is — not
// client-sensitive, visible to the four staff roles, never finance or a client contact.
describe('document: the same scope as consent, plus a practice document', () => {
  it('is invisible to finance, client-owned or practice', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, FINANCE);
      const asFinance = (id: string) =>
        asApiRole(
          owner,
          IDS.tenantA,
          () => owner.query('select id from document where id = $1', [id]),
          'finance',
        );
      expect((await asFinance(DOCUMENT_CLIENT_A)).rowCount).toBe(0);
      expect((await asFinance(DOCUMENT_PRACTICE)).rowCount).toBe(0);
    });
  });

  it("sees no client's document while the scheduling door is shut, but sees a practice document", async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PRACTITIONER);
      const asPractitioner = (id: string) =>
        asApiRole(
          owner,
          IDS.tenantA,
          () => owner.query('select id from document where id = $1', [id]),
          'practitioner',
        );
      expect((await asPractitioner(DOCUMENT_CLIENT_A)).rowCount).toBe(0);
      expect((await asPractitioner(DOCUMENT_PRACTICE)).rowCount).toBe(1);
    });
  });

  it("sees their own client's document, not another client's, and not a practice document", async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, CLIENT_CONTACT_USER);
      const asClientContact = (id: string) =>
        asApiRole(
          owner,
          IDS.tenantA,
          () => owner.query('select id from document where id = $1', [id]),
          'client_contact',
        );
      expect((await asClientContact(DOCUMENT_CLIENT_A)).rowCount).toBe(1);
      expect((await asClientContact(DOCUMENT_CLIENT_B)).rowCount).toBe(0);
      expect((await asClientContact(DOCUMENT_PRACTICE)).rowCount).toBe(0);
    });
  });

  it("opens an erased client's document for the owner and the lead practitioner only", async () => {
    await rolledBack(owner, async () => {
      await owner.query("update client set status = 'erased' where id = $1", [IDS.clientA]);
      await setAuditContext(owner, IDS.ownerA);

      const asOwner = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from document where id = $1', [DOCUMENT_CLIENT_A]),
        'owner',
      );
      expect(asOwner.rowCount).toBe(1);

      const asLead = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from document where id = $1', [DOCUMENT_CLIENT_A]),
        'lead_practitioner',
      );
      expect(asLead.rowCount).toBe(1);

      for (const roles of ['admin', 'finance', 'practitioner']) {
        const denied = await asApiRole(
          owner,
          IDS.tenantA,
          () => owner.query('select id from document where id = $1', [DOCUMENT_CLIENT_A]),
          roles,
        );
        expect(denied.rowCount, roles).toBe(0);
      }
    });
  });
});

// Issue 15 (third review round): a deny case for every write policy in writers.sql. Insert
// is checked with rejectsWith (a restrictive with-check violation raises 42501); update is
// checked by row count (a restrictive using clause that excludes the row leaves an update
// matching nothing, not an error — the same distinction record.ts's own comments make about
// writers.sql).
describe('write policies: deny cases', () => {
  const DISALLOWED = ['finance', 'practitioner', 'client_contact'] as const;

  it('client: only owner, admin and the lead practitioner may insert or update', async () => {
    await rolledBack(owner, async () => {
      for (const roles of DISALLOWED) {
        await asApiRole(
          owner,
          IDS.tenantA,
          () =>
            rejectsWith(
              owner,
              RLS_VIOLATION,
              "insert into client (tenant_id, mrn, given_name, family_name) values ($1, 'MW-DENY-CLIENT', 'Synthetic', 'Denied')",
              [IDS.tenantA],
            ),
          roles,
        );
        const updated = await asApiRole(
          owner,
          IDS.tenantA,
          () =>
            owner.query('update client set given_name = $1 where id = $2', [
              'Changed',
              IDS.clientA,
            ]),
          roles,
        );
        expect(updated.rowCount, roles).toBe(0);
      }
    });
  });

  it('contact: only owner, admin and the lead practitioner may insert or update', async () => {
    await rolledBack(owner, async () => {
      for (const roles of DISALLOWED) {
        await asApiRole(
          owner,
          IDS.tenantA,
          () =>
            rejectsWith(
              owner,
              RLS_VIOLATION,
              "insert into contact (tenant_id, client_id, relationship, can_consent) values ($1, $2, 'mother', true)",
              [IDS.tenantA, IDS.clientA],
            ),
          roles,
        );
        const updated = await asApiRole(
          owner,
          IDS.tenantA,
          () =>
            owner.query('update contact set phone = $1 where id = $2', [
              '+971500000099',
              IDS.contactA,
            ]),
          roles,
        );
        expect(updated.rowCount, roles).toBe(0);
      }
    });
  });

  it('location: only owner, admin and the lead practitioner may insert; a practitioner still cannot update while the scheduling door is shut', async () => {
    await rolledBack(owner, async () => {
      for (const roles of DISALLOWED) {
        await asApiRole(
          owner,
          IDS.tenantA,
          () =>
            rejectsWith(
              owner,
              RLS_VIOLATION,
              'insert into location (tenant_id, owner_type, owner_id, label, emirate, entrance_point) ' +
                "values ($1, 'client', $2, 'home', 'DXB', extensions.st_geogfromtext('SRID=4326;POINT(55.27 25.20)'))",
              [IDS.tenantA, IDS.clientA],
            ),
          roles,
        );
      }
      // A practitioner is floored the same way, even though writers.sql names a path for
      // one on their own schedule: app.client_visible_to_practitioner still answers false.
      for (const roles of DISALLOWED) {
        const updated = await asApiRole(
          owner,
          IDS.tenantA,
          () =>
            owner.query('update location set display_address = $1 where id = $2', [
              'Denied street',
              IDS.locationA,
            ]),
          roles,
        );
        expect(updated.rowCount, roles).toBe(0);
      }
    });
  });

  it('consent: only owner, admin and the lead practitioner may insert or update', async () => {
    await rolledBack(owner, async () => {
      for (const roles of DISALLOWED) {
        await asApiRole(
          owner,
          IDS.tenantA,
          () =>
            rejectsWith(
              owner,
              RLS_VIOLATION,
              'insert into consent (tenant_id, client_id, given_by_contact_id, purpose, version, ' +
                "text_document_id, method) values ($1, $2, $3, 'participation', 1, $4, 'app_signature')",
              [IDS.tenantA, IDS.clientA, IDS.contactA, DOCUMENT_PRACTICE],
            ),
          roles,
        );
      }
      const consent = await owner.query<{ id: string }>(
        'insert into consent (tenant_id, client_id, given_by_contact_id, purpose, version, ' +
          "text_document_id, method) values ($1, $2, $3, 'participation', 1, $4, 'app_signature') " +
          'returning id',
        [IDS.tenantA, IDS.clientA, IDS.contactA, DOCUMENT_PRACTICE],
      );
      const consentId = consent.rows[0]?.id;
      for (const roles of DISALLOWED) {
        const updated = await asApiRole(
          owner,
          IDS.tenantA,
          () => owner.query("update consent set status = 'withdrawn' where id = $1", [consentId]),
          roles,
        );
        expect(updated.rowCount, roles).toBe(0);
      }
    });
  });

  it('goal: the owner and the lead practitioner alone — admin is deliberately excluded too', async () => {
    await rolledBack(owner, async () => {
      for (const roles of [...DISALLOWED, 'admin'] as const) {
        await asApiRole(
          owner,
          IDS.tenantA,
          () =>
            rejectsWith(
              owner,
              RLS_VIOLATION,
              'insert into goal (tenant_id, client_id, category_id, description) values ($1, $2, $3, $4)',
              [IDS.tenantA, IDS.clientA, goalCategoryA, 'Denied goal'],
            ),
          roles,
        );
        const updated = await asApiRole(
          owner,
          IDS.tenantA,
          () => owner.query('update goal set description = $1 where id = $2', ['Changed', GOAL]),
          roles,
        );
        expect(updated.rowCount, roles).toBe(0);
      }
    });
  });

  it('goal_category: the owner and an admin alone', async () => {
    await rolledBack(owner, async () => {
      for (const roles of [...DISALLOWED, 'lead_practitioner'] as const) {
        await asApiRole(
          owner,
          IDS.tenantA,
          () =>
            rejectsWith(
              owner,
              RLS_VIOLATION,
              "insert into goal_category (tenant_id, code, name) values ($1, 'x-denied', 'Denied')",
              [IDS.tenantA],
            ),
          roles,
        );
        const updated = await asApiRole(
          owner,
          IDS.tenantA,
          () =>
            owner.query('update goal_category set name = $1 where id = $2', [
              'Changed',
              goalCategoryA,
            ]),
          roles,
        );
        expect(updated.rowCount, roles).toBe(0);
      }
    });
  });

  it('erasure_request: only owner, admin and the lead practitioner may insert or update', async () => {
    await rolledBack(owner, async () => {
      for (const roles of DISALLOWED) {
        await asApiRole(
          owner,
          IDS.tenantA,
          () =>
            rejectsWith(
              owner,
              RLS_VIOLATION,
              'insert into erasure_request (tenant_id, client_id, reason) values ($1, $2, $3)',
              [IDS.tenantA, IDS.clientA, 'Denied request'],
            ),
          roles,
        );
      }
      const request = await owner.query<{ id: string }>(
        'insert into erasure_request (tenant_id, client_id, reason) values ($1, $2, $3) returning id',
        [IDS.tenantA, IDS.clientA, 'A real request'],
      );
      const requestId = request.rows[0]?.id;
      for (const roles of DISALLOWED) {
        const updated = await asApiRole(
          owner,
          IDS.tenantA,
          () =>
            owner.query("update erasure_request set reason = 'Changed' where id = $1", [requestId]),
          roles,
        );
        expect(updated.rowCount, roles).toBe(0);
      }
    });
  });
});

// Issue 15 (third review round): the cross-tenant cases for the three tables this
// worktree owns outright. tests/db/rls.test.ts proves the general rule for the core
// tables; goal, goal_category and erasure_request need their own, since tenant_isolation
// (db/policies/client/tenant_isolation.sql) is this worktree's own policy file.
describe('cross-tenant: goal, goal_category and erasure_request', () => {
  it("refuses a goal written for another tenant, and hides tenant B's goal from tenant A", async () => {
    await rolledBack(owner, async () => {
      await asApiRole(
        owner,
        IDS.tenantA,
        () =>
          rejectsWith(
            owner,
            RLS_VIOLATION,
            'insert into goal (tenant_id, client_id, category_id, description) values ($1, $2, $3, $4)',
            [TENANT_B, CLIENT_IN_B, goalCategoryInB, 'Intruding from tenant A'],
          ),
        'owner',
      );
      const seenFromA = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from goal where id = $1', [GOAL_IN_B]),
        'owner',
      );
      expect(seenFromA.rowCount).toBe(0);
    });
  });

  it("refuses a goal category written for another tenant, and hides tenant B's from tenant A", async () => {
    await rolledBack(owner, async () => {
      await asApiRole(
        owner,
        IDS.tenantA,
        () =>
          rejectsWith(
            owner,
            RLS_VIOLATION,
            "insert into goal_category (tenant_id, code, name) values ($1, 'x-cross-tenant', 'Denied')",
            [TENANT_B],
          ),
        'admin',
      );
      const seenFromA = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from goal_category where id = $1', [goalCategoryInB]),
        'admin',
      );
      expect(seenFromA.rowCount).toBe(0);
    });
  });

  it("refuses an erasure request written for another tenant, and hides tenant B's from tenant A", async () => {
    await rolledBack(owner, async () => {
      await asApiRole(
        owner,
        IDS.tenantA,
        () =>
          rejectsWith(
            owner,
            RLS_VIOLATION,
            'insert into erasure_request (tenant_id, client_id, reason) values ($1, $2, $3)',
            [TENANT_B, CLIENT_IN_B, 'Intruding from tenant A'],
          ),
        'admin',
      );
      const seenFromA = await asApiRole(
        owner,
        IDS.tenantA,
        () => owner.query('select id from erasure_request where id = $1', [ERASURE_REQUEST_IN_B]),
        'admin',
      );
      expect(seenFromA.rowCount).toBe(0);
    });
  });
});

describe('the record-number helper', () => {
  it('serves only the acting practice through the API role', async () => {
    await rolledBack(owner, () =>
      asApiRole(owner, IDS.tenantA, async () => {
        const { rows } = await owner.query<{ mrn: string }>('select app.next_mrn($1) as mrn', [
          IDS.tenantA,
        ]);
        expect(rows[0]?.mrn).toMatch(/^MW-\d{6}$/);
        await rejectsWith(owner, '42501', 'select app.next_mrn($1)', [IDS.tenantB]);
      }),
    );
  });
});
