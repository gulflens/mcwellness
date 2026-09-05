import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, asApiRole, freshDatabase, rolledBack, setAuditContext } from '../../db/helpers';
import {
  PORTAL,
  asContact,
  seedAppointment,
  seedConsent,
  seedPortalHousehold,
  seedWording,
} from './support';

/**
 * The floor under the portal (docs/SPEC/client-portal.md sections 6.5 and 13):
 * one deny test per grant this piece adds or widens.
 *
 * The commitment being proved is the first of the spec's two: a household
 * reaches its own rows and never another's, **because the database refuses**.
 * So every case here is read as `app_role` with a contact's own stamp, which
 * is what a request actually is; nothing is asked of a route.
 *
 * Erasure is proved once rather than per table: `app.erase_client` clears
 * `contact.user_id`, so an erased record's contacts stop resolving at
 * `app.actor_is_contact_of` and every arm added here closes with it. The
 * erasure gate stands in front of the two portal tables besides.
 */

const RLS_VIOLATION = '42501';
const REQUEST = '00000001-0000-4000-8000-000000000041';
const OTHER_REQUEST = '00000001-0000-4000-8000-000000000042';
const INVITE = '00000001-0000-4000-8000-000000000043';
const APPOINTMENT = '00000001-0000-4000-8000-000000000044';
const OTHER_APPOINTMENT = '00000001-0000-4000-8000-000000000045';
const CONSENT = '00000001-0000-4000-8000-000000000046';
const WORDING = '00000001-0000-4000-8000-000000000047';
const ERASURE_REQUEST = '00000001-0000-4000-8000-000000000048';

let owner: pg.Client;

beforeAll(async () => {
  owner = await freshDatabase();
  await seedPortalHousehold(owner);

  await owner.query(
    'insert into portal_request (id, tenant_id, client_id, contact_id, kind, note) ' +
      "values ($1, $2, $3, $4, 'erasure', 'A note the household wrote.')",
    [REQUEST, IDS.tenantA, PORTAL.childA, PORTAL.motherContact],
  );
  await owner.query(
    'insert into portal_request (id, tenant_id, client_id, contact_id, kind) ' +
      "values ($1, $2, $3, $4, 'erasure')",
    [OTHER_REQUEST, IDS.tenantA, PORTAL.adultClient, PORTAL.adultContact],
  );
  await owner.query(
    'insert into portal_invite (id, tenant_id, client_id, contact_id, user_id, kind, ' +
      "token_hash, expires_at) values ($1, $2, $3, $4, $5, 'first_sign_in', " +
      "sha256('a-token-that-opens-nothing'::bytea), now() + interval '7 days')",
    [INVITE, IDS.tenantA, PORTAL.childA, PORTAL.motherContact, PORTAL.motherUser],
  );
  await seedAppointment(owner, {
    id: APPOINTMENT,
    clientId: PORTAL.childA,
    inDays: 2,
    hour: 10,
    status: 'confirmed',
  });
  await seedAppointment(owner, {
    id: OTHER_APPOINTMENT,
    clientId: PORTAL.strangerClient,
    inDays: 2,
    hour: 14,
    status: 'confirmed',
  });
  await seedWording(owner, {
    id: WORDING,
    purpose: 'minor_participation',
    locale: 'en',
    version: '0.1-draft',
    status: 'approved',
  });
  await seedConsent(owner, {
    id: CONSENT,
    clientId: PORTAL.childA,
    contactId: PORTAL.motherContact,
    purpose: 'minor_participation',
    wordingId: WORDING,
  });
});

afterAll(async () => {
  await owner.end();
});

