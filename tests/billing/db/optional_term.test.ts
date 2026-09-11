import { readdir, readFile } from 'node:fs/promises';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyPolicies,
  connect,
  requireDatabaseUrl,
  resetDatabase,
} from '../../../db/runner/apply';
import { hasRollbackBlock, isLocalDatabaseUrl, listMigrationFiles } from '../../../db/runner/plan';
import { rejectsWith, rolledBack } from '../../db/helpers';

/**
 * Migration 964: a programme's term is optional.
 *
 * `package` and `price` each carry a number and a unit, both nullable and
 * whole or absent, and an absent term means the credits never expire (the
 * operator, 2026-09-11 and 2026-09-12). The programmes that already had a term
 * in months keep it, carried across before `expiry_months` is dropped.
 *
 * freshDatabase() (tests/db/helpers.ts) applies every migration to an empty
 * schema in one pass, so there is never a package for the backfill to find —
 * right on a database that has never had one, and no proof of the backfill at
 * all. This suite does what tests/billing/db/vat-setting-backfill.test.ts does
 * for migration 400: it applies every migration up to 964, writes the rows the
 * backfill has to carry, and only then applies 964 itself. Nothing here edits
 * db/runner; every piece it borrows is imported.
 *
 * Every identifier and every person below is synthetic (.claude/rules/testing.md).
 */

const MIGRATIONS_DIR = new URL('../../../db/migrations/', import.meta.url);
const CHECK_VIOLATION = '23514';

const TENANT_ID = '00000000-0000-4000-8000-0000000009a0';
const OWNER_ID = '00000000-0000-4000-8000-0000000009a1';
const SERVICE_TYPE_ID = '00000000-0000-4000-8000-0000000009a2';
const CLIENT_ID = '00000000-0000-4000-8000-0000000009a3';
const PACKAGE_TWELVE = '00000000-0000-4000-8000-0000000009a4';
const PACKAGE_SIX = '00000000-0000-4000-8000-0000000009a5';
const CREDIT_DATED = '00000000-0000-4000-8000-0000000009a7';
const CREDIT_NEVER = '00000000-0000-4000-8000-0000000009a8';
const CREDIT_SPENT = '00000000-0000-4000-8000-0000000009a9';

/** The day the ledger is asked about, and one long after every dated credit. */
const TODAY = '2026-09-12';
const YEARS_LATER = '2030-01-01';

let owner: pg.Client;

/**
 * One migration file, applied as db/runner/apply.ts's runMigrations() applies
 * each pending file: rollback block required, one transaction, recorded in
 * schema_migration.
 */
