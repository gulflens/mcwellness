import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  MORE_IDS,
  asApiRole,
  count,
  freshDatabase,
  rejectsWith,
  seedClient,
  seedContact,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

/**
 * The floor beneath the money routes: db/policies/billing/ledger.sql and the
 * grants in 401, 402, 403 and 404, proved directly against the database as
 * app_role.
 *
 * The routes already refuse the wrong role (tests/billing/db/packages.test.ts
 * and consumption.test.ts). This file proves the rows themselves are
 * unreachable underneath — that the screen asking first is a courtesy and the
 * database refusing is the boundary (docs/SPEC/00-data-model.md section 11).
 */

const RLS_VIOLATION = '42501';
const PRACTITIONER_USER = MORE_IDS.practitionerUserA;
const PRACTITIONER = MORE_IDS.practitionerA;
const PACKAGE_ID = '00000000-0000-4000-8000-0000000000d5';
const PURCHASE_ID = '00000000-0000-4000-8000-0000000000d6';
const INVOICE_ID = '00000000-0000-4000-8000-0000000000d7';
const ENTITLEMENT_ID = '00000000-0000-4000-8000-0000000000d8';
const PAYMENT_ID = '00000000-0000-4000-8000-0000000000d9';
const PACKAGE_PRICE_ID = '00000000-0000-4000-8000-0000000000da';
const LINE_ID = '00000000-0000-4000-8000-0000000000db';

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await seedServiceType(client, IDS.tenantA, MORE_IDS.serviceTypeA, 'nf-session');
  await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await seedContact(
    client,
    IDS.tenantA,
    IDS.contactA,
    IDS.clientA,
    'synthetic-contact-fingerprint',
  );
  await seedLocation(client, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);
  await seedUser(client, {
    id: PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner A',
    roles: ['practitioner'],
  });
  await seedPractitioner(client, IDS.tenantA, PRACTITIONER, PRACTITIONER_USER);

  await client.query(
    'insert into package (id, tenant_id, code, name, list_price_fils) ' +
      "values ($1, $2, 'silver', 'Silver', 1215000)",
    [PACKAGE_ID, IDS.tenantA],
  );
  await client.query(
    'insert into package_component (tenant_id, package_id, service_type_id, quantity, line_no) ' +
      'values ($1, $2, $3, 15, 1)',
    [IDS.tenantA, PACKAGE_ID, MORE_IDS.serviceTypeA],
  );
  await client.query(
    'insert into package_price (id, tenant_id, package_id, amount_fils, vat_rate_basis_points, ' +
      'vat_setting_version, valid_from, amendment_reason) values ($1, $2, $3, 1032500, 500, 1, ' +
      "'2026-09-02', 'Launch pricing for the row security tests')",
    [PACKAGE_PRICE_ID, IDS.tenantA, PACKAGE_ID],
  );
  // The purchase and its one credit go in together: 403's deferred
  // check_allocation refuses a sale whose credits do not total what was paid,
  // and it is checked at commit, not statement by statement.
  await client.query('begin');
  await client.query(
    'insert into package_purchase (id, tenant_id, client_id, package_id, package_name, ' +
      'purchased_on, net_fils, vat_fils, vat_rate_basis_points, vat_setting_version, ' +
      "list_price_fils, expires_on) values ($1, $2, $3, $4, 'Silver', '2026-09-02', 1032500, " +
      "51625, 500, 1, 1215000, '2027-09-02')",
    [PURCHASE_ID, IDS.tenantA, IDS.clientA, PACKAGE_ID],
  );
  await client.query(
    'insert into entitlement (id, tenant_id, client_id, service_type_id, source_type, ' +
      'package_purchase_id, allocated_net_fils, vat_rate_basis_points, vat_setting_version) ' +
      "values ($1, $2, $3, $4, 'package', $5, 1032500, 500, 1)",
    [ENTITLEMENT_ID, IDS.tenantA, IDS.clientA, MORE_IDS.serviceTypeA, PURCHASE_ID],
  );
  await client.query('commit');
  await client.query(
    'insert into invoice (id, tenant_id, client_id, number, kind, issued_on, ' +
      "package_purchase_id, net_fils, vat_fils, gross_fils) values ($1, $2, $3, 1, 'package', " +
      "'2026-09-02', $4, 1032500, 51625, 1084125)",
    [INVOICE_ID, IDS.tenantA, IDS.clientA, PURCHASE_ID],
  );
  await client.query(
    'insert into invoice_line (id, tenant_id, invoice_id, client_id, line_no, description, ' +
      'package_id, quantity, unit_net_fils, net_fils, vat_rate_basis_points, vat_setting_version, ' +
      "vat_fils, gross_fils) values ($1, $2, $3, $4, 1, 'Silver', $5, 1, 1032500, 1032500, 500, " +
      '1, 51625, 1084125)',
    [LINE_ID, IDS.tenantA, INVOICE_ID, IDS.clientA, PACKAGE_ID],
  );
  await client.query(
    'insert into payment (id, tenant_id, client_id, method, amount_fils, received_at, invoice_id) ' +
      "values ($1, $2, $3, 'transfer', 1084125, now(), $4)",
    [PAYMENT_ID, IDS.tenantA, IDS.clientA, INVOICE_ID],
  );
  await client.query(
    'insert into billing_exception (tenant_id, client_id, kind, detail) values ' +
      "($1, $2, 'unpriced_session', 'A visit was delivered with nothing to charge it at.')",
    [IDS.tenantA, IDS.clientA],
  );
  await client.query('begin');
});

