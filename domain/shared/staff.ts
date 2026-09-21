import type { Role } from './actor';

/**
 * Who works at the practice, as Settings › Team may say it (trunk round 39,
 * 2026-09-10). Until then a member of staff reached the practice only by a
 * data step: the console could hand a household its access and could not
 * hand a colleague theirs.
 *
 * Two rules, both small enough to read in one breath:
 *
 * - **What the screen may grant.** The four working roles. Never `owner` —
 *   ownership is granted by the owner alone, beneath the API, in
 *   `db/policies/core/role_guard.sql`, and no screen offers it — and never
 *   `client_contact`, which is a household's and lives in Settings › Portal.
 * - **Nobody suspends themselves.** The person pressing the button must not
 *   be the row it is pressed on: the practice's one owner locking their own
 *   door is an outage, not a decision.
 */
export const STAFF_ROLES = ['admin', 'finance', 'practitioner', 'lead_practitioner'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/** The label a person reads, English only like the rest of the console. */
export const STAFF_ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  finance: 'Finance',
  practitioner: 'Practitioner',
  lead_practitioner: 'Lead practitioner',
  client_contact: 'Household contact',
};

/** A row that holds ownership. Nothing on it is anybody's to change (spec section 3). */
export function isLocked(roles: readonly Role[]): boolean {
  return roles.includes('owner');
}

export function canSuspend(actorUserId: string, targetUserId: string): boolean {
  return actorUserId !== targetUserId;
}

export type RoleSwitchRefusal = 'not_a_working_role' | 'not_yourself' | 'locked' | 'last_role';

/**
 * Whether a role may be switched on or off for somebody; null means yes. The
 * order is the order a person would want to be told in. The database asks the
 * off half again in `app.revoke_staff_role` (migration 923), which binds.
 */
export function canSwitchRole(input: {
  actorUserId: string;
  targetUserId: string;
  targetRoles: readonly Role[];
  role: string;
  on: boolean;
}): RoleSwitchRefusal | null {
  if (!isStaffRole(input.role)) return 'not_a_working_role';
  // Nobody widens their own access: finance opens the books and lead
  // practitioner opens erased records, so granting either to oneself would be
  // one click past the two-person shape the roles are drawn in (the security
  // review of trunk round 39, finding G1). It answers for taking one away too,
  // which is why `canGrantTo` was removed in round 58 — this one line was all
  // of it.
  if (input.actorUserId === input.targetUserId) return 'not_yourself';
  if (isLocked(input.targetRoles)) return 'locked';
  if (!input.on) {
    const left = input.targetRoles.filter((r) => isStaffRole(r) && r !== input.role);
    const holds = input.targetRoles.includes(input.role);
    // With no working role a person falls out of the team list and could
    // never be found to be given one back. Suspending is how somebody is shut out.
    if (holds && left.length === 0) return 'last_role';
  }
  return null;
}

/** An owner edits anybody who is not an owner; an owner's row is that owner's alone. */
export function canEditProfile(input: {
  actorUserId: string;
  actorRoles: readonly Role[];
  targetUserId: string;
  targetRoles: readonly Role[];
}): boolean {
  if (!input.actorRoles.includes('owner')) return false;
  return !isLocked(input.targetRoles) || input.actorUserId === input.targetUserId;
}

/** One line of plain English under each switch. English only, like the console. */
export const STAFF_ROLE_OPENS: Record<StaffRole, string> = {
  admin: 'Clients, enquiries, the schedule, billing, the portal and the practice’s settings.',
  finance: 'Billing, prices and packages, and the books.',
  practitioner: 'Their own day, sessions and measurements, for the services they are certified in.',
  lead_practitioner: 'The whole schedule and board, reports, the kit and the audit trail.',
};

/**
 * A temporary password is the sign-in itself, handed to whoever pressed the
 * button. So an admin never mints one for an owner: that would be an admin
 * becoming the owner in one press, and unlike suspending, nothing in the
 * database stands beneath this act — the password is set at the sign-in
 * service, past row security (trunk round 57, 2026-09-21). An owner may, for
 * another owner, which is how a locked-out owner gets back in.
 */
export function canResetPassword(
  actorRoles: readonly Role[],
  targetRoles: readonly Role[],
): boolean {
  // An owner, and nobody else (operator, 21 September 2026): a password minted
  // for a colleague holding Finance is the books by one remove.
  if (targetRoles.length === 0) return false;
  return actorRoles.includes('owner');
}

/** `archived` is the end of a sign-in; only `suspended` comes back. */
export function canReactivate(status: 'active' | 'suspended' | 'archived'): boolean {
  return status === 'suspended';
}
