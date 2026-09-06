/**
 * Whether the person signed in may be shown a report about one of the
 * household's people (`docs/SPEC/reports-v1.md` section 7.3; the operator's
 * decision of 2026-09-06, reversing default 4 of pull request 83).
 *
 * A legal guardian, or the person themselves once they are an adult, and
 * nobody else. It is deliberately narrower than `moneyVisibleTo` beside it:
 * money admits every contact who is not a minor's own login, because the
 * household pays and whoever settles an invoice has business with a balance. A
 * report is a practitioner's written summary of a person, a guardian is who
 * receives it and talks a child through it, and a contact the practice has not
 * recorded as a legal guardian has no standing to read one.
 *
 * The database says the same and is the boundary:
 * `app.actor_may_read_reports_of` (migration 955) carries this rule into the
 * `report` read policy, so the row is refused whatever a screen asks for.
 *
 * Pure: "today" is always an argument, decided by the caller in the practice's
 * time zone (.claude/rules/testing.md).
 */

import { ageOn, type IsoDate } from '../shared';
import { ADULT_AGE } from './money';

/** What this rule needs of a contact row, and nothing more. */
export type ReportContact = { relationship: string; isLegalGuardian: boolean };

/** What it needs of the client. A record with no date of birth is treated as an adult's. */
export type ReportClient = { dateOfBirth: IsoDate | null };

export function reportsVisibleTo(
  contact: ReportContact,
  client: ReportClient,
  today: IsoDate,
): boolean {
  if (contact.isLegalGuardian) {
    // A guardian, whoever they are to the child.
    return true;
  }
  if (contact.relationship !== 'self') {
    // A relative, a spouse, a payer: on the record and not this document's
    // reader. The practice sends a report to whoever it means to send it to,
    // and `can_receive_reports` is the flag that governs that.
    return false;
  }
  if (client.dateOfBirth === null) {
    // Nothing on the record says this person is a child, and inventing a
    // birthday to withhold a document from an adult is the worse mistake:
    // date of birth is optional (docs/SPEC/00-data-model.md section 3).
    return true;
  }
  return ageOn(client.dateOfBirth, today) >= ADULT_AGE;
}
