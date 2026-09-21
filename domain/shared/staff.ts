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

export function canSuspend(actorUserId: string, targetUserId: string): boolean {
  return actorUserId !== targetUserId;
}

/**
 * Nobody widens their own access. An admin may grant finance or lead
 * practitioner to a colleague — and finance opens the books, lead
 * practitioner opens erased records — so granting either to oneself would be
 * one click past the two-person shape the roles are drawn in (the security
 * review of trunk round 39, finding G1).
 */
export function canGrantTo(actorUserId: string, targetUserId: string): boolean {
  return actorUserId !== targetUserId;
}

/**
 * A temporary password is the sign-in itself, handed to whoever pressed the
 * button. So an admin never mints one for an owner: that would be an admin
 * becoming the owner in one press, and unlike suspending, nothing in the
 * database stands beneath this act — the password is set at the sign-in
 * service, past row security (trunk round 57, 2026-09-22). An owner may, for
 * another owner, which is how a locked-out owner gets back in.
 *
 * The rule permits by the absence of `owner` from a list, so an empty list is
 * refused outright: a caller that could not read the target's roles has not
 * learned that the target is no owner, and a check that cannot see must not
 * answer yes (the round's security review, N1).
 */
export function canResetPassword(
  actorRoles: readonly Role[],
  targetRoles: readonly Role[],
): boolean {
  if (targetRoles.length === 0) return false;
  return !targetRoles.includes('owner') || actorRoles.includes('owner');
}

/** `archived` is the end of a sign-in; only `suspended` comes back. */
export function canReactivate(status: 'active' | 'suspended' | 'archived'): boolean {
  return status === 'suspended';
}
