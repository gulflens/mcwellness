import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import {
  assertKnownMigrationFile,
  checkNeeds,
  checksumOf,
  hasRollbackBlock,
  isLocalDatabaseUrl,
  listMigrationFiles,
  listPolicyFiles,
  planChecksums,
  planMigrations,
  type RecordedMigration,
} from './plan';

/** The I/O half of the migration runner. The rules live in ./plan.ts. */

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);
const POLICIES_DIR = new URL('../policies/', import.meta.url);
const LOCK_KEY = "hashtext('mcwellness:migrate')";

/** Reads DATABASE_URL, with a plain-language message when it is missing. */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env for local development.');
  }
  return url;
}

/** Describes a database without ever printing the URL, which carries the password. */
export function describeDatabase(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '') || '(unnamed)';
  return `database "${name}" at ${parsed.hostname}:${parsed.port || '5432'}`;
}

/** Connects, turning a refused connection into advice rather than a stack trace. */
export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
      throw new Error(`Cannot reach the ${describeDatabase(url)}. Is it running? Try: pnpm db:up`, {
        cause: error,
      });
    }
    throw error;
  }
  return client;
}

/**
 * Stamps the audit context for work the runner does itself, transaction-local
 * (docs/SPEC/audit.md section 5). The actor stays unset, so anything a data
 * migration writes to an audited table is logged as a system action, with the
 * file named as the reason.
 */
async function setAuditContext(client: pg.Client, reason: string): Promise<void> {
  await client.query(
    "select set_config('app.reason', $1, true), set_config('app.request_id', $2, true)",
    [reason, randomUUID()],
  );
}

/**
 * Applies every pending migration, each inside its own transaction, and
 * records it in schema_migration. Returns how many were applied.
 *
 * Every run also re-verifies every already-applied file's checksum
 * (db/migrations/900_migration_checksums.sql, .claude/rules/data-model.md's
 * "never edit a merged migration" enforced rather than merely stated): a
 * file whose recorded checksum no longer matches its current text refuses
 * the whole run before anything pending is touched. A null recorded
 * checksum — a file applied before this column existed — is backfilled from
 * its current text instead, once, on whichever run first has the column.
 */
