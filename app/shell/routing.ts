import type { Actor } from './auth/AuthContext';

/** Where a person lands after sign-in. The admin desk wins when a person holds several areas. */
export function homeFor(actor: Pick<Actor, 'roles'>): string {
  const roles = new Set<string>(actor.roles);
  if (['owner', 'admin', 'lead_practitioner', 'finance'].some((r) => roles.has(r)))
    return '/admin/clients';
  if (roles.has('practitioner')) return '/today';
  if (roles.has('client_contact')) return '/portal';
  return '/no-access';
}

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  lead_practitioner: 'Lead practitioner',
  practitioner: 'Practitioner',
  finance: 'Finance',
  client_contact: 'Client contact',
};

export function describeRoles(roles: readonly string[]): string {
  return roles.map((r) => ROLE_LABELS[r] ?? r).join(', ');
}
