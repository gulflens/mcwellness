import { connect, describeDatabase } from '../../db/runner/apply';
import { isoDateIn } from '../../domain/shared';
import { retentionDue, type RetainedDocument } from '../../domain/client/retentionDue';

// pnpm job:retention-due — says what has passed its five years and is waiting
// to be erased (docs/SPEC/client-record.md rule 7, CLAUDE.md absolute rule 8).
//
// **It reads. It never deletes.** The practice's wording tells a household
// their session records are kept for five years after their last session or
// contact and then deleted; `retention_until` was computed and stored when
// each document was filed, and then nothing ever read it back, so the promise
// had no way of being kept and no way of being seen to have been missed. This
// closes the seeing half. The erasing half stays a person's act, through the
// audited route the client record already offers, because the compliance rule
// is erasure on request and a job that quietly deleted households would be a
// worse answer than the gap it closes.
//
// Run it as often as you like: it asks the database what is past its date and
// answers, and changes nothing whatever it finds.
//
// The owner's connection, not the API's: this reads across every practice and
// answers to no request context.
//
// Nothing here prints a name, a household or a connection string — only counts,
// dates and opaque ids, which is what somebody acting on it needs.

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

type Row = {
  client_id: string;
  document_id: string;
  kind: string;
  retention_until: string | null;
};

const url = process.env.DATABASE_URL;
try {
  if (!url) throw new Error('DATABASE_URL is not set; there is nothing to read.');
  const client = await connect(url);
  try {
    // Today in the practice's own zone, not the server's: a retention date is
    // a calendar date the practice keeps, and midnight in Dubai is the edge
    // that matters (domain/client/computeRetentionUntil.ts).
    const today = isoDateIn(new Date(), PRACTICE_TIME_ZONE);
    console.log(`Reading the ${describeDatabase(url)} as at ${today} in Dubai.`);

    const { rows } = await client.query<Row>(
      "select c.id as client_id, d.id as document_id, d.kind, to_char(d.retention_until, 'YYYY-MM-DD') as retention_until " +
        'from document d join client c on c.id = d.client_id ' +
        "where d.client_id is not null and c.status <> 'erased' and d.retention_until is not null",
    );

    const held: RetainedDocument[] = rows.map((row) => ({
      clientId: row.client_id,
      documentId: row.document_id,
      kind: row.kind,
      retentionUntil: row.retention_until,
    }));
    const due = retentionDue(held, today);

    if (due.length === 0) {
      console.log(`Nothing is past its retention date. ${held.length} documents are on the clock.`);
    } else {
      const households = new Set(due.map((row) => row.clientId));
      console.log(
        `${due.length} document(s) across ${households.size} household(s) are past their ` +
          `retention date, of ${held.length} on the clock.`,
      );
      for (const clientId of households) {
        const mine = due.filter((row) => row.clientId === clientId);
        const oldest = mine[0]?.retentionUntil ?? '';
        console.log(`  client ${clientId}  ${mine.length} document(s), oldest due ${oldest}`);
      }
      console.log(
        '\nErase a household from its own record screen, which writes the trail and the ' +
          "confirmation letter. This job never deletes anything: what it found is the practice's " +
          'to act on, one household at a time.',
      );
    }
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
