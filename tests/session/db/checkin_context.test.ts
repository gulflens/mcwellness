import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, asApiRole, freshDatabase, seedClient, seedTenant } from '../../db/helpers';
import { seedConsent, seedConsentDocument } from './helpers';

/**
 * Direct coverage of app.checkin_context (db/migrations/301_checkin_context.sql):
 * the security-definer door app/api/sessions/checkin.ts reads a client's
 * check-in context through now that client-record's own restrictive read
 * policies (pull request 21, branch client-record, not merged into this
 * worktree) would otherwise stop a practitioner reading a client's status,
 * date of birth or consent at all. tests/session/db/checkin.test.ts already
 * proves the route's behaviour end to end; this file exercises the function
 * on its own, at the database, including the one case that file cannot: a
 * client that genuinely belongs to another tenant, read directly.
 */

const DOCUMENT = '00000000-0000-4000-8000-000000103001';

const CLIENT_ADULT = IDS.clientA; // tenant A
const CLIENT_MINOR = '00000000-0000-4000-8000-000000101002';
const CLIENT_NULL_DOB = '00000000-0000-4000-8000-000000101003';
const CLIENT_MARKETING_ONLY = '00000000-0000-4000-8000-000000101004';
const CLIENT_FOREIGN = IDS.clientB; // tenant B — never visible to a tenant A caller

const CONTACT_ADULT = '00000000-0000-4000-8000-000000102001';
const CONTACT_MARKETING = '00000000-0000-4000-8000-000000102002';

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');

  await seedClient(client, IDS.tenantA, CLIENT_ADULT, IDS.ownerA, 'Adult');
  await client.query('update client set date_of_birth = $1 where id = $2', [
    '1990-01-01',
    CLIENT_ADULT,
  ]);

  await seedClient(client, IDS.tenantA, CLIENT_MINOR, IDS.ownerA, 'Minor');
  await client.query('update client set date_of_birth = $1 where id = $2', [
    '2015-01-01',
    CLIENT_MINOR,
  ]);

  await seedClient(client, IDS.tenantA, CLIENT_NULL_DOB, IDS.ownerA, 'NullDob');

  await seedClient(client, IDS.tenantA, CLIENT_MARKETING_ONLY, IDS.ownerA, 'MarketingOnly');
  await client.query('update client set date_of_birth = $1 where id = $2', [
    '1990-01-01',
    CLIENT_MARKETING_ONLY,
  ]);

  await seedClient(client, IDS.tenantB, CLIENT_FOREIGN, IDS.ownerB, 'Foreign');

  await seedConsentDocument(client, IDS.tenantA, DOCUMENT);

  await client.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent) values ($1, $2, $3, $4, true)',
    [CONTACT_ADULT, IDS.tenantA, CLIENT_ADULT, 'mother'],
  );
  await client.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent) values ($1, $2, $3, $4, true)',
    [CONTACT_MARKETING, IDS.tenantA, CLIENT_MARKETING_ONLY, 'mother'],
  );

  await seedConsent(client, {
    id: '00000000-0000-4000-8000-000000104001',
    tenantId: IDS.tenantA,
    clientId: CLIENT_ADULT,
    givenByContactId: CONTACT_ADULT,
    purpose: 'participation',
    textDocumentId: DOCUMENT,
  });
  await seedConsent(client, {
    id: '00000000-0000-4000-8000-000000104002',
    tenantId: IDS.tenantA,
    clientId: CLIENT_ADULT,
    givenByContactId: CONTACT_ADULT,
    purpose: 'home_visit',
    textDocumentId: DOCUMENT,
  });
  // Withdrawn: must never surface, proving the "active, as of now" filter
  // survived the move from the route's own query into this function.
  await seedConsent(client, {
    id: '00000000-0000-4000-8000-000000104003',
    tenantId: IDS.tenantA,
    clientId: CLIENT_ADULT,
    givenByContactId: CONTACT_ADULT,
    purpose: 'minor_participation',
    textDocumentId: DOCUMENT,
    status: 'withdrawn',
  });

  // A real, active consent whose purpose sits outside canCheckIn's three:
  // proves the function's own filter narrows this, not merely the route's
  // isConsentPurpose type guard downstream.
  await client.query(
    'insert into consent (id, tenant_id, client_id, given_by_contact_id, purpose, version, ' +
      "text_document_id, status, method) values ($1, $2, $3, $4, 'marketing', 1, $5, 'active', 'app_signature')",
    [
      '00000000-0000-4000-8000-000000104004',
      IDS.tenantA,
      CLIENT_MARKETING_ONLY,
      CONTACT_MARKETING,
      DOCUMENT,
    ],
  );

  // asApiRole (tests/db/helpers.ts) runs each case inside a savepoint, which
  // only exists inside a transaction block — opened here, after the fixture
  // rows above are in place, and rolled back in afterAll.
  await client.query('begin');
});

afterAll(async () => {
  await client.query('rollback');
  await client.end();
});

describe('app.checkin_context', () => {
  it('finds an own-tenant client and reports its context', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        const { rows } = await client.query('select * from app.checkin_context($1)', [
          CLIENT_ADULT,
        ]);
        const row = rows[0];
        expect(row).toMatchObject({
          found: true,
          status: 'lead',
          has_date_of_birth: true,
          is_minor: false,
        });
        expect([...row.active_consent_purposes].sort()).toEqual(['home_visit', 'participation']);
      },
      'practitioner',
    );
  });

  it('reports is_minor for a client under 18, judged in the practice zone', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        const { rows } = await client.query('select * from app.checkin_context($1)', [
          CLIENT_MINOR,
        ]);
        expect(rows[0]).toMatchObject({ found: true, has_date_of_birth: true, is_minor: true });
      },
      'practitioner',
    );
  });

  it('reports has_date_of_birth false, and is_minor false, for a client with none on file', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        const { rows } = await client.query('select * from app.checkin_context($1)', [
          CLIENT_NULL_DOB,
        ]);
        expect(rows[0]).toMatchObject({ found: true, has_date_of_birth: false, is_minor: false });
      },
      'practitioner',
    );
  });

  it("never surfaces a consent purpose outside canCheckIn's three", async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        const { rows } = await client.query('select * from app.checkin_context($1)', [
          CLIENT_MARKETING_ONLY,
        ]);
        expect(rows[0]).toMatchObject({ found: true, active_consent_purposes: [] });
      },
      'practitioner',
    );
  });

  it('answers found = false for another tenant, and never returns a name', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        const result = await client.query('select * from app.checkin_context($1)', [
          CLIENT_FOREIGN,
        ]);
        expect(result.rows).toEqual([
          {
            found: false,
            status: null,
            has_date_of_birth: false,
            is_minor: false,
            active_consent_purposes: [],
          },
        ]);
        // Not just this row's values withheld: the column itself does not
        // exist to withhold. A name or contact detail could never ride along
        // even by accident.
        expect(result.fields.map((f) => f.name).sort()).toEqual(
          ['active_consent_purposes', 'found', 'has_date_of_birth', 'is_minor', 'status'].sort(),
        );
      },
      'practitioner',
    );
  });

  it('answers found = false for a client id that does not exist at all', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        const { rows } = await client.query('select * from app.checkin_context($1)', [
          '00000000-0000-4000-8000-000000000000',
        ]);
        expect(rows[0]).toMatchObject({ found: false });
      },
      'practitioner',
    );
  });
});
