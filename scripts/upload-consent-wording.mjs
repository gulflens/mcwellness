import { connect, describeDatabase } from '../db/runner/apply.ts';
import { SEED_TENANT_ID } from '../db/seed/generate.ts';
import {
  describeWordingResult,
  isWordingRefusal,
  uploadConsentWording,
  wordingTargetError,
} from '../db/seed/wording-upload.ts';
import { storageFromEnv } from '../app/api/_middleware/storage/index.ts';

// pnpm seed:wording — puts the eight files in docs/CONSENT into the document
// store the environment points at, at exactly the storage_key each wording's
// own row names (docs/STAGING.md section 5a). Run it once after the bucket
// exists; running it again uploads nothing, because a wording is written once.
//
//   node --env-file=.env.staging --import tsx scripts/upload-consent-wording.mjs
//
// The store is chosen by STORAGE_PROVIDER through the seam, so the same
// command fills a folder on a laptop and a private bucket on staging.
//
// The connection is the API's own (API_DATABASE_URL) where there is one, since
// that is the credential a hosted project has on the laptop; under that role
// the document rows are fenced by row security, so the practice and an owner's
// roles are stamped on the session the way a request stamps them. Falling back
// to DATABASE_URL costs nothing: the owner ignores both settings.
//
// Nothing here prints a credential, a connection string or a password.

const apiUrl = process.env.API_DATABASE_URL;
const url = apiUrl ?? process.env.DATABASE_URL;
const tenantId = process.env.TENANT_ID ?? SEED_TENANT_ID;

try {
  if (!url) {
    throw new Error('Neither API_DATABASE_URL nor DATABASE_URL is set; there is nothing to read.');
  }
  const storage = storageFromEnv(process.env);
  // A folder on this machine is not where a hosted project's documents go.
  const refusal = wordingTargetError(storage.kind, url);
  if (refusal !== null) {
    throw new Error(refusal);
  }
  const client = await connect(url);
  try {
    await client.query(
      "select set_config('app.tenant_id', $1, false), set_config('app.actor_roles', $2, false)",
      [tenantId, 'owner'],
    );
    if (apiUrl !== undefined) {
      // The API role inherits nothing (migration 096): every request becomes
      // app_role for its duration, and so does this. Under it the wording rows
      // are visible only with the practice and a staff role stamped above,
      // which is the point of reading them this way rather than as the owner.
      await client.query('set role app_role');
    }
    console.log(`Reading the wording rows from the ${describeDatabase(url)}.`);
    console.log(`Filing the bytes in the ${storage.describe()}.`);
    const results = await uploadConsentWording({ client, storage, tenantId });
    for (const result of results) {
      console.log(describeWordingResult(result));
    }
    const refused = results.filter((result) => isWordingRefusal(result.outcome));
    const uploaded = results.filter((result) => result.outcome === 'uploaded').length;
    const present = results.filter((result) => result.outcome === 'already present').length;
    console.log(
      `${results.length} wording files: ${uploaded} uploaded, ${present} already present, ` +
        `${refused.length} refused.`,
    );
    if (refused.length > 0) {
      // A row and its file disagreeing is not something to upload past: the
      // row is what a recorded consent points at.
      console.error(
        'Nothing was uploaded for the refused files. A wording is never re-cut at the same key: ' +
          'a changed text is a new version and a new row (docs/CONSENT/README.md).',
      );
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
