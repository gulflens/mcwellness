import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SellPackageResponse } from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import {
  SEEDED,
  setPracticePrices,
  silverInput,
  SILVER_CODE,
  startHarness,
  type Harness,
} from './support';

/**
 * VAT is charged because the practice is registered for it, and for no other
 * reason (migration 406, docs/CHANGE-REQUESTS/trunk-notes.md round 20).
 *
 * The synthetic practice is not registered, because the real one is not: its
 * tax certificate is a corporate-tax registration and the AED 375,000 VAT
 * threshold has not been crossed (docs/SPEC/billing.md section 5.1). So the
 * default state of every test here is "unregistered", and registering is the
 * deliberate act.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const REQUEST_ID = '00000000-0000-4000-8000-0000000000ef';

let h: Harness;

/**
 * Stamps the owner's roles on the connection. The practice's identity is
 * floored to an owner or an admin in the database itself
 * (app.guard_tenant_identity, migration 905), so a fixture that changes the
 * registration has to be somebody entitled to — which is the right shape for
 * the fixture anyway: registering for VAT is the owner's act.
 */
async function asOwner(): Promise<void> {
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'owner,admin,finance,lead_practitioner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, REQUEST_ID],
  );
}

/** Registers the practice for VAT, as the Practice settings screen would. */
async function registerForVat(): Promise<void> {
  await asOwner();
  await h.owner.query(
    "update tenant set vat_registered = true, vat_trn = '100000000000003' where id = $1",
    [h.data.tenant.id],
  );
}

async function unregisterForVat(): Promise<void> {
  await asOwner();
  await h.owner.query('update tenant set vat_registered = false, vat_trn = null where id = $1', [
    h.data.tenant.id,
  ]);
}

/**
 * Stamps the transaction settings the request-context middleware would, as the
 * seeded practitioner closing their own visit: no billing role at all.
 */
async function asPractitioner(): Promise<void> {
  const user = h.data.users[SEEDED.practitioner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'practitioner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, REQUEST_ID],
  );
}

let sessionSeq = 0;

/** A visit delivered: the one statement the session-capture stream runs. */
async function deliverVisit(clientId: string, serviceCode: string): Promise<string> {
  sessionSeq += 1;
  const id = `00000000-0000-4000-8000-00000000d${String(sessionSeq).padStart(3, '0')}`;
  const practitioner = h.data.practitioners[0];
  await asPractitioner();
  await h.owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', 'completed', now())",
    [id, h.data.tenant.id, clientId, practitioner?.id, h.serviceTypeId(serviceCode)],
  );
  return id;
}

type InvoiceFigures = {
  net_fils: number;
  vat_fils: number;
  gross_fils: number;
  supplier_vat_registered: boolean | null;
  line_rate: number;
  line_vat_fils: number;
  line_setting_version: number;
};

async function invoiceForSession(sessionId: string): Promise<InvoiceFigures> {
  const { rows } = await h.owner.query<InvoiceFigures>(
    'select i.net_fils, i.vat_fils, i.gross_fils, i.supplier_vat_registered, ' +
      'l.vat_rate_basis_points as line_rate, l.vat_fils as line_vat_fils, ' +
      'l.vat_setting_version as line_setting_version ' +
      'from invoice i join invoice_line l on l.invoice_id = i.id where i.session_id = $1',
    [sessionId],
  );
  const row = rows[0];
  if (!row) throw new Error('That visit was not invoiced.');
  return row;
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('a practice that is not registered for VAT', () => {
  it('charges no VAT on a single visit, and the gross is the net', async () => {
    await unregisterForVat();
    const sessionId = await deliverVisit(h.clientId(0), 'nf-session');
    const invoice = await invoiceForSession(sessionId);

    expect(invoice.net_fils).toBe(70_000);
    expect(invoice.vat_fils).toBe(0);
    expect(invoice.gross_fils).toBe(70_000);
    expect(invoice.supplier_vat_registered).toBe(false);
  });

  it('stamps a zero rate on the line, so the document and the money agree', async () => {
    await unregisterForVat();
    const sessionId = await deliverVisit(h.clientId(1), 'nf-session');
    const invoice = await invoiceForSession(sessionId);

    expect(invoice.line_rate).toBe(0);
    expect(invoice.line_vat_fils).toBe(0);
    // The setting that was consulted still travels: it is a foreign key and a
    // record of what the rate was, not a claim about what was charged.
    expect(invoice.line_setting_version).toBeGreaterThanOrEqual(1);
  });

  it('charges no VAT when a programme is sold', async () => {
    await unregisterForVat();
    const created = await h.call(
      'POST',
      '/api/billing/packages',
      SEEDED.owner,
      silverInput(h, SEED_TODAY),
      { 'x-reason': 'The practice sets its own launch pricing.' },
    );
    expect(created.status).toBe(201);

    const listed = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    const packages = (await listed.json()) as { packages: { id: string; code: string }[] };
    const silver = packages.packages.find((p) => p.code === SILVER_CODE);
    if (!silver) throw new Error('Silver was not in the catalogue.');

    const sold = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silver.id,
      clientId: h.clientId(2),
      purchasedOn: SEED_TODAY,
    });
    expect(sold.status).toBe(201);
    const body = (await sold.json()) as SellPackageResponse;

    expect(body.purchase.netFils).toBe(1_032_500);
    expect(body.purchase.vatFils).toBe(0);
    expect(body.purchase.grossFils).toBe(1_032_500);

    const { rows } = await h.owner.query<{ vat_fils: number; line_rate: number }>(
      'select i.vat_fils, l.vat_rate_basis_points as line_rate from invoice i ' +
        'join invoice_line l on l.invoice_id = i.id where i.package_purchase_id = $1',
      [body.purchase.id],
    );
    expect(rows[0]?.vat_fils).toBe(0);
    expect(rows[0]?.line_rate).toBe(0);
  });

  it('refuses an invoice written by hand that carries VAT anyway', async () => {
    await unregisterForVat();
    // The rule request 1b asked for, enforced as migration 406's guard trigger
    // because a 4xx migration runs before the 9xx column it would name. The
    // guarantee is the same one: no invoice carries VAT for an unregistered
    // practice, whichever path wrote it.
    await expect(
      h.owner.query(
        'insert into invoice (tenant_id, client_id, number, kind, issued_on, ' +
          'net_fils, vat_fils, gross_fils) values ($1, $2, 9001, ' +
          "'statement', $3, 10000, 500, 10500)",
        [h.data.tenant.id, h.clientId(3), SEED_TODAY],
      ),
    ).rejects.toThrow(/not registered/i);
  });

  it('accepts the same invoice once the VAT on it is nothing', async () => {
    await unregisterForVat();
    const inserted = await h.owner.query(
      'insert into invoice (tenant_id, client_id, number, kind, issued_on, ' +
        "net_fils, vat_fils, gross_fils) values ($1, $2, 9002, 'statement', $3, " +
        '10000, 0, 10000) returning id',
      [h.data.tenant.id, h.clientId(3), SEED_TODAY],
    );
    expect(inserted.rows).toHaveLength(1);
  });
});