afterAll(async () => {
  await client.query('rollback');
  await client.end();
});

describe('another practice', () => {
  it('sees none of this one’s money, whatever role it holds', async () => {
    await asApiRole(client, IDS.tenantB, async () => {
      for (const table of [
        'package',
        'package_component',
        'package_price',
        'package_purchase',
        'entitlement',
        'invoice',
        'invoice_line',
        'payment',
        'billing_exception',
      ]) {
        expect(await count(client, table), table).toBe(0);
      }
    });
  });
});

describe('a practitioner', () => {
  it('sees no catalogue: a price list is a sales instrument and they do not sell', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        expect(await count(client, 'package')).toBe(0);
        expect(await count(client, 'package_price')).toBe(0);
      },
      'practitioner',
    );
  });

  it('sees no money for a client who is not on their schedule', async () => {
    // app.client_visible_to_practitioner answers false: this practitioner
    // holds no appointment with this client (201_client_visible_to_practitioner.sql).
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        await client.query("select set_config('app.actor_id', $1, true)", [PRACTITIONER_USER]);
        expect(await count(client, 'entitlement')).toBe(0);
        expect(await count(client, 'invoice')).toBe(0);
        expect(await count(client, 'payment')).toBe(0);
        expect(await count(client, 'package_purchase')).toBe(0);
      },
      'practitioner',
    );
  });

  it('sees the balance of a client who is on their schedule, and only that', async () => {
    await client.query('savepoint scheduled');
    await client.query(
      'insert into appointment (tenant_id, client_id, practitioner_id, service_type_id, ' +
        'location_id, delivery_mode, window_start, window_end, status) values ($1, $2, $3, $4, $5, ' +
        "'home', '2026-09-10T06:00:00Z', '2026-09-10T06:45:00Z', 'confirmed')",
      [IDS.tenantA, IDS.clientA, PRACTITIONER, MORE_IDS.serviceTypeA, IDS.locationA],
    );
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        await client.query("select set_config('app.actor_id', $1, true)", [PRACTITIONER_USER]);
        expect(await count(client, 'entitlement')).toBe(1);
        expect(await count(client, 'invoice')).toBe(1);
        // Still no catalogue, and still nothing from the office's own queue.
        expect(await count(client, 'package')).toBe(0);
        expect(await count(client, 'billing_exception')).toBe(0);
      },
      'practitioner',
    );
    await client.query('rollback to savepoint scheduled');
  });

  it('records no money of their own', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        await client.query("select set_config('app.actor_id', $1, true)", [PRACTITIONER_USER]);
        await rejectsWith(
          client,
          RLS_VIOLATION,
          'insert into payment (tenant_id, client_id, method, amount_fils, received_at) ' +
            "values ($1, $2, 'cash', 50000, now())",
          [IDS.tenantA, IDS.clientA],
        );
        await rejectsWith(
          client,
          RLS_VIOLATION,
          'insert into package (tenant_id, code, name, list_price_fils) ' +
            "values ($1, 'sneaky', 'Sneaky', 1)",
          [IDS.tenantA],
        );
      },
      'practitioner',
    );
  });
});