async function applyMigrationFile(client: pg.Client, filename: string): Promise<void> {
  const sql = await readFile(new URL(filename, MIGRATIONS_DIR), 'utf8');
  if (!hasRollbackBlock(sql)) {
    throw new Error(`${filename} has no "-- rollback:" block.`);
  }
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('insert into schema_migration (filename) values ($1)', [filename]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/** A credit for the seeded household, available, with the expiry given. */
async function credit(id: string, expiresOn: string | null): Promise<void> {
  await owner.query(
    'insert into entitlement (id, tenant_id, client_id, service_type_id, source_type, ' +
      'allocated_net_fils, vat_rate_basis_points, vat_setting_version, expires_on) ' +
      "values ($1, $2, $3, $4, 'complimentary', 0, 500, 1, $5)",
    [id, TENANT_ID, CLIENT_ID, SERVICE_TYPE_ID, expiresOn],
  );
}

/** The oldest usable credit, as the consumption trigger asks for it. */
async function oldestOn(on: string): Promise<string | null> {
  await owner.query("select set_config('app.tenant_id', $1, false)", [TENANT_ID]);
  const { rows } = await owner.query<{ id: string | null }>(
    'select app.oldest_available_entitlement($1, $2, $3) as id',
    [CLIENT_ID, SERVICE_TYPE_ID, on],
  );
  return rows[0]?.id ?? null;
}

beforeAll(async () => {
  const url = requireDatabaseUrl();
  if (!isLocalDatabaseUrl(url)) {
    throw new Error('This test only runs against a local database.');
  }
  if ((process.env.APP_ENV ?? 'development') !== 'development') {
    throw new Error('This test only runs with APP_ENV=development.');
  }

  owner = await connect(url);
  await resetDatabase(owner);
  await owner.query(
    'create table if not exists schema_migration (filename text primary key, ' +
      'applied_at timestamptz not null default now())',
  );
  await owner.query('alter table schema_migration enable row level security');

  const files = listMigrationFiles(await readdir(MIGRATIONS_DIR));
  const before400 = files.filter((file) => file.number < 400);
  const between = files.filter((file) => file.number >= 400 && file.number < 964);
  const nine64 = files.filter((file) => file.number === 964);
  if (nine64.length !== 1) {
    throw new Error('db/migrations/964_optional_package_term.sql is missing.');
  }

  for (const file of before400) {
    await applyMigrationFile(owner, file.filename);
  }
  // The practice exists before 400 runs, so its VAT setting is the one 400's
  // own backfill writes: version 1, the UAE standard rate.
  await owner.query("insert into tenant (id, legal_name) values ($1, 'Synthetic Term Practice')", [
    TENANT_ID,
  ]);
  for (const file of between) {
    await applyMigrationFile(owner, file.filename);
  }

  await owner.query(
    'insert into app_user (id, tenant_id, display_name) values ($1, $2, ' +
      "'Synthetic Term Owner')",
    [OWNER_ID, TENANT_ID],
  );
  await owner.query("insert into user_role (tenant_id, user_id, role) values ($1, $2, 'owner')", [
    TENANT_ID,
    OWNER_ID,
  ]);
  await owner.query(
    'insert into service_type (id, tenant_id, code, name, duration_minutes, delivery_modes) ' +
      "values ($1, $2, 'nf-session', 'Neurofeedback session', 45, array['home']::delivery_mode[])",
    [SERVICE_TYPE_ID, TENANT_ID],
  );
  await owner.query(
    'insert into client (id, tenant_id, mrn, given_name, family_name, created_by) ' +
      "values ($1, $2, 'MW-9000A3', 'Synthetic', 'Household', $3)",
    [CLIENT_ID, TENANT_ID, OWNER_ID],
  );

  // The two programmes the backfill has to carry: the twelve months every
  // package had before 410, and the six 410 made the default.
  await owner.query(
    'insert into package (id, tenant_id, code, name, list_price_fils, expiry_months) ' +
      "values ($1, $2, 'term-twelve', 'Twelve-month programme', 1215000, 12), " +
      "($3, $2, 'term-six', 'Six-month programme', 607500, 6)",
    [PACKAGE_TWELVE, TENANT_ID, PACKAGE_SIX],
  );

  // Three credits: one that has already run out, one that runs out in 2027,
  // and one that never does.
  await credit(CREDIT_SPENT, '2026-01-01');
  await credit(CREDIT_DATED, '2027-01-31');
  await credit(CREDIT_NEVER, null);

  await applyMigrationFile(owner, nine64[0]?.filename ?? '');
  // The policy pass, as db:migrate runs it: proof that no policy file still
  // names the table 964 dropped, which would fail the whole pass.
  await applyPolicies(owner);
});

afterAll(async () => {
  await owner.end();
});

describe("964's backfill", () => {
  it('carries every term a programme already had into the pair, unchanged', async () => {
    const { rows } = await owner.query<{
      code: string;
      expiry_amount: number | null;
      expiry_unit: string | null;
    }>('select code, expiry_amount, expiry_unit from package order by code');
    expect(rows).toEqual([
      { code: 'term-six', expiry_amount: 6, expiry_unit: 'month' },
      { code: 'term-twelve', expiry_amount: 12, expiry_unit: 'month' },
    ]);
  });

  it('leaves no expiry_months behind for a second reader to disagree with', async () => {
    const { rows } = await owner.query<{ exists: boolean }>(
      "select exists (select 1 from information_schema.columns where table_schema = 'public' " +
        "and table_name = 'package' and column_name = 'expiry_months') as exists",
    );
    expect(rows[0]?.exists).toBe(false);
  });
});

describe('a term on a programme', () => {
  it('is accepted absent, which is what "never expires" looks like', async () => {
    await rolledBack(owner, async () => {
      const { rows } = await owner.query<{
        expiry_amount: number | null;
        expiry_unit: string | null;
      }>(
        'insert into package (tenant_id, code, name, list_price_fils) ' +
          "values ($1, 'term-none', 'Programme with no term', 900000) " +
          'returning expiry_amount, expiry_unit',
        [TENANT_ID],
      );
      expect(rows[0]).toEqual({ expiry_amount: null, expiry_unit: null });
    });
  });

  it('is accepted whole, in either unit', async () => {
    await rolledBack(owner, async () => {
      const { rows } = await owner.query<{ expiry_amount: number; expiry_unit: string }>(
        'insert into package (tenant_id, code, name, list_price_fils, expiry_amount, expiry_unit) ' +
          "values ($1, 'term-days', 'Programme in days', 90000, 30, 'day'), " +
          "($1, 'term-months', 'Programme in months', 90000, 3, 'month') " +
          'returning expiry_amount, expiry_unit',
        [TENANT_ID],
      );
      expect(rows).toEqual([
        { expiry_amount: 30, expiry_unit: 'day' },
        { expiry_amount: 3, expiry_unit: 'month' },
      ]);
    });
  });

  it('refuses a number with no unit beside it', async () => {
    await rolledBack(owner, async () => {
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        'insert into package (tenant_id, code, name, list_price_fils, expiry_amount) ' +
          "values ($1, 'term-half-a', 'Half a term', 90000, 6)",
        [TENANT_ID],
      );
    });
  });

  it('refuses a unit with no number beside it', async () => {
    await rolledBack(owner, async () => {
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        'insert into package (tenant_id, code, name, list_price_fils, expiry_unit) ' +
          "values ($1, 'term-half-b', 'Half a term', 90000, 'month')",
        [TENANT_ID],
      );
    });
  });

  it('refuses a term of no length, and one of negative length', async () => {
    await rolledBack(owner, async () => {
      for (const amount of [0, -1]) {
        await rejectsWith(
          owner,
          CHECK_VIOLATION,
          'insert into package (tenant_id, code, name, list_price_fils, expiry_amount, expiry_unit) ' +
            "values ($1, 'term-nothing', 'A term of nothing', 90000, $2, 'month')",
          [TENANT_ID, amount],
        );
      }
    });
  });

  it('refuses a unit nobody counts in', async () => {
    await rolledBack(owner, async () => {
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        'insert into package (tenant_id, code, name, list_price_fils, expiry_amount, expiry_unit) ' +
          "values ($1, 'term-weeks', 'A term in weeks', 90000, 6, 'week')",
        [TENANT_ID],
      );
    });
  });
});

