import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  MORE_IDS,
  asApiRole,
  count,
  freshDatabase,
  rejectsWith,
  seedServiceType,
  seedTenant,
} from '../../db/helpers';

/**
 * The floor beneath the routes: db/policies/billing/catalogue.sql and
 * 400_billing_catalogue.sql's grants, proved directly against the database
 * as app_role, the same way tests/db/rls.test.ts proves the core tables.
 * The API route already refuses a practitioner and a client contact
 * (tests/billing/db/prices.test.ts); this file proves the row itself is
 * unreachable underneath, not only that the route happens to ask first.
 */

const RLS_VIOLATION = '42501';
const PRICE_ID = '00000000-0000-4000-8000-0000000000f9';

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
  // seedTenant fires app.default_vat_setting(): one vat_setting row exists
  // for this tenant from the moment it does.
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedServiceType(client, IDS.tenantA, MORE_IDS.serviceTypeA, 'nf-session');
  await client.query(
    'insert into price (id, tenant_id, service_type_id, unit_price_fils, vat_rate_basis_points, ' +
      'vat_setting_version, valid_from, amendment_reason) values ' +
      "($1, $2, $3, 90000, 500, 1, '2018-01-01', 'Seed price for the RLS floor tests')",
    [PRICE_ID, IDS.tenantA, MORE_IDS.serviceTypeA],
  );
  await client.query('begin');
});

afterAll(async () => {
  await client.query('rollback');
  await client.end();
});

describe('who may read the catalogue', () => {
  it('a practitioner sees no prices and no VAT setting', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        expect(await count(client, 'price')).toBe(0);
        expect(await count(client, 'vat_setting')).toBe(0);
      },
      'practitioner',
    );
  });

  it('a client contact sees no prices and no VAT setting', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        expect(await count(client, 'price')).toBe(0);
        expect(await count(client, 'vat_setting')).toBe(0);
      },
      'client_contact',
    );
  });

  it('a lead practitioner sees the price list and the VAT setting', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        expect(await count(client, 'price')).toBe(1);
        expect(await count(client, 'vat_setting')).toBe(1);
      },
      'lead_practitioner',
    );
  });
});

describe('who may write the catalogue', () => {
  it('a practitioner cannot insert a price or a VAT setting', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        await rejectsWith(
          client,
          RLS_VIOLATION,
          'insert into price (tenant_id, service_type_id, unit_price_fils, vat_rate_basis_points, ' +
            'vat_setting_version, valid_from, amendment_reason) values ($1, $2, 10000, 500, 1, ' +
            "'2026-09-02', 'Attempted by a practitioner')",
          [IDS.tenantA, MORE_IDS.serviceTypeA],
        );
        await rejectsWith(
          client,
          RLS_VIOLATION,
          'insert into vat_setting (tenant_id, version, rate_basis_points, effective_from, ' +
            'amendment_reason) values ($1, 2, 600, $2, $3)',
          [IDS.tenantA, '2027-01-01', 'Attempted rate change'],
        );
      },
      'practitioner',
    );
  });

  it('a client contact cannot insert a price or a VAT setting', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        await rejectsWith(
          client,
          RLS_VIOLATION,
          'insert into price (tenant_id, service_type_id, unit_price_fils, vat_rate_basis_points, ' +
            'vat_setting_version, valid_from, amendment_reason) values ($1, $2, 10000, 500, 1, ' +
            "'2026-09-02', 'Attempted by a client contact')",
          [IDS.tenantA, MORE_IDS.serviceTypeA],
        );
        await rejectsWith(
          client,
          RLS_VIOLATION,
          'insert into vat_setting (tenant_id, version, rate_basis_points, effective_from, ' +
            'amendment_reason) values ($1, 2, 600, $2, $3)',
          [IDS.tenantA, '2027-01-01', 'Attempted rate change'],
        );
      },
      'client_contact',
    );
  });

  it('a lead practitioner can read the price list but cannot insert a price', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        await rejectsWith(
          client,
          RLS_VIOLATION,
          'insert into price (tenant_id, service_type_id, unit_price_fils, vat_rate_basis_points, ' +
            'vat_setting_version, valid_from, amendment_reason) values ($1, $2, 10000, 500, 1, ' +
            "'2026-09-02', 'Attempted by a lead practitioner')",
          [IDS.tenantA, MORE_IDS.serviceTypeA],
        );
      },
      'lead_practitioner',
    );
  });

  it('finance may set a price but not the VAT rate: the rate is a practice setting, not a price', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        await client.query(
          'insert into price (tenant_id, service_type_id, unit_price_fils, vat_rate_basis_points, ' +
            'vat_setting_version, valid_from, amendment_reason) values ($1, $2, 11000, 500, 1, ' +
            "'2026-09-03', 'Set by finance')",
          [IDS.tenantA, MORE_IDS.serviceTypeA],
        );
        await rejectsWith(
          client,
          RLS_VIOLATION,
          'insert into vat_setting (tenant_id, version, rate_basis_points, effective_from, ' +
            'amendment_reason) values ($1, 3, 600, $2, $3)',
          [IDS.tenantA, '2028-01-01', 'Attempted rate change by finance'],
        );
      },
      'finance',
    );
  });
});

describe('append-only: neither table grants update or delete to app_role', () => {
  it('refuses to update or delete a price, even as the owner', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        await rejectsWith(
          client,
          RLS_VIOLATION,
          'update price set unit_price_fils = 1 where id = $1',
          [PRICE_ID],
        );
        await rejectsWith(client, RLS_VIOLATION, 'delete from price where id = $1', [PRICE_ID]);
      },
      'owner',
    );
  });

  it('refuses to update or delete a VAT setting, even as the owner', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        await rejectsWith(
          client,
          RLS_VIOLATION,
          'update vat_setting set rate_basis_points = 1 where tenant_id = $1',
          [IDS.tenantA],
        );
        await rejectsWith(client, RLS_VIOLATION, 'delete from vat_setting where tenant_id = $1', [
          IDS.tenantA,
        ]);
      },
      'owner',
    );
  });
});
