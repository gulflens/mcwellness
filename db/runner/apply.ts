import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { hasRollbackBlock, listMigrationFiles, listPolicyFiles, planMigrations } from './plan';

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
 */
export async function runMigrations(client: pg.Client): Promise<number> {
  await client.query(`select pg_advisory_lock(${LOCK_KEY})`);
  try {
    await client.query(
      'create table if not exists schema_migration (' +
        'filename text primary key, ' +
        'applied_at timestamptz not null default now())',
    );
    // No policies on purpose: the bookkeeping table is invisible to API roles.
    await client.query('alter table schema_migration enable row level security');

    const available = listMigrationFiles(await readdir(MIGRATIONS_DIR));
    const { rows } = await client.query<{ filename: string }>(
      'select filename from schema_migration',
    );
    const pending = planMigrations(
      available,
      rows.map((row) => row.filename),
    );

    for (const file of pending) {
      const sql = await readFile(new URL(file.filename, MIGRATIONS_DIR), 'utf8');
      if (!hasRollbackBlock(sql)) {
        throw new Error(
          `${file.filename} has no "-- rollback:" block. Add one before applying it.`,
        );
      }
      await client.query('begin');
      try {
        await setAuditContext(client, `migration ${file.filename}`);
        await client.query(sql);
        await client.query('insert into schema_migration (filename) values ($1)', [file.filename]);
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
