import { connect, requireDatabaseUrl, runMigrations } from './runner/apply';

// pnpm db:migrate — applies the migrations in db/migrations that this database
// has not seen yet. Forward-only; see docs/SPEC/OWNERSHIP.md for the ranges.

try {
  const client = await connect(requireDatabaseUrl());
  try {
    const count = await runMigrations(client);
    console.log(
      count === 0 ? 'nothing to apply' : `applied ${count} migration${count === 1 ? '' : 's'}`,
    );
  } finally {
    await client.end();
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
