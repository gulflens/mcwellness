import { randomUUID } from 'node:crypto';
import { connect, describeDatabase } from '../../db/runner/apply';
import { postPendingEvents } from '../../app/api/accounting/poster';

// pnpm job:post-books — the nightly catch-up: every money event the platform
// has recorded and the journal has not, written into the books
// (docs/SPEC/accounting.md section 4.3). Safe to run as often as you like: the
// journal's unique key on (practice, source table, source id, event) is the
// idempotency, so a second run writes nothing.
//
// The owner's connection, not the API's: the poster runs across every practice
// and answers to no request context. Each practice is one transaction, stamped
// with the same settings the request-context middleware stamps — the practice,
// the owner's roles, a fresh request id and a reason — so `app.audit_row`
// records who and why exactly as it does for a request. There is no actor id:
// nobody pressed anything.
//
// It prints counts and a practice's ordinal, and never an id, a figure, a
// household or a connection string.

const url = process.env.DATABASE_URL;
try {
  if (!url) throw new Error('DATABASE_URL is not set; there are no books to post into.');
  const client = await connect(url);
  let failures = 0;
  try {
    console.log(`Posting the books on the ${describeDatabase(url)}.`);
    const { rows } = await client.query<{ id: string }>(
      'select id from tenant order by created_at',
    );
    let ordinal = 0;
    for (const tenant of rows) {
      ordinal += 1;
      try {
        await client.query('begin');
        await client.query(
          "select set_config('app.tenant_id', $1, true), " +
            "set_config('app.actor_roles', 'owner', true), " +
            "set_config('app.actor_id', '', true), " +
            "set_config('app.request_id', $2, true), " +
            "set_config('app.reason', 'nightly posting', true)",
          [tenant.id, randomUUID()],
        );
        const report = await postPendingEvents(client);
        await client.query('commit');
        console.log(`Practice ${ordinal}: posted ${report.posted}, unknown ${report.unknown}.`);
      } catch (error) {
        await client.query('rollback');
        failures += 1;
        console.error(
          `Practice ${ordinal}: nothing posted. ${
            error instanceof Error ? error.message : 'The posting did not run.'
          }`,
        );
      }
    }
  } finally {
    await client.end();
  }
  if (failures > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The posting did not run.');
  process.exitCode = 1;
}
