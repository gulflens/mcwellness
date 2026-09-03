import { createHash } from 'node:crypto';
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
        // A wording is written once and never replaced (docs/SEAMS.md): the
        // bytes behind a filed consent are the evidence of what a person was
        // shown. `pnpm seed --fresh` rebuilds the database but not the folder,
        // so a key that is already there is the same run's own work — proved
        // by its fingerprint, not assumed — and is left exactly as it is.
        // Anything else stops the seed rather than being written over.
        const existing = await storage.read(document.storageKey);
        if (existing !== null) {
          const found = createHash('sha256').update(existing).digest('hex');
          if (found !== document.sha256Hex) {
            throw new Error(
              `${document.file} is already filed with different bytes; nothing was seeded. ` +
                'Clear the store (STORAGE_DIR) and seed again.',
            );
          }
          continue;
        }
        const stored = await storage.put(document.storageKey, document.bytes, document.mimeType, {
          overwrite: false,
        });
        if (stored.sha256 !== document.sha256Hex) {
          throw new Error(`${document.file} changed while it was being filed; nothing was seeded.`);
        }
      }
      console.log(
        `Filed ${data.documents.length} consent wording files in the ${storage.describe()}.`,
      );
      if (!local) {
        // The rows are about to name storage keys in a bucket this command
        // never touched, and a row pointing at nothing is only visible when
        // someone opens a consent. The rendered-SQL route carries this
        // warning in its own header; seeding a hosted project directly must
        // carry it too, or the two routes differ in the one way that matters.
        console.warn(
          "This database is not local, but the bytes went into this machine's folder. " +
            `Upload each file in docs/CONSENT to the "documents" bucket at exactly the ` +
            'storage_key its row names, or every consent points at nothing ' +
            '(docs/STAGING.md section 5a).',
        );
      }
      console.log(describeSeed(await applySeed(client, data, keys)));
    }
  } finally {
    await client.end();
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