describe('the lead practitioner', () => {
  it('reads the whole ledger and writes none of it', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        expect(await count(client, 'entitlement')).toBe(1);
        expect(await count(client, 'invoice')).toBe(1);
        expect(await count(client, 'package')).toBe(1);
        await rejectsWith(
          client,
          RLS_VIOLATION,
          'insert into payment (tenant_id, client_id, method, amount_fils, received_at) ' +
            "values ($1, $2, 'cash', 50000, now())",
          [IDS.tenantA, IDS.clientA],
        );
        // A restrictive policy on UPDATE filters rows rather than raising:
        // the statement succeeds and changes nothing, which is the same
        // outcome by a different route from the missing grants below. The
        // assertion is on the row count for exactly that reason.
        const attempt = await client.query(
          "update entitlement set status = 'refunded' where id = $1",
          [ENTITLEMENT_ID],
        );
        expect(attempt.rowCount).toBe(0);
      },
      'lead_practitioner',
    );
  });

  it('leaves the credit exactly as it was', async () => {
    const { rows } = await client.query<{ status: string }>(
      'select status from entitlement where id = $1',
      [ENTITLEMENT_ID],
    );
    expect(rows[0]?.status).toBe('available');
  });
});

describe('finance', () => {
  it('reads and records money, as the practice arranges it', async () => {
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        expect(await count(client, 'invoice')).toBe(1);
        await client.query('savepoint finance_writes');
        await client.query(
          'insert into payment (tenant_id, client_id, method, amount_fils, received_at) ' +
            "values ($1, $2, 'cash', 50000, now())",
          [IDS.tenantA, IDS.clientA],
        );
        await client.query('rollback to savepoint finance_writes');
      },
      'finance',
    );
  });
});

describe('a client contact', () => {
  it('reads their own household’s money and nobody else’s', async () => {
    await client.query('savepoint contact');
    await seedUser(client, {
      id: MORE_IDS.contactUserA,
      tenantId: IDS.tenantA,
      authId: null,
      displayName: 'Synthetic Contact A',
      roles: ['client_contact'],
    });
    await client.query('update contact set user_id = $1 where id = $2', [
      MORE_IDS.contactUserA,
      IDS.contactA,
    ]);
    await asApiRole(
      client,
      IDS.tenantA,
      async () => {
        await client.query("select set_config('app.actor_id', $1, true)", [MORE_IDS.contactUserA]);
        expect(await count(client, 'entitlement')).toBe(1);
        expect(await count(client, 'invoice')).toBe(1);
        expect(await count(client, 'payment')).toBe(1);
        // Not the catalogue, and not the office's queue.
        expect(await count(client, 'package')).toBe(0);
        expect(await count(client, 'billing_exception')).toBe(0);
        await rejectsWith(
          client,
          RLS_VIOLATION,
          'insert into payment (tenant_id, client_id, method, amount_fils, received_at) ' +
            "values ($1, $2, 'cash', 1, now())",
          [IDS.tenantA, IDS.clientA],
        );
      },
      'client_contact',
    );
    await client.query('rollback to savepoint contact');
  });
});

describe('append-only, by construction', () => {
  it('refuses to edit or delete an invoice, its lines, or a payment — even for the owner', async () => {
    await asApiRole(client, IDS.tenantA, async () => {
      for (const table of ['invoice', 'invoice_line', 'payment', 'package_price']) {
        await rejectsWith(
          client,
          RLS_VIOLATION,
          `update ${table} set created_at = now() where tenant_id = $1`,
          [IDS.tenantA],
        );
        await rejectsWith(client, RLS_VIOLATION, `delete from ${table} where tenant_id = $1`, [
          IDS.tenantA,
        ]);
      }
      // A purchase and a credit may change — a purchase is extended, a credit
      // is consumed — but neither is ever deleted.
      for (const table of ['package_purchase', 'entitlement', 'package']) {
        await rejectsWith(client, RLS_VIOLATION, `delete from ${table} where tenant_id = $1`, [
          IDS.tenantA,
        ]);
      }
    });
  });
});

describe('an erased record', () => {
  it('keeps its money for the two roles that may still see it, and nobody else', async () => {
    await client.query('savepoint erased');
    await client.query("update client set status = 'erased' where id = $1", [IDS.clientA]);
    for (const role of ['admin', 'finance']) {
      await asApiRole(
        client,
        IDS.tenantA,
        async () => {
          expect(await count(client, 'entitlement'), role).toBe(0);
          expect(await count(client, 'invoice'), role).toBe(0);
        },
        role,
      );
    }
    for (const role of ['owner', 'lead_practitioner']) {
      await asApiRole(
        client,
        IDS.tenantA,
        async () => {
          // Financial records outlive an erasure — five years regardless
          // (CLAUDE.md rule 8) — which is exactly why they narrow to these two.
          expect(await count(client, 'invoice'), role).toBe(1);
        },
        role,
      );
    }
    await client.query('rollback to savepoint erased');
  });
});