describe('the household reaches its own rows', () => {
  it("shows the mother both her children's records and no stranger's", async () => {
    await rolledBack(owner, async () => {
      const clients = await asContact(owner, PORTAL.motherUser, () =>
        owner.query<{ id: string }>('select id from client order by id'),
      );
      expect(clients.rows.map((r) => r.id).sort()).toEqual([PORTAL.childA, PORTAL.childB].sort());
    });
  });

  it('resolves the household in the database and not from anything a request claims', async () => {
    await rolledBack(owner, async () => {
      const ids = await asContact(owner, PORTAL.motherUser, () =>
        owner.query<{ ids: string[] }>('select app.portal_client_ids() as ids'),
      );
      expect([...(ids.rows[0]?.ids ?? [])].sort()).toEqual([PORTAL.childA, PORTAL.childB].sort());
    });
  });

  it('answers an empty household when nobody is stamped', async () => {
    await rolledBack(owner, async () => {
      const ids = await asApiRole(owner, IDS.tenantA, () =>
        owner.query<{ ids: string[] }>('select app.portal_client_ids() as ids'),
      );
      expect(ids.rows[0]?.ids).toEqual([]);
    });
  });

  it("shows the adult her own record and neither of the mother's", async () => {
    await rolledBack(owner, async () => {
      const clients = await asContact(owner, PORTAL.adultUser, () =>
        owner.query<{ id: string }>('select id from client'),
      );
      expect(clients.rows.map((r) => r.id)).toEqual([PORTAL.adultClient]);
    });
  });

  it("shows the household its own client's contacts, consent and location, and no other's", async () => {
    await rolledBack(owner, async () => {
      const rows = await asContact(owner, PORTAL.motherUser, async () => ({
        contacts: await owner.query('select id from contact where client_id = $1', [
          PORTAL.strangerClient,
        ]),
        ownContacts: await owner.query('select id from contact where client_id = $1', [
          PORTAL.childA,
        ]),
        consents: await owner.query('select id from consent where id = $1', [CONSENT]),
      }));
      expect(rows.contacts.rowCount).toBe(0);
      // The mother, the father and the child's own login: the people on the record.
      expect(rows.ownContacts.rowCount).toBe(3);
      expect(rows.consents.rowCount).toBe(1);
    });
  });
});

describe('appointment: the arm the household needs (scheduling_read_scope)', () => {
  it("shows a contact their own client's visits", async () => {
    await rolledBack(owner, async () => {
      const rows = await asContact(owner, PORTAL.motherUser, () =>
        owner.query<{ id: string }>('select id from appointment'),
      );
      expect(rows.rows.map((r) => r.id)).toEqual([APPOINTMENT]);
    });
  });

  it("refuses another household's visit", async () => {
    await rolledBack(owner, async () => {
      const rows = await asContact(owner, PORTAL.adultUser, () =>
        owner.query('select id from appointment where id = $1', [OTHER_APPOINTMENT]),
      );
      expect(rows.rowCount).toBe(0);
    });
  });

  it('closes with the erasure, because an erased record has no contacts left', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, IDS.ownerA, 'A synthetic erasure, to prove the arm closes.');
      await owner.query(
        'insert into erasure_request (id, tenant_id, client_id, reason) values ($1, $2, $3, $4)',
        [ERASURE_REQUEST, IDS.tenantA, PORTAL.childA, 'A synthetic erasure, for this test.'],
      );
      // app.erase_client is security definer and reads these two settings
      // directly, so no role switch is needed and its effects survive for the
      // assertions below (tests/client/db/erase_client.test.ts says the same).
      await owner.query(
        "select set_config('app.tenant_id', $1, true), " +
          "set_config('app.actor_roles', 'owner', true)",
        [IDS.tenantA],
      );
      await owner.query('select app.erase_client($1, $2)', [PORTAL.childA, ERASURE_REQUEST]);
      const rows = await asContact(owner, PORTAL.motherUser, async () => ({
        appointments: await owner.query('select id from appointment where id = $1', [APPOINTMENT]),
        ids: await owner.query<{ ids: string[] }>('select app.portal_client_ids() as ids'),
      }));
      expect(rows.appointments.rowCount).toBe(0);
      expect(rows.ids.rows[0]?.ids).not.toContain(PORTAL.childA);
    });
  });
});

