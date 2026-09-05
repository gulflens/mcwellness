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

/**
 * Matches `practice.settings.write` (app/api/practice/routes.ts) — who may
 * open Settings. The practice's legal name, its trade licence and its VAT
 * registration are what a tax invoice says the supplier is, so the audience is
 * the owner and an admin: finance records money without deciding whose name it
 * is taken in, and `app.guard_tenant_identity` (migration 905) says the same
 * beneath both the route and this screen.
 */
export function canOpenSettings(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'practice.settings.write' }, {}, now);
}

/**
 * Matches `portal.access.manage` (app/api/portal/access.ts) — who may open
 * Settings › Portal. Handing out access to a household's own record is the
 * same class of act as granting a role, so the audience is the owner and an
 * admin, and `db/policies/portal/access.sql` refuses the rows beneath both
 * this screen and the route (docs/SPEC/client-portal.md section 3.8).
 */
export function canOpenPortalAccess(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'portal.access.manage' }, {}, now);
}

/**
 * Matches the `/today/check-in` gate in App.tsx: who may cross to the
 * practitioner's side. An owner who also treats holds `lead_practitioner`
 * alongside owner, so the console offers them "Today"; an admin-only or
 * finance account never sees it.
 */
export function canOpenToday(actor: Pick<Actor, 'roles'>): boolean {
  return actor.roles.includes('practitioner') || actor.roles.includes('lead_practitioner');
}
