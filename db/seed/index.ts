import { identityKeysFromEnv } from '../../app/api/_middleware/identity-key';
import { localDiskStorage } from '../../app/api/_middleware/storage';
import {
  applyPolicies,
  connect,
  requireDatabaseUrl,
  resetDatabase,
  runMigrations,
  syncLocalApiRolePassword,
} from '../runner/apply';
import { isLocalDatabaseUrl } from '../runner/plan';
import { applySeed, describeSeed, isSeeded, seedTargetError } from './apply';
import { generateSeed } from './generate';

// pnpm seed — fills an empty database with the synthetic practice and says what
// it made. Running it again adds nothing. pnpm seed --fresh wipes a LOCAL
// database first and rebuilds it. Local by default; a Supabase project only
// when APP_ENV=staging says so explicitly; never production.

const fresh = process.argv.includes('--fresh');

try {
  const url = requireDatabaseUrl();
  const appEnv = process.env.APP_ENV;
  const local = isLocalDatabaseUrl(url);
  const refusal = seedTargetError(local ? 'localhost' : 'remote', appEnv);
  if (refusal !== null) {
    throw new Error(refusal);
  }
  if (fresh && (!local || appEnv !== 'development')) {
    throw new Error('--fresh wipes a database: local only, with APP_ENV=development.');
  }
  const keys = identityKeysFromEnv(process.env);
  const client = await connect(url);
  try {
    if (fresh) {
      await resetDatabase(client);
      await runMigrations(client);
      await applyPolicies(client);
      await syncLocalApiRolePassword(client, process.env.API_DATABASE_URL);
    }
    if (await isSeeded(client)) {
      console.log(
        'Already seeded: the synthetic practice is in place and nothing was added. ' +
          'Locally, pnpm seed --fresh rebuilds it.',
      );
    } else {
      const data = generateSeed();
      // The consent wording's bytes go in first, so no document row ever points
      // at a key with nothing behind it. Deliberately the local implementation
      // of the storage seam and not whatever STORAGE_PROVIDER says: seeding
      // fills a laptop, and a hosted bucket is filled by the operator's own
      // upload (docs/STAGING.md).
      const storage = localDiskStorage();
      for (const document of data.documents) {
        const stored = await storage.put(document.storageKey, document.bytes, document.mimeType);
        if (stored.sha256 !== document.sha256Hex) {
          throw new Error(`${document.file} changed while it was being filed; nothing was seeded.`);
        }
      }
      console.log(
        `Filed ${data.documents.length} consent wording files in the ${storage.describe()}.`,
      );
      console.log(describeSeed(await applySeed(client, data, keys)));
    }
  } finally {
    await client.end();
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