export async function runMigrations(client: pg.Client): Promise<number> {
  await client.query(`select pg_advisory_lock(${LOCK_KEY})`);
  try {
    await client.query(
      'create table if not exists schema_migration (' +
        'filename text primary key, ' +
        'checksum text, ' +
        'applied_at timestamptz not null default now())',
    );
    // Belt and braces for a database whose schema_migration predates the
    // checksum column: `create table if not exists` above does nothing to an
    // existing table missing it. db/migrations/900_migration_checksums.sql
    // carries the same alteration as a tracked migration, for the historical
    // record; this line is what actually makes the column present before the
    // select just below ever runs, on every database, in every order.
    await client.query('alter table schema_migration add column if not exists checksum text');
    // No policies on purpose: the bookkeeping table is invisible to API roles.
    await client.query('alter table schema_migration enable row level security');

    const available = listMigrationFiles(await readdir(MIGRATIONS_DIR));
    const { rows } = await client.query<{ filename: string; checksum: string | null }>(
      'select filename, checksum from schema_migration',
    );
    const pending = planMigrations(
      available,
      rows.map((row) => row.filename),
    );

    // Every already-applied file's current text, read once and cached: the
    // checksum verification below needs it for every row, and the apply
    // loop further down needs pending files' text again anyway. textOf never
    // resolves a filename that is not exactly one of the files `available`
    // just listed from disk — a schema_migration row's filename is data the
    // database holds, not a trusted filesystem path (round 5 security
    // review) — so a tampered or stale row can never make this read outside
    // db/migrations.
    const textCache = new Map<string, string>();
    async function textOf(filename: string): Promise<string> {
      assertKnownMigrationFile(filename, available);
      const cached = textCache.get(filename);
      if (cached !== undefined) {
        return cached;
      }
      const text = await readFile(new URL(filename, MIGRATIONS_DIR), 'utf8');
      textCache.set(filename, text);
      return text;
    }
    const recorded: RecordedMigration[] = rows.map((row) => ({
      filename: row.filename,
      checksum: row.checksum,
    }));
    for (const row of recorded) {
      await textOf(row.filename);
    }
    // Every recorded filename was just read into textCache above, with
    // nothing skipped and nothing swallowed: a missing entry here would mean
    // that loop did not actually run for this row, which is a bug in the
    // runner rather than something a fallback value should paper over by
    // quietly hashing an empty string into a checksum that matches nothing
    // real.
    function requireCachedText(filename: string): string {
      const cached = textCache.get(filename);
      if (cached === undefined) {
        throw new Error(
          `Internal error: no cached text for "${filename}" when computing its checksum. ` +
            'Every recorded filename should have been read into the cache just above.',
        );
      }
      return cached;
    }
    const checksumPlan = planChecksums(recorded, requireCachedText);
    if (checksumPlan.mismatched.length > 0) {
      throw new Error(
        `${checksumPlan.mismatched.join(', ')} no longer matches the checksum recorded when ` +
          'it was applied. A merged migration is never edited (.claude/rules/data-model.md); ' +
          'a deliberate change needs a new migration instead.',
      );
    }
    for (const { filename, checksum } of checksumPlan.toBackfill) {
      await client.query('update schema_migration set checksum = $1 where filename = $2', [
        checksum,
        filename,
      ]);
      console.log(`backfilled checksum for ${filename}`);
    }

    for (const file of pending) {
      const sql = await textOf(file.filename);
      if (!hasRollbackBlock(sql)) {
        throw new Error(
          `${file.filename} has no "-- rollback:" block. Add one before applying it.`,
        );
      }
      checkNeeds(file, sql);
      await client.query('begin');
      try {
        await setAuditContext(client, `migration ${file.filename}`);
        await client.query(sql);
        await client.query('insert into schema_migration (filename, checksum) values ($1, $2)', [
          file.filename,
          checksumOf(sql),
        ]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(
          `${file.filename} failed and was rolled back: ${(error as Error).message}`,
          {
            cause: error,
          },
        );
      }
      console.log(`applied ${file.filename}`);
    }

    // Every row now carries a non-null checksum: an already-applied file
    // either matched above or was just backfilled, and every file the loop
    // above just applied was inserted with one. Once that holds, NOT NULL is
    // safe to set — and on every later run, where it already holds, this is
    // a no-op (round 5 security review): without it, a single row's
    // checksum could revert to null by some other route and quietly disarm
    // the guard for that one file, rather than the column itself refusing
    // the possibility outright.
    //
    // This is intended to break a pre-round-5 runner pointed at a database
    // that has already reached this point: its own insert into
    // schema_migration never supplied a checksum, so once the column is
    // NOT NULL that insert fails outright rather than silently applying a
    // migration with no checksum recorded for it — an old runner cannot
    // quietly widen the gap the checksum guard exists to close.
    await client.query('alter table schema_migration alter column checksum set not null');

    return pending.length;
  } finally {
    await client.query(`select pg_advisory_unlock(${LOCK_KEY})`);
  }
}

/**
 * Re-applies every policy file under db/policies, in path order, inside one
 * transaction. Policy files are declarative and idempotent (drop if exists,
 * then create), so this runs on every migrate and a policy change never needs
 * a migration. Returns how many files were applied.
 */
export async function applyPolicies(client: pg.Client): Promise<number> {
  const files = listPolicyFiles(await readdir(POLICIES_DIR, { recursive: true }));
  if (files.length === 0) {
    return 0;
  }
  await client.query('begin');
  try {
    await setAuditContext(client, 'policies');
    for (const file of files) {
      const sql = await readFile(new URL(file, POLICIES_DIR), 'utf8');
      try {
        await client.query(sql);
      } catch (error) {
        throw new Error(`policy file ${file} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  return files.length;
}

/**
 * Drops and recreates the public and app schemas. Callers must have checked
 * that the database is local first (db/reset.ts does; tests use the same guard).
 */
export async function resetDatabase(client: pg.Client): Promise<void> {
  await client.query(
    'drop schema if exists public cascade; ' +
      'drop schema if exists app cascade; ' +
      'create schema public; ' +
      'grant usage on schema public to public; ' +
      "comment on schema public is 'standard public schema';",
  );
}

/** Formats the migrate summary line. */
export function describeApplied(migrations: number, policies: number): string {
  const first =
    migrations === 0 ? 'nothing to apply' : `applied ${migrations} migration${plural(migrations)}`;
  const second = policies === 0 ? '' : `, ${policies} policy file${plural(policies)} applied`;
  return first + second;
}

function plural(count: number): string {
  return count === 1 ? '' : 's';
}

/**
 * Sets the API role's password from API_DATABASE_URL, local databases only.
 * The URL is the single source of truth, so the role and the connection string
 * cannot drift. On any other host it does nothing: on Supabase the owner sets
 * the password once in the SQL editor. Returns true when a password was set.
 */
export async function syncLocalApiRolePassword(
  client: pg.Client,
  apiUrl: string | undefined,
): Promise<boolean> {
  if (!apiUrl || !isLocalDatabaseUrl(apiUrl)) {
    return false;
  }
  const parsed = new URL(apiUrl);
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const overridden = [...parsed.searchParams.keys()].some((key) =>
    ['user', 'password'].includes(key.toLowerCase()),
  );
  if (user !== 'mcwellness_api' || password === '' || overridden) {
    return false;
  }
  const { rows } = await client.query("select 1 from pg_roles where rolname = 'mcwellness_api'");
  if (rows.length === 0) {
    return false;
  }
  await client.query(`alter role mcwellness_api password ${client.escapeLiteral(password)}`);
  return true;
}
