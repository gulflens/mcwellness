import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rolledBack } from '../../db/helpers';
import { startHarness, type Harness } from './support';

/**
 * A discount, from the columns up (migration 409, docs/SPEC/billing.md
 * section 2.4). This file starts at the table — what the backfill left behind,
 * and which constraint refuses what — because a discount the database does not
 * itself hold to `list − discount` is a figure two readers can disagree about.
 */

// SEED_TODAY (2026-09-02) at 08:00 UTC is still 2026-09-02 in Asia/Dubai.
const NOW = () => new Date('2026-09-02T08:00:00.000Z');

const STATEMENT_INVOICE_NUMBER = 90_001;

let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

/**
 * The constraint that refused a statement, inside a savepoint so the
 * surrounding transaction survives. `rejectsWith` (tests/db/helpers.ts) proves
 * the SQLSTATE; a discount has several constraints answering the same
 * SQLSTATE, so these tests name the one they mean.
 */
async function refusedBy(client: pg.Client, sql: string, params: unknown[] = []): Promise<string> {
  await client.query('savepoint expect_refusal');
  try {
    await client.query(sql, params);
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string };
    expect(code).toBe('23514');
    return constraint ?? '';
  } finally {
    await client.query('rollback to savepoint expect_refusal');
  }
  throw new Error(`Expected a check violation: ${sql}`);
}

/** An invoice to hang a refused line off, inside a transaction nobody keeps. */
async function withStatementInvoice(fn: (invoiceId: string) => Promise<void>): Promise<void> {
  await rolledBack(h.owner, async () => {
    const { rows } = await h.owner.query<{ id: string }>(
      'insert into invoice (tenant_id, client_id, number, kind, issued_on, ' +
        "net_fils, vat_fils, gross_fils) values ($1, $2, $3, 'statement', '2026-09-02', " +
        '0, 0, 0) returning id',
      [h.data.tenant.id, h.clientId(0), STATEMENT_INVOICE_NUMBER],
    );
    const invoiceId = rows[0]?.id;
    if (!invoiceId) throw new Error('The statement invoice was not written.');
    await fn(invoiceId);
  });
}

const LINE_SQL =
  'insert into invoice_line (tenant_id, invoice_id, client_id, line_no, description, ' +
  'quantity, unit_net_fils, discount_fils, net_fils, vat_rate_basis_points, ' +
  'vat_setting_version, vat_fils, gross_fils) ' +
  "values ($1, $2, $3, 1, 'Neurofeedback session', 1, 70000, $4, $5, 0, 1, 0, $5)";

const PRICE_SQL =
  'insert into price (tenant_id, service_type_id, list_price_fils, discount_fils, ' +
  'discount_basis_points, unit_price_fils, vat_rate_basis_points, vat_setting_version, ' +
  "valid_from, amendment_reason) values ($1, $2, 70000, $3, $4, $5, 500, 1, '2027-01-01', " +
  "'A price this suite writes and never keeps.')";

const PACKAGE_PRICE_SQL =
  'insert into package_price (tenant_id, package_id, list_price_fils, discount_fils, ' +
  'amount_fils, vat_rate_basis_points, vat_setting_version, valid_from, amendment_reason) ' +
  "values ($1, $2, 1215000, 182500, $3, 500, 1, '2027-01-01', " +
  "'A price this suite writes and never keeps.')";

async function silverPackageId(): Promise<string> {
  const { rows } = await h.owner.query<{ id: string }>(
    "select id from package where code = 'silver' and tenant_id = $1",
    [h.data.tenant.id],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('The seeded Silver programme is missing.');
  return id;
}

describe('the backfill', () => {
  it('carries every existing price forward as its own list figure with no discount', async () => {
    const { rows } = await h.owner.query<{ total: string; plain: string }>(
      'select count(*)::text as total, ' +
        'count(*) filter (where list_price_fils = unit_price_fils and discount_fils = 0 ' +
        'and discount_basis_points is null)::text as plain from price',
    );
    expect(Number(rows[0]?.total)).toBeGreaterThan(0);
    expect(rows[0]?.plain).toBe(rows[0]?.total);
  });

  it('carries the launch package prices forward as list minus the difference', async () => {
    const { rows } = await h.owner.query<{
      list_price_fils: number;
      discount_fils: number;
      discount_basis_points: number | null;
      amount_fils: number;
    }>(
      'select pp.list_price_fils, pp.discount_fils, pp.discount_basis_points, pp.amount_fils ' +
        'from package_price pp join package p on p.id = pp.package_id ' +
        "where p.code = 'silver' and p.tenant_id = $1",
      [h.data.tenant.id],
    );
    expect(rows[0]).toEqual({
      list_price_fils: 1_215_000,
      discount_fils: 182_500,
      discount_basis_points: null,
      amount_fils: 1_032_500,
    });
  });
});

describe('an invoice line', () => {
  it('refuses an invoice line whose net is not quantity times unit less discount', async () => {
    await withStatementInvoice(async (invoiceId) => {
      // A fils out is still out: the line's arithmetic is the database's too.
      expect(
        await refusedBy(h.owner, LINE_SQL, [
          h.data.tenant.id,
          invoiceId,
          h.clientId(0),
          10_500,
          59_501,
        ]),
      ).toBe('invoice_line_net_is_quantity_times_unit_less_discount');
      await h.owner.query(LINE_SQL, [h.data.tenant.id, invoiceId, h.clientId(0), 10_500, 59_500]);
    });
  });

  it('refuses a discount larger than the line', async () => {
    await withStatementInvoice(async (invoiceId) => {
      expect(
        await refusedBy(h.owner, LINE_SQL, [
          h.data.tenant.id,
          invoiceId,
          h.clientId(0),
          70_001,
          -1,
        ]),
      ).toBe('invoice_line_discount_within_line');
    });
  });
});

describe('the price list', () => {
  it('refuses a price whose unit is not list less discount', async () => {
    await rolledBack(h.owner, async () => {
      const serviceTypeId = h.serviceTypeId('nf-session');
      expect(
        await refusedBy(h.owner, PRICE_SQL, [h.data.tenant.id, serviceTypeId, 10_500, 1500, 59_499]),
      ).toBe('price_unit_is_list_less_discount');
      await h.owner.query(PRICE_SQL, [h.data.tenant.id, serviceTypeId, 10_500, 1500, 59_500]);
    });
  });

  it('refuses a package price whose amount is not list less discount', async () => {
    await rolledBack(h.owner, async () => {
      const packageId = await silverPackageId();
      expect(await refusedBy(h.owner, PACKAGE_PRICE_SQL, [h.data.tenant.id, packageId, 1_032_499])).toBe(
        'package_price_amount_is_list_less_discount',
      );
      await h.owner.query(PACKAGE_PRICE_SQL, [h.data.tenant.id, packageId, 1_032_500]);
    });
  });

  it('refuses a discount percentage outside nought to a hundred', async () => {
    await rolledBack(h.owner, async () => {
      const serviceTypeId = h.serviceTypeId('nf-session');
      expect(
        await refusedBy(h.owner, PRICE_SQL, [h.data.tenant.id, serviceTypeId, 10_500, 10_001, 59_500]),
      ).toBe('price_discount_percent_range');
    });
  });
});
