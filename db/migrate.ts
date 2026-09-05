import { execFileSync } from 'node:child_process';
import {
  applyPolicies,
  connect,
  describeApplied,
  describeDatabase,
  requireDatabaseUrl,
  runMigrations,
  syncLocalApiRolePassword,
} from './runner/apply';
import { migrationRefusal } from './runner/plan';

// pnpm db:migrate — applies the migrations in db/migrations that this database
// has not seen yet, then re-applies every policy file under db/policies.
// Forward-only; see docs/SPEC/OWNERSHIP.md for the ranges.
//
// The guard's rule is in ./runner/plan.ts and its sentence is here, because
// naming the database means reading it out of the URL and the URL carries the
// password: describeDatabase prints the host, the port and the database name and
// never the string itself (docs/SPEC/hosting.md section 5).

/**
 * Every tag the checked-out revision carries; none if this is not a git
 * checkout, or git is not installed, or the revision is untagged. Read here
 * rather than taken from a second environment variable, so that the tag the
 * release names has to be genuinely on the revision being migrated rather than
 * merely asserted beside it.
 */
function tagsOnHead(): string[] {
  try {
    return execFileSync('git', ['tag', '--points-at', 'HEAD'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch {
    return [];
  }
}

try {
  const url = requireDatabaseUrl();
  const refusal = migrationRefusal({
    url,
    target: process.env.MIGRATE_TARGET,
    releaseTag: process.env.RELEASE_TAG,
    checkoutTags: tagsOnHead(),
  });
  if (refusal) {
    throw new Error(`db:migrate declined the ${describeDatabase(url)}: ${refusal}`);
  }

  const client = await connect(url);
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