describe('contact: a household corrects its own row and no other', () => {
  it('lets a contact change their own telephone', async () => {
    await rolledBack(owner, async () => {
      await asContact(owner, PORTAL.motherUser, async () => {
        const changed = await owner.query(
          "update contact set phone = '+971500000031' where id = $1",
          [PORTAL.motherContact],
        );
        expect(changed.rowCount).toBe(1);
        const { rows } = await owner.query<{ phone: string }>(
          'select phone from contact where id = $1',
          [PORTAL.motherContact],
        );
        expect(rows[0]?.phone).toBe('+971500000031');
      });
    });
  });

  it('refuses a contact the row of somebody else on the same record', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PORTAL.motherUser);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          // Row security itself refuses it: the update matches no row, so
          // nothing is changed and nothing is raised.
          const result = await owner.query(
            "update contact set phone = '+971500000032' where id = $1",
            [PORTAL.fatherContact],
          );
          expect(result.rowCount).toBe(0);
        },
        'client_contact',
      );
    });
  });

  it('refuses a contact every column but the three (the guard trigger)', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PORTAL.motherUser);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          for (const [statement, extra] of [
            ["update contact set relationship = 'guardian' where id = $1", null],
            ['update contact set can_consent = false where id = $1', null],
            ['update contact set given_name = $2 where id = $1', 'Laurel'],
            ['update contact set client_id = $2 where id = $1', PORTAL.childB],
            ['update contact set emirates_id_hash = null where id = $1', null],
          ] as const) {
            await expectRefused(
              owner,
              statement,
              extra === null ? [PORTAL.motherContact] : [PORTAL.motherContact, extra],
            );
          }
        },
        'client_contact',
      );
    });
  });

  it('refuses a contact handing their own row to somebody else', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PORTAL.motherUser);
      await asApiRole(
        owner,
        IDS.tenantA,
        () =>
          expectRefused(owner, 'update contact set user_id = $2 where id = $1', [
            PORTAL.motherContact,
            PORTAL.adultUser,
          ]),
        'client_contact',
      );
    });
  });

  it('lets the practice change everything, as it always could', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PORTAL.admin);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const result = await owner.query(
            "update contact set relationship = 'guardian' where id = $1",
            [PORTAL.fatherContact],
          );
          expect(result.rowCount).toBe(1);
        },
        'admin',
      );
    });
  });
});

describe('portal_request: the household asks, the office handles', () => {
  it('shows a contact their own request and never another household’s', async () => {
    await rolledBack(owner, async () => {
      const rows = await asContact(owner, PORTAL.motherUser, () =>
        owner.query<{ id: string }>('select id from portal_request'),
      );
      expect(rows.rows.map((r) => r.id)).toEqual([REQUEST]);
    });
  });

  it('lets a contact write one for their own client', async () => {
    await rolledBack(owner, async () => {
      await asContact(owner, PORTAL.motherUser, () =>
        owner.query(
          'insert into portal_request (tenant_id, client_id, contact_id, kind) ' +
            "values ($1, $2, $3, 'erasure')",
          [IDS.tenantA, PORTAL.childB, PORTAL.motherSecondContact],
        ),
      );
    });
  });

  it('refuses a contact one for a client that is not theirs', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PORTAL.motherUser);
      await asApiRole(
        owner,
        IDS.tenantA,
        () =>
          expectRefused(
            owner,
            'insert into portal_request (tenant_id, client_id, contact_id, kind) ' +
              "values ($1, $2, $3, 'erasure')",
            [IDS.tenantA, PORTAL.strangerClient, PORTAL.motherContact],
          ),
        'client_contact',
      );
    });
  });

  it('refuses a contact marking their own ask as handled', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PORTAL.motherUser);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const result = await owner.query(
            "update portal_request set status = 'handled', handled_at = now() where id = $1",
            [REQUEST],
          );
          // No update policy admits a contact, so the row is not there to update.
          expect(result.rowCount).toBe(0);
        },
        'client_contact',
      );
    });
  });

  it('lets the lead practitioner read and handle one', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PORTAL.leadPractitioner);
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const read = await owner.query('select id from portal_request where id = $1', [REQUEST]);
          expect(read.rowCount).toBe(1);
          const handled = await owner.query(
            "update portal_request set status = 'handled', handled_at = now(), " +
              'handled_by = $2 where id = $1',
            [REQUEST, PORTAL.leadPractitioner],
          );
          expect(handled.rowCount).toBe(1);
        },
        'lead_practitioner',
      );
    });
  });

  it('refuses the office every column but the handling (the guard trigger)', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, IDS.ownerA);
      await asApiRole(owner, IDS.tenantA, () =>
        expectRefused(owner, 'update portal_request set note = $2 where id = $1', [
          REQUEST,
          'A sentence the household never wrote.',
        ]),
      );
    });
  });

  it('shows a practitioner and finance nothing at all', async () => {
    await rolledBack(owner, async () => {
      for (const [userId, role] of [
        [PORTAL.practitioner, 'practitioner'],
        [PORTAL.finance, 'finance'],
      ] as const) {
        await setAuditContext(owner, userId);
        const rows = await asApiRole(
          owner,
          IDS.tenantA,
          () => owner.query('select id from portal_request'),
          role,
        );
        expect(rows.rowCount, role).toBe(0);
      }
    });
  });
});

