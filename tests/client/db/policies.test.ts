import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  freshDatabase,
  rolledBack,
  seedClient,
  seedContact,
  seedLocation,
  seedTenant,
  seedUser,
  setAuditContext,
} from '../../db/helpers';

/**
 * The client-record restrictive policies (db/policies/client/readers.sql):
 * one deny case per rule named in "Client Record Plan" PR 2 — finance and a
 * goal, a practitioner while the scheduling door is shut, a client contact
 * scoped to their own client, and an erased record's short allow-list.
 */

const ADMIN = '00000000-0000-4000-8000-0000000000d0';
const FINANCE = '00000000-0000-4000-8000-0000000000d1';
const PRACTITIONER = '00000000-0000-4000-8000-0000000000d2';
const CLIENT_CONTACT_USER = '00000000-0000-4000-8000-0000000000d3';
const LEAD_PRACTITIONER = '00000000-0000-4000-8000-0000000000d4';
const CLIENT_B = '00000000-0000-4000-8000-0000000000c9';
const GOAL_CATEGORY = '00000000-0000-4000-8000-0000000000ca';
const GOAL = '00000000-0000-4000-8000-0000000000cb';

let owner: pg.Client;

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

  await owner.query(
    "insert into goal_category (id, tenant_id, code, name) values ($1, $2, 'focus', 'Focus')",
    [GOAL_CATEGORY, IDS.tenantA],
  );
  await owner.query(
    'insert into goal (id, tenant_id, client_id, category_id, description) values ($1, $2, $3, $4, $5)',
    [GOAL, IDS.tenantA, IDS.clientA, GOAL_CATEGORY, 'Better focus at school'],
  );
});

afterAll(async () => {
  await owner.end();
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
