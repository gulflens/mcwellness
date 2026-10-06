import type { Actor } from './auth/AuthContext';

/** Where a person lands after sign-in. The admin desk wins when a person holds several areas. */
export function homeFor(actor: Pick<Actor, 'roles'>): string {
  const roles = new Set<string>(actor.roles);
  if (['owner', 'admin', 'lead_practitioner', 'finance'].some((r) => roles.has(r)))
    return '/admin/clients';
  if (roles.has('practitioner')) return '/today';
  if (roles.has('client_contact')) return '/portal';
  // A helper (round 76, docs/SPEC/dispatch.md section 15.12): one page, their
  // own location while they help, and nothing else of the practice.
  if (roles.has('helper')) return HELPER_HOME;
  return '/no-access';
}

/** A helper's one page. */
export const HELPER_HOME = '/help';

/**
 * Somebody who holds the helper role and nothing else. Every other face of
 * the app sends them to their own page rather than draw a screen whose every
 * request would be refused (app/api/location/helperFence.ts).
 */
export function isHelperOnly(actor: Pick<Actor, 'roles'>): boolean {
  return actor.roles.length === 1 && actor.roles[0] === 'helper';
}

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  lead_practitioner: 'Lead practitioner',
  practitioner: 'Practitioner',
  finance: 'Finance',
  client_contact: 'Client contact',
  helper: 'Helper',
};

export function describeRoles(roles: readonly string[]): string {
  return roles.map((r) => ROLE_LABELS[r] ?? r).join(', ');
}
