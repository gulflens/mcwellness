import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PackagesResponse } from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import { requireDatabaseUrl } from '../../../db/runner/apply';
import {
  SEEDED,
  setPracticePrices,
  silverInput,
  SILVER_CODE,
  startHarness,
  type Harness,
} from './support';

/**
 * The credit-note number, under load and under failure.
 *
 * A credit note is a tax document and takes a sequential number of its own,
 * gapless for the reason the invoice number is (invoice_number.test.ts): a
 * Postgres sequence burns a number on every rolled-back transaction, so
 * 416_credit_note.sql takes it from a per-practice counter row with one
 * locking `update ... returning`, the shape of the receipt counter (405).
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');

let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

function tenantContext(): { sql: string; values: (string | null)[] } {
  const ownerUser = h.data.users[SEEDED.owner];
  return {
    sql:
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
      "set_config('app.actor_roles', 'owner', true), set_config('app.reason', '', true)",
    values: [h.data.tenant.id, ownerUser?.id ?? null],
  };
}

describe('credit notes taken at the same moment', () => {
  it('numbers credit notes CN-000001 upward with no gap under concurrency', async () => {
    const url = requireDatabaseUrl();
    const context = tenantContext();
    // Ten transactions, each on its own connection, all asking at once. The
    // counter row's lock makes them queue; two of them then change their minds.
    const rollsBack = new Set([3, 7]);
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, async (_, index) => {
        const connection = new pg.Client({ connectionString: url });
        await connection.connect();
        try {
          await connection.query('begin');
          await connection.query(context.sql, context.values);
          const taken = await connection.query<{ n: number }>(
            'select app.next_credit_note_number($1) as n',
            [h.data.tenant.id],
          );
          const number = taken.rows[0]?.n ?? -1;
          if (rollsBack.has(index)) {
            await connection.query('rollback');
            return { number, committed: false };
          }
          await connection.query('commit');
          return { number, committed: true };
        } finally {
          await connection.end();
        }
      }),
    );

    const committed = outcomes
      .filter((outcome) => outcome.committed)
      .map((outcome) => outcome.number)
      .sort((a, b) => a - b);
    // Eight committed, and they are one to eight: the two rolled-back numbers
    // were given back and taken by the next in the queue.
    expect(committed).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(committed.map((n) => `CN-${String(n).padStart(6, '0')}`)).toEqual([
      'CN-000001',
      'CN-000002',
      'CN-000003',
      'CN-000004',
      'CN-000005',
      'CN-000006',
      'CN-000007',
      'CN-000008',
    ]);

    const next = await h.owner.query<{ n: number }>('select app.next_credit_note_number($1) as n', [
      h.data.tenant.id,
    ]);
    expect(next.rows[0]?.n).toBe(9);
  });

  it('is granted to nobody, so no session can burn another practice’s numbers', async () => {
    const { rows } = await h.owner.query<{ allowed: boolean }>(
      "select has_function_privilege('app_role', 'app.next_credit_note_number(uuid)', 'execute') " +
        'as allowed',
    );
    expect(rows[0]?.allowed).toBe(false);
  });

  it('gives a practice that starts later its own book, at one', async () => {
    const other = '00000000-0000-4000-8000-0000000000b1';
    await h.owner.query("insert into tenant (id, legal_name) values ($1, 'Synthetic Studio C')", [
      other,
    ]);
    const { rows } = await h.owner.query<{ next_number: number }>(
      'select next_number from credit_note_series where tenant_id = $1',
      [other],
    );
    expect(rows[0]?.next_number).toBe(1);
  });
});

describe('a credit note, once written', () => {
  it('the app role can neither update nor delete a credit note', async () => {
    await setPracticePrices(h, SEED_TODAY);
    const created = await h.call(
      'POST',
      '/api/billing/packages',
      SEEDED.owner,
      silverInput(h, SEED_TODAY),
    );
    if (created.status !== 201) throw new Error('Silver could not be created.');
    const list = await h.call('GET', '/api/billing/packages', SEEDED.owner);
    const silver = ((await list.json()) as PackagesResponse).packages.find(
      (p) => p.code === SILVER_CODE,
    );
    if (!silver) throw new Error('Silver is missing.');
    const sold = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
      packageId: silver.id,
      clientId: h.clientId(0),
      purchasedOn: SEED_TODAY,
    });
    expect(sold.status).toBe(201);

    const invoice = await h.owner.query<{ id: string; net_fils: number; vat_fils: number }>(
      'select id, net_fils, vat_fils from invoice where client_id = $1',
      [h.clientId(0)],
    );
    const line = await h.owner.query<{ id: string }>(
      'select id from invoice_line where invoice_id = $1 order by line_no limit 1',
      [invoice.rows[0]?.id],
    );
    const inv = invoice.rows[0];
    if (!inv || !line.rows[0]) throw new Error('The sale left no invoice.');

    // As the owner of the tables, which bypasses grants: the note is written
    // by the function Task 3 adds, and that runs as the owner too.
    await h.owner.query('begin');
    const note = await h.owner.query<{ id: string; reference: string }>(
      'insert into credit_note (tenant_id, client_id, invoice_id, issued_on, reason, net_fils, ' +
        'vat_fils, gross_fils, supplier_legal_name, idempotency_key) ' +
        "values ($1, $2, $3, $4, 'Sold to the wrong household', $5, $6, $7, 'Synthetic Studio', " +
        "'key-1') returning id, reference",
      [
        h.data.tenant.id,
        h.clientId(0),
        inv.id,
        SEED_TODAY,
        inv.net_fils,
        inv.vat_fils,
        inv.net_fils + inv.vat_fils,
      ],
    );
    await h.owner.query(
      'insert into credit_note_line (tenant_id, credit_note_id, client_id, invoice_line_id, ' +
        'line_no, description, net_fils, vat_rate_basis_points, vat_setting_version, vat_fils, ' +
        'gross_fils) select $1, $2, $3, il.id, 1, il.description, il.net_fils, ' +
        'il.vat_rate_basis_points, il.vat_setting_version, il.vat_fils, il.gross_fils ' +
        'from invoice_line il where il.id = $4',
      [h.data.tenant.id, note.rows[0]?.id, h.clientId(0), line.rows[0].id],
    );
    await h.owner.query('commit');
    // Numbered by the database, after the nine the first test handed out.
    expect(note.rows[0]?.reference).toBe('CN-000010');

    const ownerUser = h.data.users[SEEDED.owner];
    for (const table of ['credit_note', 'credit_note_line']) {
      for (const statement of [`update ${table} set created_at = now()`, `delete from ${table}`]) {
        await h.owner.query('begin');
        await h.owner.query('set local role app_role');
        await h.owner.query(
          "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
            "set_config('app.actor_roles', 'owner', true)",
          [h.data.tenant.id, ownerUser?.id ?? null],
        );
        let code: string | undefined;
        try {
          await h.owner.query(statement);
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        await h.owner.query('rollback');
        expect(code, statement).toBe('42501');
      }
    }
  });

  it('refuses a line that credits more than its invoice line', async () => {
    const note = await h.owner.query<{ id: string; invoice_id: string }>(
      'select id, invoice_id from credit_note limit 1',
    );
    const row = note.rows[0];
    if (!row) throw new Error('The previous test left no credit note.');
    await h.owner.query('begin');
    await h.owner.query(
      'update credit_note_line set net_fils = net_fils + 1, gross_fils = gross_fils + 1 ' +
        'where credit_note_id = $1',
      [row.id],
    );
    await h.owner.query(
      'update credit_note set net_fils = net_fils + 1, gross_fils = gross_fils + 1 where id = $1',
      [row.id],
    );
    let code: string | undefined;
    try {
      await h.owner.query('commit');
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    if (code === undefined) {
      await h.owner.query('rollback');
    }
    expect(code).toBe('23514');
  });
});
