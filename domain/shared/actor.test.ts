import { describe, expect, it } from 'vitest';
import {
  canActor,
  isCredentialValidOn,
  isoDateIn,
  ROLES,
  type Action,
  type Actor,
  type Capability,
  type Role,
} from './actor';

const SERVICE = '00000000-0000-4000-8000-0000000000f1';
const OTHER_SERVICE = '00000000-0000-4000-8000-0000000000f2';
const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const OTHER_CLIENT = '00000000-0000-4000-8000-0000000000c2';
const NOW = new Date('2026-09-02T08:00:00Z');

/** The office: who reads the money (docs/SPEC/billing.md, "Who uses it"). */
const OFFICE_READERS = ['owner', 'admin', 'lead_practitioner', 'finance'] as const;
/** Who records it. The lead practitioner reads the ledger and writes nothing to it. */
const MONEY_WRITERS = ['owner', 'admin', 'finance'] as const;

const sessionCredential: Capability = {
  serviceTypeId: SERVICE,
  canExecuteSession: true,
  canAuthorProtocol: false,
  canSignReport: false,
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
};

function actor(roles: Actor['roles'], capabilities: Capability[] = []): Actor {
  return { userId: 'u', tenantId: 't', roles, capabilities };
}

describe('isCredentialValidOn', () => {
  it('is valid from the first day to the last day inclusive', () => {
    expect(isCredentialValidOn(sessionCredential, '2026-01-01')).toBe(true);
    expect(isCredentialValidOn(sessionCredential, '2026-12-31')).toBe(true);
  });

  it('is invalid the day before it starts and the day after it expires', () => {
    expect(isCredentialValidOn(sessionCredential, '2025-12-31')).toBe(false);
    expect(isCredentialValidOn(sessionCredential, '2027-01-01')).toBe(false);
  });

  it('treats a credential without an end date as never expiring', () => {
    expect(isCredentialValidOn({ ...sessionCredential, validTo: null }, '2099-01-01')).toBe(true);
  });
});

describe('isoDateIn', () => {
  it('reads the date in the practice time zone, so 23:00 UTC is already tomorrow in Dubai', () => {
    expect(isoDateIn(new Date('2026-09-02T23:00:00Z'), 'Asia/Dubai')).toBe('2026-09-03');
    expect(isoDateIn(new Date('2026-09-02T23:00:00Z'), 'UTC')).toBe('2026-09-02');
  });
});

