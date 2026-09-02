import { createHash } from 'node:crypto';

/**
 * The pure half of the migration runner: which files exist, in what order,
 * and which of them still need applying. No I/O here, so it is tested without
 * a database. `createHash` is used only for its own deterministic arithmetic
 * (a text in, a hex digest out), never to read anything, so it stays here
 * alongside the rest.
 *
 * Conventions (docs/SPEC/OWNERSHIP.md and .claude/rules/data-model.md):
 * - files are named NNN_description.sql and live in db/migrations;
 * - each worktree uses its own numeric range and never renumbers;
 * - migrations are forward-only, and every file carries a "-- rollback:"
 *   comment block describing the manual reversal;
 * - a migration may name earlier numbers it depends on in a "-- Needs:"
 *   comment (db/migrations/099_tenant_scoped_keys.sql, 400_billing_catalogue.sql);
 * - a merged migration is never edited (.claude/rules/data-model.md) —
 *   db/migrations/900_migration_checksums.sql and the checksum functions
 *   below are that rule enforced by the runner, not merely stated in prose.
 */

export type MigrationFile = { filename: string; number: number };

const MIGRATION_FILENAME = /^(\d{3})_.+\.sql$/;

/** Lists the migration files in numeric order, refusing anything malformed. */
export function listMigrationFiles(names: readonly string[]): MigrationFile[] {
  const files: MigrationFile[] = [];
  const seen = new Map<number, string>();

  for (const name of names) {
    if (name.startsWith('.')) {
      continue;
    }
    const match = MIGRATION_FILENAME.exec(name);
    const digits = match?.[1];
    if (!digits) {
      throw new Error(`"${name}" is not a migration file name. Use NNN_description.sql.`);
    }
    const number = Number(digits);
    const duplicate = seen.get(number);
    if (duplicate !== undefined) {
      throw new Error(
        `"${duplicate}" and "${name}" share the number ${digits}. ` +
          'Never renumber; pick the next free number in your range.',
      );
    }
    seen.set(number, name);
    files.push({ filename: name, number });
  }

  return files.sort((a, b) => a.number - b.number);
}

/** True when the SQL carries a "-- rollback:" marker (case-insensitive). */
export function hasRollbackBlock(sql: string): boolean {
  return /^--\s*rollback:/im.test(sql);
}

/** The sha256 of a migration file's own text, as lowercase hex (schema_migration.checksum). */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * The migration numbers a file's own "-- Needs:" comment names, when it
 * carries one (db/migrations/099_tenant_scoped_keys.sql and
 * 400_billing_catalogue.sql are the existing examples). The comment may wrap
 * onto further "--" lines immediately below the first, as both of those do;
 * reading stops at the first line that is not itself a "--" comment. Absent
 * entirely, this is `[]` — nothing to check, not a refusal in itself.
 */
export function parseNeeds(sql: string): number[] {
  const lines = sql.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /^--\s*Needs:/i.test(line));
  if (startIndex === -1) {
    return [];
  }
  const block: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.startsWith('--')) {
      break;
    }
    block.push(line);
  }
  const numbers = block.join(' ').match(/\b\d{3}\b/g) ?? [];
  return [...new Set(numbers.map(Number))].sort((a, b) => a - b);
}

/**
 * Refuses a migration whose own "-- Needs:" comment names a number that is
 * not earlier than its own (docs/SPEC/OWNERSHIP.md: "a migration's only
 * real dependency is what it declares in its own 'Needs' comment"). A
 * migration may depend only on earlier numbers, in its own range or the
 * core range — never on itself, and never on a number that might name a
 * file not yet written, since a later number is no proof a later stream's
 * migration has even landed on this database (see planMigrations above).
 */
export function checkNeeds(file: MigrationFile, sql: string): void {
  for (const need of parseNeeds(sql)) {
    if (need >= file.number) {
      const needed = String(need).padStart(3, '0');
      const own = String(file.number).padStart(3, '0');
      throw new Error(
        `${file.filename} names ${needed} in its "-- Needs:" comment, which is not earlier ` +
          `than its own number (${own}). A migration may depend only on earlier numbers.`,
      );
    }
  }
}

