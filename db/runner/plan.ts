/**
 * The pure half of the migration runner: which files exist, in what order,
 * and which of them still need applying. No I/O here, so it is tested without
 * a database.
 *
 * Conventions (docs/SPEC/OWNERSHIP.md and .claude/rules/data-model.md):
 * - files are named NNN_description.sql and live in db/migrations;
 * - each worktree uses its own numeric range and never renumbers;
 * - migrations are forward-only, and every file carries a "-- rollback:"
 *   comment block describing the manual reversal.
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
