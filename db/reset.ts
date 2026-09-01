import { connect, describeDatabase, requireDatabaseUrl, runMigrations } from './runner/apply';
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
    await client.query(
      'drop schema if exists public cascade; ' +
        'create schema public; ' +
        'grant usage on schema public to public; ' +
        "comment on schema public is 'standard public schema';",
    );
    console.log(`reset the ${describeDatabase(url)}`);
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
