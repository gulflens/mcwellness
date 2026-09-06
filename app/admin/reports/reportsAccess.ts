import type { Actor } from '@domain/shared';
import { canActor, hasRole } from '@domain/shared';

/**
 * What the Reports tab offers whom (docs/SPEC/reports-v1.md section 7.1).
 *
 * **A courtesy, not a boundary.** The row policies refuse the rows and the
 * routes refuse the requests; this only decides whether a button is worth
 * showing. A screen that offered a person an action the server would refuse
 * teaches them the app is broken.
 */

export function canSeeReports(actor: Actor | null, now: Date, clientId: string): boolean {
  return actor !== null && canActor(actor, { type: 'report.list', clientId }, {}, now);
}

export function canDraftReports(actor: Actor | null, now: Date, clientId: string): boolean {
  return actor !== null && canActor(actor, { type: 'report.draft', clientId }, {}, now);
}

/**
 * Whether to offer "Correct this report". Narrower than drafting: the owner
 * and the lead practitioner alone (section 7.1), because superseding hides a
 * version the household may already hold.
 */
export function canSupersedeReports(actor: Actor | null, now: Date, clientId: string): boolean {
  return actor !== null && canActor(actor, { type: 'report.supersede', clientId }, {}, now);
}

export function canDeliverReports(actor: Actor | null, now: Date): boolean {
  return actor !== null && canActor(actor, { type: 'report.deliver' }, {}, now);
}

/**
 * Whether this person may reasonably be offered the signing door at all.
 *
 * The rule that decides a signature is `canIssue` in `domain/reports`, and it
 * reads a credential rather than a role — nothing else grants it (section 10,
 * decision 6). The token carries the person's own capabilities, so the screen
 * can tell in advance whether to offer a signature or a sentence; the server
 * re-reads the credential at the moment of signing, and that is the answer
 * that binds.
 */
export function mayOfferSigning(actor: Actor | null, today: string): boolean {
  if (actor === null) return false;
  return actor.capabilities.some(
    (capability) =>
      capability.canSignReport &&
      capability.validFrom <= today &&
      (capability.validTo === null || today <= capability.validTo),
  );
}

/** Whether this person holds a practice role at all, for the empty state's wording. */
export function isPracticeMember(actor: Actor | null): boolean {
  return (
    actor !== null &&
    hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'practitioner', 'finance')
  );
}
