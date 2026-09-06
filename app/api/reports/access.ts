import { canActor, type Actor } from '../../../domain/shared';

/**
 * Who may do each of the reports routes' acts (docs/SPEC/reports-v1.md section
 * 7.1), asked by name rather than by the permission that happens to cover it.
 *
 * The four actions live in `domain/shared/actor.ts`, which this piece is
 * authorised to extend (`docs/CHANGE-REQUESTS/reports-01.md`, item 8). Signing
 * is deliberately **not** among them: `canIssue` in `domain/reports` is the
 * rule for that, and it reads a credential rather than a role — because
 * nothing but a credential grants it (section 10, decision 6).
 */

/** A client's reports, listed. */
export function mayListReports(
  actor: Actor,
  clientId: string,
  ctx: { clientIds?: readonly string[] },
  now: Date,
): boolean {
  return canActor(actor, { type: 'report.list', clientId }, ctx, now);
}

/** One report, and the link that opens it. */
export function mayReadReport(
  actor: Actor,
  clientId: string,
  ctx: { clientIds?: readonly string[] },
  now: Date,
): boolean {
  return canActor(actor, { type: 'report.read', clientId }, ctx, now);
}

/** Writing a draft. */
export function mayDraftReport(actor: Actor, clientId: string, now: Date): boolean {
  return canActor(actor, { type: 'report.draft', clientId }, {}, now);
}

/**
 * Replacing a signed version with a corrected one. Narrower than drafting:
 * the owner and the lead practitioner alone (section 7.1), because
 * superseding hides a version the household may already hold.
 */
export function maySupersedeReport(actor: Actor, clientId: string, now: Date): boolean {
  return canActor(actor, { type: 'report.supersede', clientId }, {}, now);
}

/** Putting a signed report in front of a household. */
export function mayDeliverReport(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'report.deliver' }, {}, now);
}
