import { describe, expect, it } from 'vitest';
import type { Actor, Capability } from '@domain/shared';
import { canCheckIn, type CheckInInput } from './canCheckIn';

const SERVICE_TYPE = '00000000-0000-4000-8000-0000000000f1';
// 2026-09-02T10:00:00Z is 2026-09-02 14:00 in Asia/Dubai.
const NOW = new Date('2026-09-02T10:00:00.000Z');

function capability(overrides: Partial<Capability> = {}): Capability {
  return {
    serviceTypeId: SERVICE_TYPE,
    canExecuteSession: true,
    canAuthorProtocol: false,
    canSignReport: false,
    validFrom: '2020-01-01',
    validTo: null,
    ...overrides,
  };
}

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: '00000000-0000-4000-8000-0000000000a2',
    tenantId: '00000000-0000-4000-8000-00000000000a',
    roles: ['practitioner'],
    capabilities: [capability()],
    ...overrides,
  };
}

function input(overrides: Partial<CheckInInput> = {}): CheckInInput {
  return {
    actor: actor(),
    serviceTypeId: SERVICE_TYPE,
    deliveryMode: 'home',
    clientDateOfBirth: '1990-01-01',
    activeConsentPurposes: ['participation', 'home_visit'],
    ...overrides,
  };
}

describe('canCheckIn', () => {
  it('allows an adult home visit with active consent and a valid credential', () => {
    expect(canCheckIn(input(), NOW)).toEqual({ ok: true, reasons: [] });
  });

  it('blocks a role that may never execute a session', () => {
    const result = canCheckIn(input({ actor: actor({ roles: ['client_contact'] }) }), NOW);
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(['not_authorised']);
  });

  it('blocks an expired credential', () => {
    const expired = actor({ capabilities: [capability({ validTo: '2020-01-01' })] });
    expect(canCheckIn(input({ actor: expired }), NOW).reasons).toContain('not_authorised');
  });

  it('blocks a credential that does not cover this service type', () => {
    const other = actor({ capabilities: [capability({ serviceTypeId: 'a-different-service' })] });
    expect(canCheckIn(input({ actor: other }), NOW).reasons).toContain('not_authorised');
  });

  it('blocks a credential that cannot execute a session', () => {
    const notExecuting = actor({ capabilities: [capability({ canExecuteSession: false })] });
    expect(canCheckIn(input({ actor: notExecuting }), NOW).reasons).toContain('not_authorised');
  });

  it('blocks missing participation consent', () => {
    const result = canCheckIn(input({ activeConsentPurposes: ['home_visit'] }), NOW);
    expect(result.reasons).toEqual(['consent_missing_participation']);
  });

  it('blocks a minor without minor_participation consent', () => {
    const result = canCheckIn(
      input({
        clientDateOfBirth: '2015-01-01',
        activeConsentPurposes: ['participation', 'home_visit'],
      }),
      NOW,
    );
    expect(result.reasons).toEqual(['consent_missing_minor_participation']);
  });

  it('allows a minor once minor_participation consent is active', () => {
    const result = canCheckIn(
      input({
        clientDateOfBirth: '2015-01-01',
        activeConsentPurposes: ['participation', 'minor_participation', 'home_visit'],
      }),
      NOW,
    );
    expect(result).toEqual({ ok: true, reasons: [] });
  });

  it('treats a client turning 18 today as an adult, not a minor', () => {
    const result = canCheckIn(
      input({
        clientDateOfBirth: '2008-09-02',
        activeConsentPurposes: ['participation', 'home_visit'],
      }),
      NOW,
    );
    expect(result).toEqual({ ok: true, reasons: [] });
  });

  it('blocks a home visit without home_visit consent', () => {
    const result = canCheckIn(input({ activeConsentPurposes: ['participation'] }), NOW);
    expect(result.reasons).toEqual(['consent_missing_home_visit']);
  });

  it('does not require home_visit consent away from a home visit', () => {
    const result = canCheckIn(
      input({ deliveryMode: 'studio', activeConsentPurposes: ['participation'] }),
      NOW,
    );
    expect(result).toEqual({ ok: true, reasons: [] });
  });

  it('fails closed when the date of birth is unknown', () => {
    const result = canCheckIn(input({ clientDateOfBirth: null }), NOW);
    expect(result.reasons).toEqual(['date_of_birth_unknown']);
  });

  it('reports every applicable reason at once, not just the first', () => {
    const result = canCheckIn(
      input({
        actor: actor({ roles: ['client_contact'] }),
        clientDateOfBirth: null,
        activeConsentPurposes: [],
      }),
      NOW,
    );
    expect(result.ok).toBe(false);
    expect([...result.reasons].sort()).toEqual(
      [
        'not_authorised',
        'consent_missing_participation',
        'date_of_birth_unknown',
        'consent_missing_home_visit',
      ].sort(),
    );
  });
});
