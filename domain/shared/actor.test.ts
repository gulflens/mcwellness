import { describe, expect, it } from 'vitest';
import { canActor, isCredentialValidOn, isoDateIn, type Actor, type Capability } from './actor';

const SERVICE = '00000000-0000-4000-8000-0000000000f1';
const OTHER_SERVICE = '00000000-0000-4000-8000-0000000000f2';
const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const OTHER_CLIENT = '00000000-0000-4000-8000-0000000000c2';
const NOW = new Date('2026-09-02T08:00:00Z');

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
