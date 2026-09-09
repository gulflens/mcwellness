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

/** `archived` is the end of a sign-in; only `suspended` comes back. */
export function canReactivate(status: 'active' | 'suspended' | 'archived'): boolean {
  return status === 'suspended';
}
