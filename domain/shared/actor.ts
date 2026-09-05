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
  | { type: 'practice.settings.write' }
  | { type: 'session.execute'; serviceTypeId: string; on: IsoDate }
  | { type: 'report.sign'; serviceTypeId?: string }
  | { type: 'report.list'; clientId: string }
  | { type: 'report.read'; clientId: string }
  | { type: 'report.draft'; clientId: string }
  | { type: 'report.deliver' }
  | { type: 'audit.read'; clientId: string }
  | { type: 'appointment.list'; scope: 'practice' | 'own' }
  | { type: 'appointment.create'; practitionerId: string; serviceTypeId: string; on: IsoDate }
  | { type: 'appointment.move' }
  | { type: 'appointment.cancel'; ownStop: boolean }
  | { type: 'billing.price.read' }
  | { type: 'billing.price.write' }
  | { type: 'billing.package.read' }
  | { type: 'billing.package.write' }
  | { type: 'billing.sale.write' }
  | { type: 'billing.payment.write' }
  | { type: 'billing.waiver.write' }
  | { type: 'billing.invoice.read' }
  | { type: 'billing.refund.read' }
  | { type: 'billing.balance.read'; clientId: string }
  | { type: 'contact.write_own'; contactUserId: string | null }
  | { type: 'portal.request.write'; clientId: string }
  | { type: 'portal.request.handle' }
  | { type: 'portal.access.manage' }
  | { type: 'kit.manage' }
  | { type: 'kit.read'; assignedToSelf: boolean }
  | { type: 'routing.day.read'; scope: 'own' }
  | { type: 'assessment.read' }
  | { type: 'assessment.record' }
  | { type: 'assessment.file' };

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
    case 'practice.settings.write':
      // The practice's own identity: its legal name, its trade licence and
      // whether it charges VAT. The owner and an admin, and nobody else —
      // this is what a tax invoice says the supplier is, so a coordinator who
      // may take a payment is deliberately not the same person as one who may
      // change the name the receipt is issued under. The floor beneath this is
      // app.guard_tenant_identity (migration 905), not this rule.
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
    case 'report.list':
    case 'report.read':
      // Who may see that a report exists, and open it
      // (docs/SPEC/reports-v1.md section 7.1). The four practice roles that
      // are not finance, and a contact for their own client — whose reach is
      // narrower still in the database, which shows them issued versions only
      // (db/policies/reports/reports.sql). **Finance is deliberately absent**:
      // every other client-scoped read in this platform admits it, because
      // money reaches everywhere, and a report is a household's most personal
      // document. A coordinator who records payments has no business in one.
      if (hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'practitioner')) {
        return true;
      }
      return hasRole(actor, 'client_contact') && (ctx.clientIds ?? []).includes(action.clientId);
    case 'report.draft':
      // Writing one, before anybody signs it. The owner, the lead
      // practitioner, and a practitioner for a client visible to them — how
      // far that reaches is app.client_visible_to_practitioner's to decide,
      // not this file's. An admin reads and delivers and never drafts; the row
      // policy says the same underneath.
      return hasRole(actor, 'owner', 'lead_practitioner', 'practitioner');
    case 'report.deliver':
      // Putting a signed report in front of a household. The owner, an admin
      // and the lead practitioner. Whether this particular household may be
      // sent this particular report is `canDeliver` in domain/reports, which
      // asks the consent and the contact's own flag at the moment of sending;
      // this only says the role is allowed to ask.
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner');
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
    case 'appointment.move':
      // Rearranging the diary: the three calendar roles. A practitioner
      // "request[s] a change (Stage 2)" (docs/SPEC/scheduling-manual.md
      // section 2) rather than making one, and the row policy on appointment
      // says the same underneath.
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner');
    case 'appointment.cancel':
      // The same three, for any visit — and a practitioner, for their own
      // stop alone. They are the person who arrives at a door to find the
      // visit cannot go ahead. Whether the stop is theirs is the route's to
      // resolve and pass in, the way ctx.assigneeCapabilities already is;
      // app.cancel_own_appointment (203) asks it again in the database,
      // which is the answer that binds.
      if (hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
        return true;
      }
      return hasRole(actor, 'practitioner') && action.ownStop;
    case 'billing.price.read':
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'finance');
    case 'billing.price.write':
      // The price list; the service catalogue itself stays with the owner and an admin.
      return hasRole(actor, 'owner', 'admin', 'finance');
    // billing.invoice.read is narrower than ledger_readers on purpose today (office roles only); the client
    // portal will widen it to a contact for their own client, as billing.balance.read is.
    case 'billing.package.read':
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
    case 'contact.write_own':
      // A household correcting its own telephone, email or WhatsApp
      // preference (docs/SPEC/client-portal.md section 5, rule 2). The route
      // reads the contact row's own user_id and passes it; a row belonging to
      // anybody else is not this person's to touch, and the guard trigger
      // app.guard_contact_self_service (migration 702) says the same beneath,
      // for the columns as well as the row. Deliberately not widened to staff:
      // an owner or an admin edits a contact through the record's own routes,
      // where the whole row is theirs to change.
      return (
        hasRole(actor, 'client_contact') &&
        action.contactUserId !== null &&
        action.contactUserId === actor.userId
      );
    case 'portal.request.write':
      // Asking the practice to withdraw a consent or to erase the record. A
      // contact, for a client in their own household; ctx.clientIds is
      // resolved by the route from app.portal_client_ids() on every request,
      // never from anything the caller claims.
      return hasRole(actor, 'client_contact') && (ctx.clientIds ?? []).includes(action.clientId);
    case 'portal.request.handle':
      // Marking one as dealt with. The office roles: the act itself —
      // withdrawing, erasing — happens on the record's own screens.
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner');
    case 'portal.access.manage':
      // Inviting a household in, resending and revoking. The owner and an
      // admin, and nobody else: handing out access to a record is the same
      // class of act as granting a role, and db/policies/portal/access.sql
      // refuses the row underneath this.
      return hasRole(actor, 'owner', 'admin');
    case 'kit.manage':
      // The equipment register: listing it, adding an item, editing one,
      // assigning it and recording a calibration
      // (docs/SPEC/practitioner-phone.md section 6.2). The owner, an admin and
      // the lead practitioner — the three who run the practice's instruments.
      // A practitioner carries the kit and does not decide what the register
      // says about it; db/policies/session/kit.sql refuses the write
      // underneath this.
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner');
    case 'kit.read':
      // The same three for the whole register, and a practitioner for the
      // items assigned to them — which is what the check-in block is about,
      // so somebody stopped at a door can see which amplifier is overdue.
      // Whether an item is theirs is the route's to resolve and pass in, the
      // way ctx.assigneeCapabilities already is; the row policy asks it again
      // in the database, which is the answer that binds.
      if (hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
        return true;
      }
      return hasRole(actor, 'practitioner') && action.assignedToSelf;
    case 'routing.day.read':
      // The drive between one's own stops, and the day's picture
      // (docs/SPEC/practitioner-phone.md section 5). The audience of
      // appointment.list's own scope, because it answers about exactly the
      // stops that scope already shows: the day sheet's estimates are a
      // reading of the day sheet.
      return (
        action.scope === 'own' &&
        hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'practitioner')
      );
    case 'assessment.read':
      // A measurement and the files behind it (docs/SPEC/assessment.md
      // sections 4 and 7). The practice's three oversight roles, and a
      // practitioner — for a client on their own schedule, which is
      // app.client_visible_to_practitioner's to decide and not this file's.
      //
      // **Finance and a client contact are absent, and that is the rule
      // rather than an omission.** A household sees nothing of a measurement
      // until a report is issued, because a qEEG export means nothing without
      // the practitioner's reading of it; db/policies/assessment/access.sql
      // refuses the rows underneath this, which is the answer that binds.
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'practitioner');
    case 'assessment.record':
      // Taking a measurement, and correcting one. A practitioner, never an
      // administrator: section 7.2 lets an admin file an export against an
      // assessment a practitioner recorded, and lets nobody who did not take a
      // measurement say that they did. Whether they hold a valid certification
      // for that service today is asked in the database at the moment of
      // writing (app.assessment_context, migration 500), never from a
      // capability a token was minted with.
      return hasRole(actor, 'practitioner', 'lead_practitioner');
    case 'assessment.file':
      // Filing the equipment's own export against a measurement somebody
      // recorded. The reading audience, admin included (section 7.2).
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'practitioner');
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