describe('canActor', () => {
  it('refuses everything to a user with no roles', () => {
    expect(canActor(actor([]), { type: 'client.read', clientId: CLIENT }, {}, NOW)).toBe(false);
    expect(canActor(actor([]), { type: 'audit.read', clientId: CLIENT }, {}, NOW)).toBe(false);
  });

  it('lets the owner and an admin read and write clients and grant roles', () => {
    for (const role of ['owner', 'admin'] as const) {
      const a = actor([role]);
      expect(canActor(a, { type: 'client.read', clientId: CLIENT }, {}, NOW)).toBe(true);
      expect(canActor(a, { type: 'client.write', clientId: CLIENT }, {}, NOW)).toBe(true);
      expect(canActor(a, { type: 'user_role.grant', role: 'finance' }, {}, NOW)).toBe(true);
    }
  });

  it('lets practitioners read clients but never write them or grant roles', () => {
    for (const role of ['lead_practitioner', 'practitioner'] as const) {
      const a = actor([role]);
      expect(canActor(a, { type: 'client.read', clientId: CLIENT }, {}, NOW)).toBe(true);
      expect(canActor(a, { type: 'client.write', clientId: CLIENT }, {}, NOW)).toBe(false);
      expect(canActor(a, { type: 'user_role.grant', role: 'finance' }, {}, NOW)).toBe(false);
    }
  });

  it('lets only the owner hand out ownership', () => {
    expect(canActor(actor(['admin']), { type: 'user_role.grant', role: 'owner' }, {}, NOW)).toBe(
      false,
    );
    expect(canActor(actor(['admin']), { type: 'user_role.grant', role: 'finance' }, {}, NOW)).toBe(
      true,
    );
    expect(canActor(actor(['owner']), { type: 'user_role.grant', role: 'owner' }, {}, NOW)).toBe(
      true,
    );
  });

  it('lets finance read a client but never write one, execute a session or read the audit trail', () => {
    const a = actor(['finance'], [sessionCredential]);
    expect(canActor(a, { type: 'client.read', clientId: CLIENT }, {}, NOW)).toBe(true);
    expect(canActor(a, { type: 'client.write', clientId: CLIENT }, {}, NOW)).toBe(false);
    expect(
      canActor(a, { type: 'session.execute', serviceTypeId: SERVICE, on: '2026-06-01' }, {}, NOW),
    ).toBe(false);
    expect(canActor(a, { type: 'audit.read', clientId: CLIENT }, {}, NOW)).toBe(false);
  });

  it('lets a client contact read only a client in their own household', () => {
    const a = actor(['client_contact']);
    const ctx = { clientIds: [CLIENT] };
    expect(canActor(a, { type: 'client.read', clientId: CLIENT }, ctx, NOW)).toBe(true);
    expect(canActor(a, { type: 'client.read', clientId: OTHER_CLIENT }, ctx, NOW)).toBe(false);
    expect(canActor(a, { type: 'client.read', clientId: CLIENT }, {}, NOW)).toBe(false);
  });

  it('lets a practitioner execute a session only with a credential for that service type valid on the day', () => {
    const a = actor(['practitioner'], [sessionCredential]);
    expect(
      canActor(a, { type: 'session.execute', serviceTypeId: SERVICE, on: '2026-06-01' }, {}, NOW),
    ).toBe(true);
    expect(
      canActor(
        a,
        { type: 'session.execute', serviceTypeId: OTHER_SERVICE, on: '2026-06-01' },
        {},
        NOW,
      ),
    ).toBe(false);
  });

  it('refuses a session the day before the credential starts and the day after it expires', () => {
    const a = actor(['practitioner'], [sessionCredential]);
    expect(
      canActor(a, { type: 'session.execute', serviceTypeId: SERVICE, on: '2025-12-31' }, {}, NOW),
    ).toBe(false);
    expect(
      canActor(a, { type: 'session.execute', serviceTypeId: SERVICE, on: '2027-01-01' }, {}, NOW),
    ).toBe(false);
  });

  it('refuses a credential that does not carry the execute capability', () => {
    const a = actor(['practitioner'], [{ ...sessionCredential, canExecuteSession: false }]);
    expect(
      canActor(a, { type: 'session.execute', serviceTypeId: SERVICE, on: '2026-06-01' }, {}, NOW),
    ).toBe(false);
  });

  it('refuses the owner from executing a session without a credential: role alone never suffices', () => {
    expect(
      canActor(
        actor(['owner']),
        { type: 'session.execute', serviceTypeId: SERVICE, on: '2026-06-01' },
        {},
        NOW,
      ),
    ).toBe(false);
  });

  it('lets a practitioner sign a report only with a signing credential valid today in the practice time zone', () => {
    const signing: Capability = {
      ...sessionCredential,
      canSignReport: true,
      validFrom: '2026-09-03',
      validTo: null,
    };
    const a = actor(['lead_practitioner'], [signing]);
    // 23:00 UTC on the 2nd is already the 3rd in Dubai: valid there, not yet in UTC.
    const lateEvening = new Date('2026-09-02T23:00:00Z');
    expect(canActor(a, { type: 'report.sign' }, {}, lateEvening)).toBe(true);
    expect(canActor(a, { type: 'report.sign' }, { timeZone: 'UTC' }, lateEvening)).toBe(false);
    expect(canActor(a, { type: 'report.sign', serviceTypeId: OTHER_SERVICE }, {}, NOW)).toBe(false);
  });

  it('lets the owner, an admin and the lead practitioner read the audit trail', () => {
    for (const role of ['owner', 'admin', 'lead_practitioner'] as const) {
      expect(canActor(actor([role]), { type: 'audit.read', clientId: CLIENT }, {}, NOW)).toBe(true);
    }
    expect(
      canActor(actor(['practitioner']), { type: 'audit.read', clientId: CLIENT }, {}, NOW),
    ).toBe(false);
  });
});

describe('client.list', () => {
  it('lets every practice role list clients and a client contact never', () => {
    for (const role of [
      'owner',
      'admin',
      'lead_practitioner',
      'practitioner',
      'finance',
    ] as const) {
      expect(canActor(actor([role]), { type: 'client.list' }, {}, NOW)).toBe(true);
    }
    expect(canActor(actor(['client_contact']), { type: 'client.list' }, {}, NOW)).toBe(false);
    expect(canActor(actor([]), { type: 'client.list' }, {}, NOW)).toBe(false);
  });
});

