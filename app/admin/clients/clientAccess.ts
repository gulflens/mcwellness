import type { Actor } from '@domain/shared';
import {
  canPerformErasure,
  canRecordErasureRequest,
  canWriteClientRecord,
  canWriteGoal,
} from '../../api/clients/access';

/**
 * Screen-level admission for the client record: which write actions this
 * person is offered at all. One rule per action, and each is literally the
 * function the matching API route calls — imported, not restated, because a
 * role list copied onto a screen drifts from the route silently
 * (app/shell/adminAccess.ts, shared zone round 7b part 2, makes the same
 * argument for the console's screens).
 *
 * The database is the boundary and the API is the gate; this only decides
 * what to render. A button offered to someone the routes will refuse is not a
 * security hole, but it is a promise the practice cannot keep — the person
 * fills in a form and is told "no" at the end of it.
 */

/** Contacts, locations, consent, demographics, activation: the client aggregate. */
export function canWriteRecord(actor: Actor | null, now: Date): boolean {
  // clientId is unused by the rule for every role that reaches these screens
  // (access.ts checks the action, not the row); the routes pass the real id and
  // row level security is what actually scopes the write.
  return actor !== null && canWriteClientRecord(actor, '', now);
}

/** Setting a goal and closing one: the owner and the lead practitioner alone. */
export function canWriteGoals(actor: Actor | null): boolean {
  return actor !== null && canWriteGoal(actor);
}

/**
 * Finance opens a client record and sees demographics and contacts, never
 * locations, goals, consents or documents (docs/SPEC/client-record.md
 * section 2 and rule 6). The API already floors that — `GET /api/clients/:id`
 * is scoped per section and the read policies refuse the rest — so a tab
 * offered here would open onto nothing it could fill. The screen matches the
 * rule rather than discovering it.
 */
export function canSeeFullRecord(actor: Actor | null): boolean {
  if (actor === null) return false;
  return actor.roles.some((role) => role !== 'finance');
}

/** Writing down that a household asked to be forgotten. */
export function canAskForErasure(actor: Actor | null): boolean {
  return actor !== null && canRecordErasureRequest(actor);
}

/** Pressing the button that erases them: the owner and an admin, and nobody else. */
export function canErase(actor: Actor | null): boolean {
  return actor !== null && canPerformErasure(actor);
}
