import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase } from '../../db/helpers';

/**
 * Every billing table, audited the way every trunk table is.
 *
 * Most of these grant no update and no delete to `app_role`, which is what
 * makes them append-only from the API. It is not what makes them
 * append-only in the database: the owner role bypasses grants, and so does
 * every security-definer function in `db/migrations/40*`. A trigger that
 * watched inserts alone would have left the one path that can actually
 * rewrite history as the one path that leaves no trace.
 *
 * So the assertion is coverage, not policy: whatever reaches these tables,
 * the trail sees it.
 */

const BILLING_TABLES = [
  'package',
  'package_component',
  'package_price',
  'package_purchase',
  'entitlement',
  'invoice',
  'invoice_line',
  'payment',
  'billing_exception',
  'invoice_number_series',
  'price',
  'vat_setting',
] as const;

let db: pg.Client;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db.end();
});

describe('the audit trigger on the money', () => {
  it('watches inserts, updates and deletes on every billing table', async () => {
    // tgtype is a bitmask: 4 insert, 8 delete, 16 update (pg_trigger).
    const { rows } = await db.query<{
      table: string;
      insert: boolean;
      update: boolean;
      del: boolean;
    }>(
      'select c.relname as table, (t.tgtype & 4) <> 0 as insert, (t.tgtype & 16) <> 0 as update, ' +
        '(t.tgtype & 8) <> 0 as del from pg_trigger t join pg_class c on c.oid = t.tgrelid ' +
        "where t.tgname = 'audit_row' and c.relname = any($1::text[]) order by 1",
      [[...BILLING_TABLES]],
    );
    const seen = new Map(rows.map((row) => [row.table, row]));
    for (const table of BILLING_TABLES) {
      const row = seen.get(table);
      expect(row, `${table} has no audit trigger`).toBeDefined();
      expect(row?.insert, `${table} does not audit inserts`).toBe(true);
      expect(row?.update, `${table} does not audit updates`).toBe(true);
      expect(row?.del, `${table} does not audit deletes`).toBe(true);
    }
  });

  it('fires those triggers even for the table owner', async () => {
    // enable always ('A'), not the default 'O': a security-definer function
    // running as the owner is exactly the case that matters here.
    const { rows } = await db.query<{ table: string; enabled: string }>(
      'select c.relname as table, t.tgenabled as enabled from pg_trigger t ' +
        'join pg_class c on c.oid = t.tgrelid ' +
        "where t.tgname = 'audit_row' and c.relname = any($1::text[])",
      [[...BILLING_TABLES]],
    );
    for (const row of rows) {
      expect(row.enabled, `${row.table} is not "enable always"`).toBe('A');
    }
  });
});