describe('the appointment and price actions', () => {
  const capability = (serviceTypeId: string): Capability => ({
    serviceTypeId,
    canExecuteSession: true,
    canAuthorProtocol: false,
    canSignReport: false,
    validFrom: '2026-01-01',
    validTo: null,
  });
  const practice = { type: 'appointment.list', scope: 'practice' } as const;
  const own = { type: 'appointment.list', scope: 'own' } as const;
  const booking = {
    type: 'appointment.create',
    practitionerId: 'p1',
    serviceTypeId: SERVICE,
    on: '2026-06-01',
  } as const;
  const valid = { assigneeCapabilities: [capability(SERVICE)] };

  it('shows the whole practice to the owner, an admin and the lead practitioner only', () => {
    for (const role of ['owner', 'admin', 'lead_practitioner'] as const) {
      expect(canActor(actor([role]), practice, {}, NOW)).toBe(true);
    }
    for (const role of ['practitioner', 'finance', 'client_contact'] as const) {
      expect(canActor(actor([role]), practice, {}, NOW)).toBe(false);
    }
  });

  it('lets a practitioner see their own day, and nobody outside the practice', () => {
    expect(canActor(actor(['practitioner']), own, {}, NOW)).toBe(true);
    expect(canActor(actor(['owner']), own, {}, NOW)).toBe(true);
    expect(canActor(actor(['finance']), own, {}, NOW)).toBe(false);
    expect(canActor(actor(['client_contact']), own, {}, NOW)).toBe(false);
  });

  it('books only with the booking role and a valid credential for the assignee', () => {
    for (const role of ['owner', 'admin', 'lead_practitioner'] as const) {
      expect(canActor(actor([role]), booking, valid, NOW)).toBe(true);
      expect(canActor(actor([role]), booking, {}, NOW)).toBe(false);
    }
    expect(canActor(actor(['practitioner']), booking, valid, NOW)).toBe(false);
    expect(canActor(actor(['finance']), booking, valid, NOW)).toBe(false);
    const wrongService = { assigneeCapabilities: [capability(OTHER_SERVICE)] };
    expect(canActor(actor(['owner']), booking, wrongService, NOW)).toBe(false);
    const expired = { assigneeCapabilities: [{ ...capability(SERVICE), validTo: '2026-05-31' }] };
    expect(canActor(actor(['owner']), booking, expired, NOW)).toBe(false);
    const cannotExecute = {
      assigneeCapabilities: [{ ...capability(SERVICE), canExecuteSession: false }],
    };
    expect(canActor(actor(['owner']), booking, cannotExecute, NOW)).toBe(false);
  });

  it('shows the price list to finance and the lead practitioner, and lets finance change it', () => {
    const read = { type: 'billing.price.read' } as const;
    const write = { type: 'billing.price.write' } as const;
    expect(canActor(actor(['finance']), read, {}, NOW)).toBe(true);
    expect(canActor(actor(['finance']), write, {}, NOW)).toBe(true);
    expect(canActor(actor(['lead_practitioner']), read, {}, NOW)).toBe(true);
    expect(canActor(actor(['lead_practitioner']), write, {}, NOW)).toBe(false);
    expect(canActor(actor(['practitioner']), read, {}, NOW)).toBe(false);
    expect(canActor(actor(['client_contact']), read, {}, NOW)).toBe(false);
    expect(canActor(actor([]), write, {}, NOW)).toBe(false);
  });
});

