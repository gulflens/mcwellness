import { canActor, type Actor } from '@domain/shared';

/**
 * Screen-level admission for the admin console: one rule per screen, read
 * by both the route (App.tsx sends a refused actor home) and the rail
 * (AdminLayout.tsx never offers a link a route would bounce them straight
 * back out of). Each rule is the same `canActor` action the screen's own
 * API route already enforces — restated as a role list here would drift
 * from it silently (docs/SPEC/00-data-model.md section 11, shared zone
 * round 7b part 2).
 */

/** Matches `billing.price.read` (app/api/billing) — who may open the price list. */
export function canOpenBilling(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'billing.price.read' }, {}, now);
}

/**
 * Matches `appointment.list`'s practice scope (app/api/appointments/list.ts,
 * the only scope the admin console's day schedule ever requests) — who may
 * open it. Finance can read prices but not the day's appointments.
 */
export function canOpenSchedule(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'appointment.list', scope: 'practice' }, {}, now);
}
