import { connect, describeDatabase } from '../../db/runner/apply';
import { storageFromEnv } from '../../app/api/_middleware/storage';
import { describeSweep, sweepErasureFiles } from '../../app/api/clients/erasure-file-sweep';

// pnpm job:erasure-files — removes the document bytes an erasure could not
// remove at the time (docs/SPEC/client-record.md section 8 step 2,
// docs/CHANGE-REQUESTS/client-record-04.md CR-14). Safe to run as often as
// you like: it asks the store what is still there rather than trusting a
// flag, and an erasure with nothing pending is skipped.
//
// When an erasure runs, the request removes each document's bytes through
// `c.get('afterCommit')` — the only correct place, because a delete cannot be
// rolled back and a transaction can (docs/SEAMS.md). That hook has no database
// by the time it runs, so it cannot record what it managed; it does not need
// to, because what it could not remove is still in the store and still on
// `erasure_request.storage_keys_pending` (migration 104). This is what comes
// back for those. The rule itself is `sweepErasureFiles`, which is tested end
// to end against a real store in `tests/client/db/erasure_act.test.ts`; the
// twenty lines here are the connection and the sentence an operator reads.
//
// The owner's connection, not the API's: the sweep writes to erasure_request
// across every practice and answers to no request context.
//
// Nothing here prints a key, a person or a connection string.

const url = process.env.DATABASE_URL;
try {
  if (!url) throw new Error('DATABASE_URL is not set; there is nothing to sweep.');
  const storage = storageFromEnv(process.env);
  const client = await connect(url);
  try {
    console.log(`Sweeping the ${describeDatabase(url)} against the ${storage.describe()}.`);
    console.log(describeSweep(await sweepErasureFiles(client, storage)));
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The sweep did not run.');
  process.exitCode = 1;
}