describe('portal_invite: the owner and an admin, and nobody else at all', () => {
  it('shows the owner and an admin the invitation', async () => {
    await rolledBack(owner, async () => {
      for (const [userId, role] of [
        [IDS.ownerA, 'owner'],
        [PORTAL.admin, 'admin'],
      ] as const) {
        await setAuditContext(owner, userId);
        const rows = await asApiRole(
          owner,
          IDS.tenantA,
          () => owner.query('select id from portal_invite where id = $1', [INVITE]),
          role,
        );
        expect(rows.rowCount, role).toBe(1);
      }
    });
  });

  it('shows a lead practitioner, a practitioner and finance nothing', async () => {
    await rolledBack(owner, async () => {
      for (const [userId, role] of [
        [PORTAL.leadPractitioner, 'lead_practitioner'],
        [PORTAL.practitioner, 'practitioner'],
        [PORTAL.finance, 'finance'],
      ] as const) {
        await setAuditContext(owner, userId);
        const rows = await asApiRole(
          owner,
          IDS.tenantA,
          () => owner.query('select id from portal_invite'),
          role,
        );
        expect(rows.rowCount, role).toBe(0);
      }
    });
  });

  it('shows a contact nothing, not even their own invitation', async () => {
    await rolledBack(owner, async () => {
      const rows = await asContact(owner, PORTAL.motherUser, () =>
        owner.query('select id from portal_invite'),
      );
      expect(rows.rowCount).toBe(0);
    });
  });

  it('refuses a contact issuing one', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PORTAL.motherUser);
      await asApiRole(
        owner,
        IDS.tenantA,
        () =>
          expectRefused(
            owner,
            'insert into portal_invite (tenant_id, client_id, contact_id, user_id, kind, ' +
              "token_hash, expires_at) values ($1, $2, $3, $4, 'first_sign_in', " +
              "sha256('another-token'::bytea), now() + interval '7 days')",
            [IDS.tenantA, PORTAL.childA, PORTAL.motherContact, PORTAL.motherUser],
          ),
        'client_contact',
      );
    });
  });

  it('grants nobody a delete on either table', async () => {
    const grants = await owner.query<{ table_name: string }>(
      'select table_name from information_schema.role_table_grants ' +
        "where grantee = 'app_role' and privilege_type = 'DELETE' " +
        "and table_name in ('portal_invite', 'portal_request')",
    );
    expect(grants.rowCount).toBe(0);
  });
});

/** The statement is expected to be refused outright, not to match no row. */
async function expectRefused(
  client: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<void> {
  await client.query('savepoint expect_refusal');
  let code: string | undefined;
  try {
    await client.query(sql, params);
  } catch (error) {
    code = (error as { code?: string }).code;
  } finally {
    await client.query('rollback to savepoint expect_refusal');
  }
  if (code !== RLS_VIOLATION) {
    throw new Error(`expected SQLSTATE ${RLS_VIOLATION}, got ${code ?? 'success'}: ${sql}`);
  }
}
