import {
  applyPolicies,
  connect,
  describeApplied,
  requireDatabaseUrl,
  runMigrations,
  syncLocalApiRolePassword,
} from './runner/apply';

// pnpm db:migrate — applies the migrations in db/migrations that this database
// has not seen yet, then re-applies every policy file under db/policies.
// Forward-only; see docs/SPEC/OWNERSHIP.md for the ranges.

try {
  const client = await connect(requireDatabaseUrl());
  try {
    const migrations = await runMigrations(client);
    const policies = await applyPolicies(client);
    console.log(describeApplied(migrations, policies));
    if (await syncLocalApiRolePassword(client, process.env.API_DATABASE_URL)) {
      console.log('API role password set for local development from API_DATABASE_URL');
    }
  } finally {
    await client.end();
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
