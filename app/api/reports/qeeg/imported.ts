/**
 * How every door but the past record's own refuses one
 * (docs/SPEC/reports-qeeg.md section 11, point 4): by code, and the same code
 * at each door.
 *
 * **Two codes, because there are two states.** A draft being brought in
 * (`imported_draft`) is the import's to finish: its pictures go through the
 * maps door and it is kept through its own. A kept past record
 * (`imported_record`) is frozen: it is never signed (its fixed wording would
 * be today's, not what the household received), never corrected, never sent
 * and never shown to the household, and it has no pages of this app's.
 */

export type ImportedRefusal = 'imported_draft' | 'imported_record';

export function importedRefusal(record: {
  readonly status: string;
  readonly imported_from: string | null;
}): ImportedRefusal | null {
  if (record.status === 'imported') return 'imported_record';
  if (record.imported_from !== null) return 'imported_draft';
  return null;
}