export type RecordedMigration = { filename: string; checksum: string | null };
export type ChecksumPlan = {
  /** Already-applied files whose current text no longer matches what was recorded when applied. */
  mismatched: readonly string[];
  /** Already-applied files recorded before the checksum column existed, to backfill now. */
  toBackfill: readonly { filename: string; checksum: string }[];
};

/**
 * Decides, for every already-applied migration, whether its current text
 * still matches what was recorded when it was applied
 * (db/migrations/900_migration_checksums.sql; .claude/rules/data-model.md's
 * "never edit a merged migration", enforced here rather than merely stated).
 * A null recorded checksum predates the column and is backfilled from the
 * file's current text, not refused — round 5 introduces the column onto
 * databases with migrations already applied under the old, checksum-less
 * runner. A non-null checksum that no longer matches means the file's text
 * changed after it was applied.
 */
export function planChecksums(
  recorded: readonly RecordedMigration[],
  currentTextOf: (filename: string) => string,
): ChecksumPlan {
  const mismatched: string[] = [];
  const toBackfill: { filename: string; checksum: string }[] = [];
  for (const row of recorded) {
    const checksum = checksumOf(currentTextOf(row.filename));
    if (row.checksum === null) {
      toBackfill.push({ filename: row.filename, checksum });
    } else if (row.checksum !== checksum) {
      mismatched.push(row.filename);
    }
  }
  return { mismatched, toBackfill };
}

/**
 * Decides which files to apply, given what is on disk and what the database
 * has already recorded. Refuses one situation that means history was edited:
 * an applied file that no longer exists (duplicate numbers are already
 * refused by listMigrationFiles before a caller gets here).
 *
 * A pending file numbered below the highest applied one is admitted, not
 * refused: with eight streams each owning its own range (docs/SPEC/OWNERSHIP.md),
 * which migrations a given database has already applied depends on which
 * streams have reached it and in what order, never on every range being
 * present. A database that has already run a stream's 400 has not thereby
 * seen the trunk's 099 - refusing 099 there would make the trunk's own range
 * unappliable behind a stream that got there first, and by the same logic
 * any migration ever numbered 9xx would cap every stream forever. A
 * migration's only real dependency is what it declares in its own "Needs"
 * comment; the file's number says nothing about apply order across ranges,
 * only within one. Pending files are returned in filename order, which is
 * numeric order: `available` is already sorted that way by listMigrationFiles,
 * and every filename carries a fixed three-digit prefix, so the two orders
 * never disagree.
 */
export function planMigrations(
  available: readonly MigrationFile[],
  applied: readonly string[],
): MigrationFile[] {
  const onDisk = new Set(available.map((file) => file.filename));
  for (const name of applied) {
    if (!onDisk.has(name)) {
      throw new Error(
        `"${name}" was applied to this database but is missing from db/migrations. ` +
          'Merged migrations are never renamed or deleted.',
      );
    }
  }

  const appliedSet = new Set(applied);
  return available.filter((file) => !appliedSet.has(file.filename));
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Whether a host name, as a URL or a connected pg.Client reports it, is this machine. */
export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host);
}

/**
 * True only for a connection string that can reach nothing but this machine.
 * The query string is checked as well as the host, because the Postgres
 * driver lets `?host=` (and `?hostaddr=`) override the host in the URL.
 */
export function isLocalDatabaseUrl(url: string): boolean {
  const parsed = new URL(url);
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    return false;
  }
  for (const key of parsed.searchParams.keys()) {
    const lowered = key.toLowerCase();
    if (lowered === 'host' || lowered === 'hostaddr') {
      return false;
    }
  }
  return true;
}

/**
 * Lists policy files: every .sql path under db/policies, in path order, so a
 * worktree's policies apply after core's and the order is the same on every
 * machine. Dotfiles and anything that is not .sql are ignored.
 */
export function listPolicyFiles(paths: readonly string[]): string[] {
  return paths
    .filter((path) => path.endsWith('.sql'))
    .filter((path) => !path.split('/').some((segment) => segment.startsWith('.')))
    .sort();
}