describe('moving and cancelling a visit (docs/CHANGE-REQUESTS/scheduling-04.md section 3)', () => {
  /**
   * The change request's own audience table, read straight across. The two
   * actions were composed out of `hasRole` inside the routes until now, which
   * is honest as a stop-gap and wrong as a destination: "may this person move
   * a visit" and "may this person book one" are one audience today and two
   * decisions the first time the practice hires a coordinator who may
   * rearrange the diary but not fill it.
   */
  const AUDIENCE: { role: Role; move: boolean; cancelAny: boolean; cancelOwn: boolean }[] = [
    { role: 'owner', move: true, cancelAny: true, cancelOwn: true },
    { role: 'admin', move: true, cancelAny: true, cancelOwn: true },
    { role: 'finance', move: false, cancelAny: false, cancelOwn: false },
    { role: 'lead_practitioner', move: true, cancelAny: true, cancelOwn: true },
    { role: 'practitioner', move: false, cancelAny: false, cancelOwn: true },
    { role: 'client_contact', move: false, cancelAny: false, cancelOwn: false },
  ];

  it('answers the table for every role, both actions, both senses of "own stop"', () => {
    for (const { role, move, cancelAny, cancelOwn } of AUDIENCE) {
      const who = actor([role]);
      expect(canActor(who, { type: 'appointment.move' }, {}, NOW), `move for ${role}`).toBe(move);
      expect(
        canActor(who, { type: 'appointment.cancel', ownStop: false }, {}, NOW),
        `cancel any for ${role}`,
      ).toBe(cancelAny);
      expect(
        canActor(who, { type: 'appointment.cancel', ownStop: true }, {}, NOW),
        `cancel own for ${role}`,
      ).toBe(cancelOwn);
    }
  });

  it('gives a practitioner the visit at their own door and no other', () => {
    // They are the person who arrives to find the visit cannot go ahead.
    // Whether the stop is theirs is the route's to resolve and pass in, and
    // app.cancel_own_appointment (migration 203) asks it again in the
    // database, which is the answer that binds.
    const practitioner = actor(['practitioner']);
    expect(canActor(practitioner, { type: 'appointment.cancel', ownStop: true }, {}, NOW)).toBe(
      true,
    );
    expect(canActor(practitioner, { type: 'appointment.cancel', ownStop: false }, {}, NOW)).toBe(
      false,
    );
    expect(canActor(practitioner, { type: 'appointment.move' }, {}, NOW)).toBe(false);
  });

  it('refuses an actor with no role at all, own stop or not', () => {
    expect(canActor(actor([]), { type: 'appointment.move' }, {}, NOW)).toBe(false);
    expect(canActor(actor([]), { type: 'appointment.cancel', ownStop: true }, {}, NOW)).toBe(false);
  });
});

