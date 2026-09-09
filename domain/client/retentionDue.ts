import type { IsoDate } from '../shared/actor';

/**
 * A filed document and the date its five years run out, as the retention
 * report reads it back.
 *
 * `retentionUntil` is null for the documents deliberately on no clock — a
 * signature, a scanned consent form, the wording itself — because the evidence
 * of an agreement must outlive the record it is still acting on
 * (app/api/clients/document-store.ts explains why at length).
 */
export type RetainedDocument = {
  clientId: string;
  documentId: string;
  kind: string;
  retentionUntil: IsoDate | null;
};

/**
 * What has passed its retention date and is waiting to be erased
 * (docs/SPEC/client-record.md rule 7, CLAUDE.md absolute rule 8).
 *
 * **Why this exists at all.** The practice's own wording tells a household
 * that their session records are kept for five years after their last session
 * or contact and then deleted (`docs/CONSENT/notices/your-information.en.md`).
 * `retention_until` is computed and stored when a document is filed, but
 * nothing read it back, so the five years passed and nothing happened: a
 * promise a household signed that the practice had no way of keeping, and no
 * way of even knowing it had missed. This is the reading half. Erasing is
 * still a person's act, through the audited route the record screen already
 * offers — the compliance rule says erasure happens on request, and a job that
 * quietly deleted households would be a worse answer than the gap it closed.
 *
 * **The fifth anniversary is the last day kept, not the first day gone.** A
 * document whose retention date is today is not yet due; one whose date was
 * yesterday is. Read the stored date as "keep until", which is what the column
 * is named.
 *
 * Ordered so the report reads usefully: the household that has been waiting
 * longest first, judged on its own oldest document, and that household's rows
 * together and in date order. Pure, and the clock is an argument, because
 * "today" in Dubai is the practice's own day and not the server's.
 */
export function retentionDue(
  documents: readonly RetainedDocument[],
  today: IsoDate,
): RetainedDocument[] {
  const due = documents.filter(
    (document) => document.retentionUntil !== null && document.retentionUntil < today,
  );

  // Each household's own oldest date decides where the household sits; within
  // it, the rows run oldest first. Both comparisons are on ISO dates, which
  // sort correctly as strings.
  const oldestFor = new Map<string, string>();
  for (const document of due) {
    const current = oldestFor.get(document.clientId);
    const candidate = document.retentionUntil ?? '';
    if (current === undefined || candidate < current) oldestFor.set(document.clientId, candidate);
  }

  return [...due].sort((a, b) => {
    const householdA = oldestFor.get(a.clientId) ?? '';
    const householdB = oldestFor.get(b.clientId) ?? '';
    if (householdA !== householdB) return householdA < householdB ? -1 : 1;
    if (a.clientId !== b.clientId) return a.clientId < b.clientId ? -1 : 1;
    return (a.retentionUntil ?? '') < (b.retentionUntil ?? '') ? -1 : 1;
  });
}