describe('the same term on a price', () => {
  const PRICE =
    'insert into price (tenant_id, service_type_id, list_price_fils, unit_price_fils, ' +
    'vat_rate_basis_points, vat_setting_version, valid_from, amendment_reason';

  it('is accepted absent, which is what a single session sold ahead now means', async () => {
    await rolledBack(owner, async () => {
      const { rows } = await owner.query<{
        expiry_amount: number | null;
        expiry_unit: string | null;
      }>(
        `${PRICE}) values ($1, $2, 90000, 90000, 500, 1, $3, 'Setting the launch price.') ` +
          'returning expiry_amount, expiry_unit',
        [TENANT_ID, SERVICE_TYPE_ID, TODAY],
      );
      expect(rows[0]).toEqual({ expiry_amount: null, expiry_unit: null });
    });
  });

  it('is accepted whole, in either unit', async () => {
    await rolledBack(owner, async () => {
      const { rows } = await owner.query<{ expiry_amount: number; expiry_unit: string }>(
        `${PRICE}, expiry_amount, expiry_unit) ` +
          "values ($1, $2, 90000, 90000, 500, 1, $3, 'A term in days.', 14, 'day'), " +
          "($1, $2, 90000, 90000, 500, 1, $4, 'A term in months.', 3, 'month') " +
          'returning expiry_amount, expiry_unit',
        [TENANT_ID, SERVICE_TYPE_ID, TODAY, '2026-09-13'],
      );
      expect(rows).toEqual([
        { expiry_amount: 14, expiry_unit: 'day' },
        { expiry_amount: 3, expiry_unit: 'month' },
      ]);
    });
  });

  it('refuses a number with no unit, and a unit with no number', async () => {
    await rolledBack(owner, async () => {
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        `${PRICE}, expiry_amount) values ($1, $2, 90000, 90000, 500, 1, $3, 'Half a term.', 6)`,
        [TENANT_ID, SERVICE_TYPE_ID, TODAY],
      );
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        `${PRICE}, expiry_unit) values ($1, $2, 90000, 90000, 500, 1, $3, 'Half a term.', 'month')`,
        [TENANT_ID, SERVICE_TYPE_ID, TODAY],
      );
    });
  });

  it('refuses a term of no length, a negative one, and a unit nobody counts in', async () => {
    await rolledBack(owner, async () => {
      for (const [amount, unit] of [
        [0, 'month'],
        [-1, 'month'],
        [6, 'week'],
      ] as const) {
        await rejectsWith(
          owner,
          CHECK_VIOLATION,
          `${PRICE}, expiry_amount, expiry_unit) ` +
            "values ($1, $2, 90000, 90000, 500, 1, $3, 'A term that is not one.', $4, $5)",
          [TENANT_ID, SERVICE_TYPE_ID, TODAY, amount, unit],
        );
      }
    });
  });
});

