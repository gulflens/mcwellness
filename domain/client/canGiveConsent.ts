import type { IsoDate } from '../shared/actor';
import { isMinor } from './isMinor';
import type { ConsentPurpose } from './types';

/**
 * Why a contact may not give this consent. Each is a sentence the console
 * turns into plain language; the route answers with the code so the two
 * cannot drift.
 */
export type ConsentRefusal =
  /** The contact has no `can_consent` flag: the practice has not said they may. */
  | 'contact_may_not_consent'
  /** The client is a minor, or the purpose is a guardian's own, and this contact is not a legal guardian. */
  | 'guardian_required';

export type ConsentGiver = {
  id: string;
  canConsent: boolean;
  isLegalGuardian: boolean;
};

export type ConsentSubject = {
  dateOfBirth: IsoDate | null;
};

/**
 * Whether `giver` may give `purpose` for this client on `today`
 * (docs/SPEC/client-record.md sections 3 and 7).
 *
 * Two rules, and no more than two:
 *
 *   1. The contact must be one the practice has marked as able to consent.
 *      That flag is the practice's own judgement about a person and no screen
 *      may work around it.
 *   2. A legal guardian is additionally required when the consent is one only
 *      a guardian can give — either because the client is a minor on `today`
 *      and cannot consent for themselves, or because the purpose is
 *      `minor_participation`, which asserts a guardian gave it whatever the
 *      client's age is now.
 *
 * The second half of rule 2 is what keeps this in step with `canActivate`,
 * which satisfies `consent:minor_participation` only from a row given by a
 * legal guardian who may consent. Without it a seventeen-year-old could have
 * a guardian's consent recorded against a sibling, activation would refuse
 * it, and nothing on screen would say why.
 *
 * An unknown date of birth is treated as "not known to be a minor", which is
 * what `requiredConsents` already does with the same field: this function
 * refuses what it can name, and inventing an age is not one of the things it
 * can name. A lead with no date of birth cannot be activated regardless
 * (`canActivate`'s `date_of_birth`), so nothing slips through the gate on it.
 *
 * Pure, and the clock is an argument: a client turning eighteen must change
 * this answer on the day the practice's calendar says so, not the server's.
 */
export function canGiveConsent(
  subject: ConsentSubject,
  giver: ConsentGiver,
  purpose: ConsentPurpose,
  today: IsoDate,
): { ok: true } | { ok: false; reason: ConsentRefusal } {
  if (!giver.canConsent) {
    return { ok: false, reason: 'contact_may_not_consent' };
  }
  const subjectIsMinor = subject.dateOfBirth !== null && isMinor(subject.dateOfBirth, today);
  const guardianRequired = subjectIsMinor || purpose === 'minor_participation';
  if (guardianRequired && !giver.isLegalGuardian) {
    return { ok: false, reason: 'guardian_required' };
  }
  return { ok: true };
}
