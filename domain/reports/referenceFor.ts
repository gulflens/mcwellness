/**
 * Rule 5 (docs/SPEC/reports-v1.md section 8): the printed form of the number
 * the database allocated.
 *
 * **The number is the database's and the shape is this file's.** `report.number`
 * comes from a per-practice counter taken with one `update ... returning`
 * (migration 600), exactly as the invoice number does, so two reports issued at
 * the same moment take two different numbers and a rolled-back issue gives its
 * number back. Rendering it is arithmetic and belongs here, where it can be
 * tested without a database — and the column is `generated always as` from the
 * same expression, so the row can never drift from what this prints.
 *
 * **"RPT-", and it says on its own face that it is not a tax number.** A
 * household quotes this to the practice; nothing else reads it. Six digits is
 * a million reports, which is several lifetimes of a home-visit practice, and
 * a seventh appears rather than wrapping (section 6: never reused).
 */

export const REFERENCE_PREFIX = 'RPT-';
const PAD = 6;

export function referenceFor(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    // A report with no number has not been issued, and a caller asking for the
    // reference of one has a bug rather than a blank to render.
    throw new Error('A report reference is made from a whole number from 1 upwards.');
  }
  return `${REFERENCE_PREFIX}${String(sequence).padStart(PAD, '0')}`;
}

/** The number back out of a reference, or null when it is not one of ours. */
export function sequenceOf(reference: string): number | null {
  if (!reference.startsWith(REFERENCE_PREFIX)) return null;
  const digits = reference.slice(REFERENCE_PREFIX.length);
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return value >= 1 ? value : null;
}
