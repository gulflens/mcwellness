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
 * has already recorded. Refuses two situations that mean history was edited:
 * an applied file that no longer exists, and a new file numbered below one
 * that has already been applied.
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
  let highestApplied = -1;
  for (const file of available) {
    if (appliedSet.has(file.filename)) {
      highestApplied = Math.max(highestApplied, file.number);
    }
  }

  const pending = available.filter((file) => !appliedSet.has(file.filename));
  for (const file of pending) {
    if (file.number < highestApplied) {
      throw new Error(
        `"${file.filename}" is numbered below the highest applied migration (${highestApplied}). ` +
          'Migrations are forward-only; give it a higher number.',
      );
    }
  }

  return pending;
}
