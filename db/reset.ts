import {
  applyPolicies,
  connect,
  describeApplied,
  describeDatabase,
  requireDatabaseUrl,
  resetDatabase,
  runMigrations,
} from './runner/apply';
import { isLocalDatabaseUrl } from './runner/plan';

// pnpm db:reset — wipes the LOCAL database and rebuilds it from the migrations.
// It refuses to run against anything that is not on this computer.

try {
  const url = requireDatabaseUrl();
  if (!isLocalDatabaseUrl(url)) {
    throw new Error(
      `db:reset only runs against a local database, not the ${describeDatabase(url)}.`,
    );
  }
  const appEnv = process.env.APP_ENV ?? 'development';
  if (appEnv !== 'development') {
    throw new Error(`db:reset only runs with APP_ENV=development, not "${appEnv}".`);
  }

  const client = await connect(url);
  try {
    await resetDatabase(client);
    console.log(`reset the ${describeDatabase(url)}`);
    const migrations = await runMigrations(client);
    const policies = await applyPolicies(client);
    console.log(describeApplied(migrations, policies));
  } finally {
    await client.end();
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
