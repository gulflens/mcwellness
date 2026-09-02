/**
 * Who is acting and what they may do. Pure: no I/O, no clock read inside;
 * `now` is always an argument (CLAUDE.md rule 4, .claude/rules/testing.md).
 *
 * What a user may do comes from their roles plus their credentials, never from
 * a role alone (docs/SPEC/00-data-model.md section 2). Row level security in
 * the database is the floor beneath these rules; the API consults `canActor`
 * before every query.
 */

export const ROLES = [
  'owner',
  'admin',
  'lead_practitioner',
  'practitioner',
  'finance',
  'client_contact',
] as const;
export type Role = (typeof ROLES)[number];

/** A calendar date as YYYY-MM-DD. Compares correctly as a string. */
export type IsoDate = string;

/** One credential's capabilities for one service type, with its validity. */
export type Capability = {
  serviceTypeId: string;
  canExecuteSession: boolean;
  canAuthorProtocol: boolean;
  canSignReport: boolean;
  validFrom: IsoDate;
  validTo: IsoDate | null;
};

export type Actor = {
  userId: string;
  tenantId: string;
  roles: readonly Role[];
  capabilities: readonly Capability[];
};

export type Action =
  | { type: 'client.read'; clientId: string }
  | { type: 'client.write'; clientId: string }
  | { type: 'user_role.grant'; role: Role }
  | { type: 'session.execute'; serviceTypeId: string; on: IsoDate }
  | { type: 'report.sign'; serviceTypeId?: string }
  | { type: 'audit.read'; clientId: string };

export type ActionContext = {
  /** The clients this actor's contact rows point at; resolved by the API for a client contact. */
  clientIds?: readonly string[];
  /** The practice's time zone, used when an action is judged "today". */
  timeZone?: string;
};

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

export function hasRole(actor: Actor, ...roles: Role[]): boolean {
  return roles.some((role) => actor.roles.includes(role));
}

/** True when `on` falls inside the credential's validity; no end date means it never expires. */
export function isCredentialValidOn(capability: Capability, on: IsoDate): boolean {
  return capability.validFrom <= on && (capability.validTo === null || on <= capability.validTo);
}

/** The calendar date of `now` in the given time zone, as YYYY-MM-DD. */
export function isoDateIn(now: Date, timeZone: string): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function canActor(actor: Actor, action: Action, ctx: ActionContext, now: Date): boolean {
  if (actor.roles.length === 0) {
    return false;
  }
  switch (action.type) {
    case 'client.read':
      if (hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'practitioner', 'finance')) {
        return true;
      }
      return hasRole(actor, 'client_contact') && (ctx.clientIds ?? []).includes(action.clientId);
    case 'client.write':
      return hasRole(actor, 'owner', 'admin');
    case 'user_role.grant':
      // Ownership is handed out by the owner alone; RLS says the same.
      if (action.role === 'owner') {
        return hasRole(actor, 'owner');
      }
      return hasRole(actor, 'owner', 'admin');
    case 'session.execute':
      return (
        hasRole(actor, 'practitioner', 'lead_practitioner') &&
        actor.capabilities.some(
          (capability) =>
            capability.serviceTypeId === action.serviceTypeId &&
            capability.canExecuteSession &&
            isCredentialValidOn(capability, action.on),
        )
      );
    case 'report.sign': {
      const today = isoDateIn(now, ctx.timeZone ?? PRACTICE_TIME_ZONE);
      return (
        hasRole(actor, 'practitioner', 'lead_practitioner') &&
        actor.capabilities.some(
          (capability) =>
            capability.canSignReport &&
            (action.serviceTypeId === undefined ||
              capability.serviceTypeId === action.serviceTypeId) &&
            isCredentialValidOn(capability, today),
        )
      );
    }
    case 'audit.read':
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner');
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
