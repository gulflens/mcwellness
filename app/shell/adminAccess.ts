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
 * Matches `accounting.read` (app/api/accounting) — who may open the Books.
 * The owner and finance, and nobody else in this piece: an admin records a
 * household's money without keeping the practice's books
 * (docs/SPEC/accounting.md section 3), and db/policies/accounting/access.sql
 * refuses the rows beneath both this screen and the routes.
 */
export function canOpenBooks(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'accounting.read' }, {}, now);
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
 * Matches `client.list` (app/api/clients/list.ts) — who may open the pin
 * picker, `/admin/clients/pin`. The same audience `/admin/clients` itself
 * admits: every staff role, and not a household's own `client_contact`
 * account, which signs in through the same session
 * (`app/shell/routing.ts`, `app/shell/App.tsx`'s `RequireAuth`) but reaches
 * no practice data on this screen and must not be the one driving the
 * practice's browser key and its Places quota (the whole-branch review of
 * trunk round 43, finding 5). Unlike `canOpenSchedule`, this is not the
 * picker's own capability — the picker calls no API route of its own — it is
 * the capability that gates the one screen this picker is ever opened from.
 */
export function canOpenPin(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'client.list' }, {}, now);
}

/**
 * Matches `appointment.board.read` (app/api/appointments/board.ts) — who may
 * open the dispatcher's board. The three calendar roles, which are the same
 * three `appointment.reassign` admits, so nobody reaches a board whose one
 * act they could not perform (docs/SPEC/dispatch.md section 3). A
 * practitioner sees their own day on Today and not the practice's board.
 */
export function canOpenBoard(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'appointment.board.read' }, {}, now);
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
 * Matches `practitioner.base.write` (app/api/practitioners/routes.ts) — who
 * may open Settings › Practitioners.
 *
 * The question a screen guard can ask is "is there a base this person may
 * set?", so the same id is passed on both sides of the action: a base that is
 * the caller's own. The office roles pass whatever id it is, a practitioner
 * passes because it is theirs, and finance and a client contact never pass —
 * which is exactly the audience. The browser does not know which
 * `practitioner` row belongs to the person reading, and does not need to: the
 * route resolves that from the database on every request and scopes the answer
 * to one row, and `db/policies/core/practitioner_base.sql` refuses the rest
 * beneath it.
 */
export function canOpenPractitioners(actor: Actor, now: Date): boolean {
  const theirOwn = actor.userId;
  return canActor(
    actor,
    { type: 'practitioner.base.write', practitionerId: theirOwn, ownPractitionerId: theirOwn },
    {},
    now,
  );
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
 * Matches `kit.manage` (app/api/kit/routes.ts) — who may open Settings › Kit.
 * The owner, an admin and the lead practitioner: the three who decide what the
 * practice's equipment register says, and `db/policies/session/kit.sql` refuses
 * the rows beneath both this screen and the routes
 * (docs/SPEC/practitioner-phone.md section 6.2). A practitioner reads their own
 * items through the check-in block's own sentence, not through this screen.
 */
export function canOpenKit(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'kit.manage' }, {}, now);
}

/**
 * Matches `audit.activity` (app/api/audit/activity.ts) — who may open Audit.
 * The owner, an admin and the lead practitioner: reading who did what is
 * oversight, and finance reads money rather than the trail.
 * `db/policies/core/audit_log.sql` refuses the rows beneath both this screen
 * and the routes (docs/SPEC/audit.md section 9).
 */
export function canOpenAudit(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'audit.activity' }, {}, now);
}

/**
 * Matches `staff.manage` (app/api/team/routes.ts) — who may open Settings ›
 * Team. The owner and an admin: the two `db/policies/core/role_guard.sql`
 * lets write a colleague's row, and the same two the API admits.
 */
export function canOpenTeam(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'staff.manage' }, {}, now);
}

/**
 * Matches `enquiry.list` (app/api/enquiries/routes.ts) — who may open
 * Enquiries. The owner, an admin and the lead practitioner: the same three
 * who action one (`enquiry.action`), because a screen that shows a name and a
 * number one may not then convert or dismiss would only be a leak.
 * `db/policies/enquiry/readers.sql` refuses the rows beneath both this screen
 * and the routes (docs/superpowers/specs/2026-09-09-enquiries-design.md).
 */
export function canOpenEnquiries(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'enquiry.list' }, {}, now);
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

/**
 * Where the rail's single Settings entry should land this person: the first
 * settings screen they may actually open, or null when there is none.
 *
 * There are two screens under Settings and their audiences differ — Practice
 * is the owner's and an admin's, Practitioners is theirs and every
 * practitioner's — so one fixed destination cannot serve both. `ADMIN_SECTIONS`
 * has no actor in hand and so cannot answer this; `AdminLayout.visibleSections`
 * does, and asks here (the review of pull request 126, finding B1: the
 * capability the round exists for was built and had no door, because the rail's
 * entry was gated on `practice.settings.write` and pointed at Practice alone).
 *
 * Practice first, so nobody who may open both is moved off the screen the rail
 * has always landed on.
 */
export function settingsHomeFor(actor: Actor, now: Date): string | null {
  if (canOpenSettings(actor, now)) return '/admin/settings/practice';
  if (canOpenPractitioners(actor, now)) return '/admin/settings/practitioners';
  return null;
}
