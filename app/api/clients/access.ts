import type { Actor } from '../../../domain/shared';
import { canActor, hasRole } from '../../../domain/shared';

/**
 * Whether `actor` may write the client aggregate (demographics, contacts,
 * locations, consent): the owner, an admin, or the lead practitioner
 * ("all of the above, plus...", docs/SPEC/client-record.md section 2).
 * canActor's own 'client.write' (domain/shared/actor.ts) grants only owner
 * and admin; the lead practitioner is added here rather than in that shared
 * file, which this worktree does not own. canActor runs first, as every
 * route here does, and this extends rather than replaces its answer.
 */
export function canWriteClientRecord(actor: Actor, clientId: string, now: Date): boolean {
  return (
    canActor(actor, { type: 'client.write', clientId }, {}, now) ||
    hasRole(actor, 'lead_practitioner')
  );
}

/** Only the owner and the lead practitioner set or close a goal (section 2). */
export function canWriteGoal(actor: Actor): boolean {
  return hasRole(actor, 'owner', 'lead_practitioner');
}

/**
 * Performing an erasure: the owner and an admin (docs/SPEC/client-record.md
 * section 8, "Admin action"). Deliberately narrower than `app.erase_client`,
 * which also admits the lead practitioner — the database is the floor and the
 * floor may be wider than the door.
 */
export function canPerformErasure(actor: Actor): boolean {
  return hasRole(actor, 'owner', 'admin');
}

/** Recording that a household asked to be forgotten: the three who write the record. */
export function canRecordErasureRequest(actor: Actor): boolean {
  return hasRole(actor, 'owner', 'admin', 'lead_practitioner');
}