describe('the eight billing actions (docs/CHANGE-REQUESTS/billing-03.md section 1)', () => {
  // The floors as the change request states them, and as
  // db/policies/billing/ledger.sql enforces them beneath: the four office
  // roles read the catalogue, the invoice book and a refund quote; three of
  // them record money; and only a balance reaches past the office.
  const floors: { action: Action; allowed: readonly Role[] }[] = [
    { action: { type: 'billing.package.read' }, allowed: OFFICE_READERS },
    { action: { type: 'billing.invoice.read' }, allowed: OFFICE_READERS },
    { action: { type: 'billing.refund.read' }, allowed: OFFICE_READERS },
    { action: { type: 'billing.package.write' }, allowed: MONEY_WRITERS },
    { action: { type: 'billing.sale.write' }, allowed: MONEY_WRITERS },
    { action: { type: 'billing.payment.write' }, allowed: MONEY_WRITERS },
    { action: { type: 'billing.waiver.write' }, allowed: MONEY_WRITERS },
    {
      action: { type: 'billing.balance.read', clientId: CLIENT },
      // A client contact is allowed here only for their own client, which the
      // clientIds context decides; this loop passes none, so they are refused.
      allowed: [...OFFICE_READERS, 'practitioner'],
    },
  ];

  it('answers every role for every action, allow and deny', () => {
    for (const { action, allowed } of floors) {
      for (const role of ROLES) {
        expect(canActor(actor([role]), action, {}, NOW), `${action.type} for ${role}`).toBe(
          allowed.includes(role),
        );
      }
      expect(canActor(actor([]), action, {}, NOW), `${action.type} for no role`).toBe(false);
    }
  });

  it('keeps the lead practitioner reading the money and never recording it', () => {
    const lead = actor(['lead_practitioner']);
    expect(canActor(lead, { type: 'billing.invoice.read' }, {}, NOW)).toBe(true);
    expect(canActor(lead, { type: 'billing.refund.read' }, {}, NOW)).toBe(true);
    expect(canActor(lead, { type: 'billing.package.read' }, {}, NOW)).toBe(true);
    expect(canActor(lead, { type: 'billing.package.write' }, {}, NOW)).toBe(false);
    expect(canActor(lead, { type: 'billing.sale.write' }, {}, NOW)).toBe(false);
    expect(canActor(lead, { type: 'billing.payment.write' }, {}, NOW)).toBe(false);
    expect(canActor(lead, { type: 'billing.waiver.write' }, {}, NOW)).toBe(false);
  });

  it('lets a practitioner ask for a balance and nothing else in billing', () => {
    const a = actor(['practitioner']);
    // The action says only that the role may ask; how far they reach is
    // app.client_visible_to_practitioner's to decide, not this file's.
    expect(canActor(a, { type: 'billing.balance.read', clientId: CLIENT }, {}, NOW)).toBe(true);
    expect(canActor(a, { type: 'billing.balance.read', clientId: OTHER_CLIENT }, {}, NOW)).toBe(
      true,
    );
    expect(canActor(a, { type: 'billing.package.read' }, {}, NOW)).toBe(false);
    expect(canActor(a, { type: 'billing.invoice.read' }, {}, NOW)).toBe(false);
    expect(canActor(a, { type: 'billing.refund.read' }, {}, NOW)).toBe(false);
    expect(canActor(a, { type: 'billing.sale.write' }, {}, NOW)).toBe(false);
  });

  it('keeps the practice’s own identity with the owner and an admin', () => {
    // Who the practice says it is on an invoice: the legal name, the trade
    // licence and the VAT registration (migration 905). Finance records money
    // and does not decide whose name it is taken in.
    const settings = { type: 'practice.settings.write' } as const;
    for (const role of ['owner', 'admin'] as const) {
      expect(canActor(actor([role]), settings, {}, NOW), role).toBe(true);
    }
    for (const role of [
      'lead_practitioner',
      'practitioner',
      'finance',
      'client_contact',
    ] as const) {
      expect(canActor(actor([role]), settings, {}, NOW), role).toBe(false);
    }
    expect(canActor(actor([]), settings, {}, NOW)).toBe(false);
  });

  it('lets a client contact read only the balance of their own client', () => {
    const a = actor(['client_contact']);
    const ctx = { clientIds: [CLIENT] };
    expect(canActor(a, { type: 'billing.balance.read', clientId: CLIENT }, ctx, NOW)).toBe(true);
    expect(canActor(a, { type: 'billing.balance.read', clientId: OTHER_CLIENT }, ctx, NOW)).toBe(
      false,
    );
    expect(canActor(a, { type: 'billing.balance.read', clientId: CLIENT }, {}, NOW)).toBe(false);
    expect(canActor(a, { type: 'billing.invoice.read' }, ctx, NOW)).toBe(false);
    expect(canActor(a, { type: 'billing.payment.write' }, ctx, NOW)).toBe(false);
  });
  it('lets a contact correct their own row and no other', () => {
    // docs/SPEC/client-portal.md section 5, rule 2. The route reads the
    // contact row's user_id; migration 702's guard trigger holds the same
    // rule underneath, and narrows the columns as well.
    const a = actor(['client_contact']);
    expect(canActor(a, { type: 'contact.write_own', contactUserId: a.userId }, {}, NOW)).toBe(true);
    expect(
      canActor(a, { type: 'contact.write_own', contactUserId: 'somebody-else' }, {}, NOW),
    ).toBe(false);
    expect(canActor(a, { type: 'contact.write_own', contactUserId: null }, {}, NOW)).toBe(false);
    for (const role of [
      'owner',
      'admin',
      'lead_practitioner',
      'practitioner',
      'finance',
    ] as const) {
      const staff = actor([role]);
      expect(
        canActor(staff, { type: 'contact.write_own', contactUserId: staff.userId }, {}, NOW),
        role,
      ).toBe(false);
    }
  });

  it('lets a contact ask only for their own household, and never handle the ask', () => {
    const a = actor(['client_contact']);
    const ctx = { clientIds: [CLIENT] };
    expect(canActor(a, { type: 'portal.request.write', clientId: CLIENT }, ctx, NOW)).toBe(true);
    expect(canActor(a, { type: 'portal.request.write', clientId: OTHER_CLIENT }, ctx, NOW)).toBe(
      false,
    );
    expect(canActor(a, { type: 'portal.request.write', clientId: CLIENT }, {}, NOW)).toBe(false);
    expect(canActor(a, { type: 'portal.request.handle' }, ctx, NOW)).toBe(false);
  });

  it('gives handling a request to the office and access to the owner and an admin', () => {
    for (const role of ['owner', 'admin', 'lead_practitioner'] as const) {
      expect(canActor(actor([role]), { type: 'portal.request.handle' }, {}, NOW), role).toBe(true);
    }
    for (const role of ['practitioner', 'finance', 'client_contact'] as const) {
      expect(canActor(actor([role]), { type: 'portal.request.handle' }, {}, NOW), role).toBe(false);
    }
    for (const role of ['owner', 'admin'] as const) {
      expect(canActor(actor([role]), { type: 'portal.access.manage' }, {}, NOW), role).toBe(true);
    }
    for (const role of [
      'lead_practitioner',
      'practitioner',
      'finance',
      'client_contact',
    ] as const) {
      expect(canActor(actor([role]), { type: 'portal.access.manage' }, {}, NOW), role).toBe(false);
    }
    expect(canActor(actor([]), { type: 'portal.access.manage' }, {}, NOW)).toBe(false);
  });
});