describe('the extension machinery', () => {
  it('is gone: no package_extension table', async () => {
    const { rows } = await owner.query<{ gone: boolean }>(
      "select to_regclass('public.package_extension') is null as gone",
    );
    expect(rows[0]?.gone).toBe(true);
  });

  it('is gone from the purchase too: no extended_to, no extension_reason', async () => {
    const { rows } = await owner.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' " +
        "and table_name = 'package_purchase' " +
        "and column_name in ('extended_to', 'extension_reason')",
    );
    expect(rows).toEqual([]);
  });

  it('takes its three constraints with it', async () => {
    const { rows } = await owner.query<{ conname: string }>(
      "select conname from pg_constraint where conrelid = 'public.package_purchase'::regclass " +
        "and conname like '%extension%'",
    );
    expect(rows).toEqual([]);
  });

  it('leaves a programme able to be sold with no end date at all', async () => {
    const { rows } = await owner.query<{ attnotnull: boolean }>(
      "select attnotnull from pg_attribute where attrelid = 'public.package_purchase'::regclass " +
        "and attname = 'expires_on'",
    );
    expect(rows[0]?.attnotnull).toBe(false);
  });
});

describe('the consumption rule, after the extension is taken out of it', () => {
  it('spends the dated credit first, so none is lost to expiry', async () => {
    expect(await oldestOn(TODAY)).toBe(CREDIT_DATED);
  });

  it('still treats a credit with no expiry as always valid', async () => {
    // Long after every dated credit has run out. A null expiry is not
    // "unknown": it is "does not run out", and it was already that in 403.
    expect(await oldestOn(YEARS_LATER)).toBe(CREDIT_NEVER);
  });

  it('reads no dropped column: the purchase is no longer joined at all', async () => {
    const { rows } = await owner.query<{ def: string }>(
      'select pg_get_functiondef(p.oid) as def from pg_proc p ' +
        'join pg_namespace n on n.oid = p.pronamespace ' +
        "where n.nspname = 'app' and p.proname = 'oldest_available_entitlement'",
    );
    const definition = rows[0]?.def ?? '';
    expect(definition).not.toContain('extended_to');
    expect(definition).toContain('e.expires_on nulls last');
  });
});
