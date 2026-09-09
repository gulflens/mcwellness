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
    hasDateOfBirth: true,
    isMinor: false,
    activeConsentPurposes: ['health_data', 'participation', 'home_visit'],
    kitCalibrationOverdue: false,
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
    const result = canCheckIn(input({ activeConsentPurposes: ['health_data', 'home_visit'] }), NOW);
    expect(result.reasons).toEqual(['consent_missing_participation']);
  });

  it('blocks a household that has withdrawn its health-data consent', () => {
    // Checked here and not only at activation. A household may withdraw the
    // day after they are activated, and the page they signed says plainly
    // that sessions cannot continue if they do — there would be nothing to
    // train on (docs/CONSENT/health-data.en.md). Activation is a status, not
    // a standing permission, and reading it as one would be the cached "has
    // consent" boolean .claude/rules/compliance.md forbids.
    const result = canCheckIn(
      input({ activeConsentPurposes: ['participation', 'home_visit'] }),
      NOW,
    );
    expect(result.reasons).toEqual(['consent_missing_health_data']);
  });

  it('blocks a minor without minor_participation consent', () => {
    const result = canCheckIn(
      input({
        isMinor: true,
        activeConsentPurposes: ['health_data', 'participation', 'home_visit'],
      }),
      NOW,
    );
    expect(result.reasons).toEqual(['consent_missing_minor_participation']);
  });

  it('allows a minor once minor_participation consent is active', () => {
    const result = canCheckIn(
      input({
        isMinor: true,
        activeConsentPurposes: [
          'health_data',
          'participation',
          'minor_participation',
          'home_visit',
        ],
      }),
      NOW,
    );
    expect(result).toEqual({ ok: true, reasons: [] });
  });

  it('never asks for minor_participation consent when isMinor is false', () => {
    // Whether a client turning 18 today counts as an adult is now
    // app.checkin_context's own age arithmetic
    // (db/migrations/301_checkin_context.sql, judged in the practice's zone)
    // — canCheckIn only ever acts on the isMinor boolean it is handed, and
    // this proves it never re-derives an age of its own to second-guess it.
    const result = canCheckIn(
      input({
        isMinor: false,
        activeConsentPurposes: ['health_data', 'participation', 'home_visit'],
      }),
      NOW,
    );
    expect(result).toEqual({ ok: true, reasons: [] });
  });

  it('blocks a home visit without home_visit consent', () => {
    const result = canCheckIn(
      input({ activeConsentPurposes: ['health_data', 'participation'] }),
      NOW,
    );
    expect(result.reasons).toEqual(['consent_missing_home_visit']);
  });

  it('does not require home_visit consent away from a home visit', () => {
    const result = canCheckIn(
      input({ deliveryMode: 'studio', activeConsentPurposes: ['health_data', 'participation'] }),
      NOW,
    );
    expect(result).toEqual({ ok: true, reasons: [] });
  });

  it('fails closed when the date of birth is unknown', () => {
    const result = canCheckIn(input({ hasDateOfBirth: false, isMinor: false }), NOW);
    expect(result.reasons).toEqual(['date_of_birth_unknown']);
  });

  it('fails closed on a missing date of birth even if isMinor were somehow true', () => {
    // hasDateOfBirth false must win outright: isMinor is meaningless without
    // a date of birth on file, and the gate must never read it in that case.
    const result = canCheckIn(input({ hasDateOfBirth: false, isMinor: true }), NOW);
    expect(result.reasons).toEqual(['date_of_birth_unknown']);
  });

  it('reports every applicable reason at once, not just the first', () => {
    const result = canCheckIn(
      input({
        actor: actor({ roles: ['client_contact'] }),
        hasDateOfBirth: false,
        activeConsentPurposes: [],
      }),
      NOW,
    );
    expect(result.ok).toBe(false);
    expect([...result.reasons].sort()).toEqual(
      [
        'not_authorised',
        'consent_missing_health_data',
        'consent_missing_participation',
        'date_of_birth_unknown',
        'consent_missing_home_visit',
      ].sort(),
    );
  });
});

describe('canCheckIn and the equipment register', () => {
  it('blocks when an amplifier assigned to this practitioner is overdue', () => {
    const result = canCheckIn(input({ kitCalibrationOverdue: true }), NOW);
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(['kit_calibration_overdue']);
  });

  it('passes when nothing is assigned, which is what the register starts as', () => {
    expect(canCheckIn(input({ kitCalibrationOverdue: false }), NOW)).toEqual({
      ok: true,
      reasons: [],
    });
  });

  it('names the calibration last, after the consents', () => {
    const result = canCheckIn(
      input({ activeConsentPurposes: [], kitCalibrationOverdue: true }),
      NOW,
    );
    expect(result.reasons).toEqual([
      'consent_missing_participation',
      'consent_missing_home_visit',
      'consent_missing_health_data',
      'kit_calibration_overdue',
    ]);
  });
  it('refuses a visit the household was never told about, and admits a confirmed or an open one', () => {
    // The operator's decision of 10 September 2026 (decision 5 of
    // docs/OPERATOR/2026-09-10-decisions.md): a practitioner at the door of a
    // household that was never told is a failure to surface, not a session to
    // run. The gate is told the visit's status by the route, which resolves
    // the visit; no visit known is the route's own refusal, not this gate's.
    expect(canCheckIn(input({ visitStatus: 'proposed' }), NOW)).toEqual({
      ok: false,
      reasons: ['visit_not_confirmed'],
    });
    expect(canCheckIn(input({ visitStatus: 'confirmed' }), NOW).ok).toBe(true);
    expect(canCheckIn(input({ visitStatus: 'checked_in' }), NOW).ok).toBe(true);
    expect(canCheckIn(input(), NOW).ok).toBe(true);
  });
});
