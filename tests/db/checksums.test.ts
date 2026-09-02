import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../db/runner/apply';
import { checksumOf } from '../../db/runner/plan';
import { freshDatabase } from './helpers';

/**
 * Proves the round 5 runner hardening (db/migrations/900_migration_checksums.sql,
 * .claude/rules/data-model.md's "never edit a merged migration"): every
 * applied file gets a recorded checksum, a second migrate with nothing new
 * to apply leaves every checksum untouched, a file whose recorded checksum
 * no longer matches its current text refuses the whole run, and a null
 * recorded checksum — a file applied before this column existed — is
 * backfilled rather than refused.
 */

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
});

afterAll(async () => {
  await client.end();
});

async function checksumsByFilename(): Promise<Map<string, string | null>> {
  const { rows } = await client.query<{ filename: string; checksum: string | null }>(
    'select filename, checksum from schema_migration',
  );
  return new Map(rows.map((row) => [row.filename, row.checksum]));
}

describe('migration checksums', () => {
  it('records a 64-character checksum for every file freshDatabase() applied', async () => {
    const checksums = await checksumsByFilename();
    expect(checksums.size).toBeGreaterThan(0);
    for (const [filename, checksum] of checksums) {
      expect(checksum, filename).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('sets the checksum column NOT NULL once every row has one, so a later null cannot disarm the check', async () => {
    const { rows } = await client.query<{ is_nullable: string }>(
      'select is_nullable from information_schema.columns ' +
        "where table_name = 'schema_migration' and column_name = 'checksum'",
    );
    expect(rows[0]?.is_nullable).toBe('NO');
  });

  it('leaves every checksum exactly as it was on a second migrate with nothing pending', async () => {
    const before = await checksumsByFilename();
    expect(await runMigrations(client)).toBe(0);
    const after = await checksumsByFilename();
    expect(after).toEqual(before);
  });

  it("refuses the whole run when an already-applied file's recorded checksum no longer matches", async () => {
    const genuine = (await checksumsByFilename()).get('010_tenant.sql');
    await client.query(
      "update schema_migration set checksum = $1 where filename = '010_tenant.sql'",
      [checksumOf('this is not the real text of 010_tenant.sql')],
    );
    await expect(runMigrations(client)).rejects.toThrow(/010_tenant\.sql/);
    // Restore the genuine, real checksum so later tests, and any run after
    // this one, see a consistent database rather than a permanently tampered row.
    await client.query(
      "update schema_migration set checksum = $1 where filename = '010_tenant.sql'",
      [genuine],
    );
    expect(await runMigrations(client)).toBe(0);
  });

  it('backfills a null recorded checksum from the current file text, instead of refusing', async () => {
    // A genuinely legacy database only ever has a null checksum before its
    // first run past this migration, when the column is still nullable (the
    // NOT NULL constraint the runner now sets is itself a product of every
    // row already having one). Dropping it here reproduces that legacy
    // state well enough to set a row back to null at all.
    await client.query('alter table schema_migration alter column checksum drop not null');
    await client.query(
      "update schema_migration set checksum = null where filename in ('010_tenant.sql', '040_service_type.sql')",
    );
    const beforeRun = await checksumsByFilename();
    expect(beforeRun.get('010_tenant.sql')).toBeNull();
    expect(beforeRun.get('040_service_type.sql')).toBeNull();

    await expect(runMigrations(client)).resolves.toBe(0);

    const afterRun = await checksumsByFilename();
    expect(afterRun.get('010_tenant.sql')).toMatch(/^[0-9a-f]{64}$/);
    expect(afterRun.get('040_service_type.sql')).toMatch(/^[0-9a-f]{64}$/);
    // The backfill also reinstates NOT NULL, now that every row has one
    // again: a later null cannot disarm the check from here.
    const { rows } = await client.query<{ is_nullable: string }>(
      'select is_nullable from information_schema.columns ' +
        "where table_name = 'schema_migration' and column_name = 'checksum'",
    );
    expect(rows[0]?.is_nullable).toBe('NO');
    // A further migrate is clean again: the backfilled checksums match the
    // files' real, unedited text, so nothing refuses and nothing changes.
    expect(await runMigrations(client)).toBe(0);
    expect(await checksumsByFilename()).toEqual(afterRun);
  });
});
