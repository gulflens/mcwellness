/**
 * Whether the person signed in may be shown the household's money
 * (docs/SPEC/client-portal.md section 5, rule 5; the plan's decision 2, whose
 * default was taken).
 *
 * The household is the billing unit, so every adult contact sees what is owed
 * and what is left on a package. The one exception is a young person's own
 * login: a contact whose relationship is `self` on a client under eighteen
 * sees their visits and their agreements and no figure at all. That is a rule
 * about a row, not about a tab — `app.actor_is_adult_contact_of` (migration
 * 702) says the same in the database, and `tests/portal/db` proves the two
 * agree on the day the birthday falls.
 *
 * Pure: "today" is always an argument, decided by the caller in the practice's
 * time zone (.claude/rules/testing.md).
 */

import { ageOn, type IsoDate } from '../shared';

/** The age at which a client's own login stops being a minor's. */
export const ADULT_AGE = 18;

/** What this rule needs of a contact row, and nothing more. */
export type MoneyContact = { relationship: string };

/** What it needs of the client. A record with no date of birth is treated as an adult's. */
export type MoneyClient = { dateOfBirth: IsoDate | null };

export function moneyVisibleTo(
  contact: MoneyContact,
  client: MoneyClient,
  today: IsoDate,
): boolean {
  if (contact.relationship !== 'self') {
    // A parent, a guardian or a spouse. The household pays, so the household sees.
    return true;
  }
  if (client.dateOfBirth === null) {
    // Nothing on the record says this person is a child, and inventing a
    // birthday to withhold a figure from an adult is the worse mistake:
    // date of birth is optional (docs/SPEC/00-data-model.md section 3).
    return true;
  }
  return ageOn(client.dateOfBirth, today) >= ADULT_AGE;
}