describe('the kit register and the day picture', () => {
  it('gives managing the register to the owner, an admin and the lead practitioner', () => {
    for (const role of ['owner', 'admin', 'lead_practitioner'] as const) {
      expect(canActor(actor([role]), { type: 'kit.manage' }, {}, NOW), role).toBe(true);
    }
    for (const role of ['practitioner', 'finance', 'client_contact'] as const) {
      expect(canActor(actor([role]), { type: 'kit.manage' }, {}, NOW), role).toBe(false);
    }
    expect(canActor(actor([]), { type: 'kit.manage' }, {}, NOW)).toBe(false);
  });

  it('gives the whole register to those three and their own items to a practitioner', () => {
    for (const role of ['owner', 'admin', 'lead_practitioner'] as const) {
      expect(
        canActor(actor([role]), { type: 'kit.read', assignedToSelf: false }, {}, NOW),
        role,
      ).toBe(true);
    }
    const practitioner = actor(['practitioner']);
    expect(canActor(practitioner, { type: 'kit.read', assignedToSelf: true }, {}, NOW)).toBe(true);
    expect(canActor(practitioner, { type: 'kit.read', assignedToSelf: false }, {}, NOW)).toBe(
      false,
    );
    for (const role of ['finance', 'client_contact'] as const) {
      expect(
        canActor(actor([role]), { type: 'kit.read', assignedToSelf: true }, {}, NOW),
        role,
      ).toBe(false);
    }
  });

  it('gives a practitioner the drive between their own stops, and finance none of it', () => {
    for (const role of ['owner', 'admin', 'lead_practitioner', 'practitioner'] as const) {
      expect(
        canActor(actor([role]), { type: 'routing.day.read', scope: 'own' }, {}, NOW),
        role,
      ).toBe(true);
    }
    for (const role of ['finance', 'client_contact'] as const) {
      expect(
        canActor(actor([role]), { type: 'routing.day.read', scope: 'own' }, {}, NOW),
        role,
      ).toBe(false);
    }
    expect(canActor(actor([]), { type: 'routing.day.read', scope: 'own' }, {}, NOW)).toBe(false);
  });
});

describe('measurements', () => {
  it('gives reading a measurement to the office and the practitioners, and to nobody else', () => {
    // docs/SPEC/assessment.md section 4: the household sees nothing of a
    // measurement until a report is issued, and finance has demographics and
    // contacts. Both are refused here and refused again by
    // db/policies/assessment/access.sql, which is the answer that binds.
    for (const role of ['owner', 'admin', 'lead_practitioner', 'practitioner'] as const) {
      expect(canActor(actor([role]), { type: 'assessment.read' }, {}, NOW), role).toBe(true);
    }
    for (const role of ['finance', 'client_contact'] as const) {
      expect(canActor(actor([role]), { type: 'assessment.read' }, {}, NOW), role).toBe(false);
    }
    expect(canActor(actor([]), { type: 'assessment.read' }, {}, NOW)).toBe(false);
  });

  it('gives recording one to a practitioner and never to an administrator', () => {
    for (const role of ['practitioner', 'lead_practitioner'] as const) {
      expect(canActor(actor([role]), { type: 'assessment.record' }, {}, NOW), role).toBe(true);
    }
    for (const role of ['owner', 'admin', 'finance', 'client_contact'] as const) {
      expect(canActor(actor([role]), { type: 'assessment.record' }, {}, NOW), role).toBe(false);
    }
  });

  it('gives filing an export to the reading audience, an admin included', () => {
    for (const role of ['owner', 'admin', 'lead_practitioner', 'practitioner'] as const) {
      expect(canActor(actor([role]), { type: 'assessment.file' }, {}, NOW), role).toBe(true);
    }
    for (const role of ['finance', 'client_contact'] as const) {
      expect(canActor(actor([role]), { type: 'assessment.file' }, {}, NOW), role).toBe(false);
    }
  });
});
