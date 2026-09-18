import type { EnquiryStatus } from './list';

/**
 * What an enquiry keeps of its person, and for what (the operator's decision
 * of 19 September 2026, docs/superpowers/plans/2026-09-19-enquiries-keep-details.md).
 * Pure.
 *
 * The rule the rest hangs from: **a person is kept only if they were told they
 * would be.** The expo's form promised, until that date, that an enquiry
 * "keeps nothing personal" once replied. Every row lodged under that sentence
 * is still scrubbed on dismissal, whatever the screen would prefer; only a
 * row lodged under the second wording may be kept. The database holds the
 * same rule in a constraint (migration 921), so this is the screen and the
 * route agreeing with the table, not standing in for it.
 */

/** 1: "…keeps nothing personal." 2: "…we keep them so we can follow up with you later." */
export type NoticeVersion = 1 | 2;

/**
 * Which wording a form says it showed. Anything but a plain 2 is the first:
 * a form that does not say is a form not yet changed, and it made the promise.
 */
export function noticeOf(value: unknown): NoticeVersion {
  return value === 2 || value === '2' ? 2 : 1;
}

/** Whether dismissing this enquiry leaves its person on the row. */
export function dismissalKeeps({
  noticeVersion,
  erase,
}: {
  noticeVersion: NoticeVersion;
  /** The person dismissing chose to erase: spam, a wrong number, somebody who asked. */
  erase: boolean;
}): boolean {
  return noticeVersion === 2 && !erase;
}

/**
 * Whether reading this row is reading somebody. A waiting row always is; since
 * migration 921 a dismissed one may be. Every such read is logged
 * (CLAUDE.md rule 5).
 */
export function carriesAPerson(row: { name: string | null }): boolean {
  return row.name !== null;
}

/**
 * Whether this person may go on the list the practice sends its news from:
 * they ticked the second wording's optional box, they are still on the row,
 * and they have not become a client, whose consents are the record's own
 * documents and not a form's tick.
 */
export function isMarketable(row: {
  status: EnquiryStatus;
  name: string | null;
  marketingOptIn: boolean | null;
}): boolean {
  return row.marketingOptIn === true && carriesAPerson(row) && row.status !== 'converted';
}