describe('a practice that is registered for VAT', () => {
  it('charges the standard five per cent on a single visit', async () => {
    await registerForVat();
    const sessionId = await deliverVisit(h.clientId(4), 'nf-session');
    const invoice = await invoiceForSession(sessionId);

    expect(invoice.net_fils).toBe(70_000);
    expect(invoice.vat_fils).toBe(3_500);
    expect(invoice.gross_fils).toBe(73_500);
    expect(invoice.supplier_vat_registered).toBe(true);
    expect(invoice.line_rate).toBe(500);
    expect(invoice.line_vat_fils).toBe(3_500);
  });

  it('leaves the net price alone: registering adds VAT on top, it does not carve it out', async () => {
    await registerForVat();
    const sessionId = await deliverVisit(h.clientId(5), 'brain-map');
    const invoice = await invoiceForSession(sessionId);

    expect(invoice.net_fils).toBe(82_500);
    expect(invoice.gross_fils).toBe(86_625);
  });
});

describe('switching the registration on', () => {
  it('changes what later invoices charge and nothing already issued', async () => {
    await unregisterForVat();
    const before = await deliverVisit(h.clientId(6), 'nf-session');
    const issuedUnregistered = await invoiceForSession(before);
    expect(issuedUnregistered.vat_fils).toBe(0);

    await registerForVat();
    const after = await deliverVisit(h.clientId(7), 'nf-session');
    expect((await invoiceForSession(after)).vat_fils).toBe(3_500);

    // The invoice issued while unregistered still says what it said. It is
    // append-only, it snapshots the registration it was numbered under, and a
    // rendered document reads that snapshot rather than the practice's row.
    const unchanged = await invoiceForSession(before);
    expect(unchanged.vat_fils).toBe(0);
    expect(unchanged.gross_fils).toBe(70_000);
    expect(unchanged.supplier_vat_registered).toBe(false);
    expect(unchanged.line_rate).toBe(0);
  });
});

describe('the ways round the rule, all closed', () => {
  it('refuses an invoice that names its own supplier and says nothing about the registration', async () => {
    // app.stamp_invoice_supplier returns early when a caller supplies
    // supplier_legal_name, leaving supplier_vat_registered exactly as the caller
    // left it. A first draft of the guard read that null as "says nothing" and
    // let it through, which is how VAT gets onto an invoice from a practice that
    // holds no registration.
    await unregisterForVat();
    await expect(
      h.owner.query(
        'insert into invoice (tenant_id, client_id, number, kind, issued_on, ' +
          'supplier_legal_name, net_fils, vat_fils, gross_fils) values ($1, $2, 9101, ' +
          "'statement', $3, 'Somebody Else', 10000, 500, 10500)",
        [h.data.tenant.id, h.clientId(3), SEED_TODAY],
      ),
    ).rejects.toThrow(/not registered/i);
  });

  it('refuses a line that carries VAT under an invoice that carries none', async () => {
    // Nothing tied a line's rate to its header, and the rendered document reads
    // the lines: the totals could be zero and honest while every line beneath
    // them printed five per cent.
    await unregisterForVat();
    const invoice = await h.owner.query<{ id: string }>(
      'insert into invoice (tenant_id, client_id, number, kind, issued_on, ' +
        "net_fils, vat_fils, gross_fils) values ($1, $2, 9102, 'statement', $3, " +
        '10000, 0, 10000) returning id',
      [h.data.tenant.id, h.clientId(3), SEED_TODAY],
    );
    const { rows } = await h.owner.query<{ version: number }>(
      'select version from vat_setting where tenant_id = $1 order by version desc limit 1',
      [h.data.tenant.id],
    );

    await expect(
      h.owner.query(
        'insert into invoice_line (tenant_id, invoice_id, client_id, line_no, description, ' +
          'quantity, unit_net_fils, net_fils, vat_rate_basis_points, vat_setting_version, ' +
          "vat_fils, gross_fils) values ($1, $2, $3, 1, 'A visit', 1, 10000, 10000, 500, " +
          '$4, 500, 10500)',
        [h.data.tenant.id, invoice.rows[0]?.id, h.clientId(3), rows[0]?.version],
      ),
    ).rejects.toThrow(/not registered/i);
  });
});
