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
  | { type: 'client.list' }
  | { type: 'client.read'; clientId: string }
  | { type: 'client.write'; clientId: string }
  | { type: 'user_role.grant'; role: Role }
  | { type: 'session.execute'; serviceTypeId: string; on: IsoDate }
  | { type: 'report.sign'; serviceTypeId?: string }
  | { type: 'audit.read'; clientId: string }
  | { type: 'appointment.list'; scope: 'practice' | 'own' }
  | { type: 'appointment.create'; practitionerId: string; serviceTypeId: string; on: IsoDate }
  | { type: 'billing.price.read' }
  | { type: 'billing.price.write' }
  | { type: 'billing.package.read' }
  | { type: 'billing.package.write' }
  | { type: 'billing.sale.write' }
  | { type: 'billing.payment.write' }
  | { type: 'billing.waiver.write' }
  | { type: 'billing.invoice.read' }
  | { type: 'billing.refund.read' }
  | { type: 'billing.balance.read'; clientId: string };

export type ActionContext = {
  /** The clients this actor's contact rows point at; resolved by the API for a client contact. */
  clientIds?: readonly string[];
  /** The practice's time zone, used when an action is judged "today". */
  timeZone?: string;
  /** The credentials of the practitioner an appointment is booked for; resolved by the route. */
  assigneeCapabilities?: readonly Capability[];
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
    case 'client.list':
      // A practitioner lists only the clients on their schedule; the route applies that scope.
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'practitioner', 'finance');
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
    case 'appointment.list':
      if (action.scope === 'own') {
        // A practitioner's own day; the route and the row policies keep it to their rows.
        return hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'practitioner');
      }
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner');
    case 'appointment.create':
      // Booking takes the booking role and, for the assignee, a credential that lets
      // them deliver that service on that date: a role alone never suffices. The
      // assignee's credentials are the route's to resolve, for action.practitionerId
      // and nobody else, and pass in; like ctx.clientIds, that binding is trusted here.
      return (
        hasRole(actor, 'owner', 'admin', 'lead_practitioner') &&
        (ctx.assigneeCapabilities ?? []).some(
          (capability) =>
            capability.serviceTypeId === action.serviceTypeId &&
            capability.canExecuteSession &&
            isCredentialValidOn(capability, action.on),
        )
      );
    case 'billing.price.read':
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'finance');
    case 'billing.price.write':
      // The price list; the service catalogue itself stays with the owner and an admin.
      return hasRole(actor, 'owner', 'admin', 'finance');
    case 'billing.package.read':
    // Narrower than ledger_readers on purpose today (office roles only); the client
    // portal will widen it to a contact for their own client, as billing.balance.read is.
    case 'billing.invoice.read':
    case 'billing.refund.read':
      // The bundle catalogue, the invoice book and a refund quote: the same
      // audience the price list has. A refund quote is arithmetic over rows
      // a lead practitioner may already read (db/policies/billing/ledger.sql),
      // so narrowing it here would be a courtesy pretending to be a boundary.
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'finance');
    case 'billing.package.write':
    case 'billing.sale.write':
    case 'billing.payment.write':
    case 'billing.waiver.write':
      // Recording money: the owner, an admin and finance. One audience today,
      // four names, so a coordinator who may take a payment but not amend the
      // price list is a change to one line rather than to a route.
      return hasRole(actor, 'owner', 'admin', 'finance');
    case 'billing.balance.read':
      // The one billing action that reaches past the office. A practitioner
      // asks because the stop card says "Session 3 of 15" and what is owed;
      // how far they reach is app.client_visible_to_practitioner's to decide,
      // not this file's. A client contact reads their own client's.
      if (hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'finance', 'practitioner')) {
        return true;
      }
      return hasRole(actor, 'client_contact') && (ctx.clientIds ?? []).includes(action.clientId);
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
