import { describe, expect, it } from 'vitest';
import type { Actor, Capability } from '@domain/shared';
import {
  EARLIEST_PAST_SESSION_ON,
  canRecordPastSession,
  pastSessionDateProblem,
  pastSessionTimes,
  type PastSessionInput,
} from './pastSession';

const NOW = new Date('2026-09-16T10:00:00.000Z');
const SERVICE = '00000004-0000-4000-8000-000000000001';
const OTHER_SERVICE = '00000004-0000-4000-8000-000000000002';
const PRACTITIONER = '00000005-0000-4000-8000-000000000001';

function credential(overrides: Partial<Capability> = {}): Capability {
  return {
    serviceTypeId: SERVICE,
    canExecuteSession: true,
    canAuthorProtocol: false,
    canSignReport: false,
    validFrom: '2024-01-01',
    validTo: '2027-01-01',
    ...overrides,
  };
}

function actor(roles: Actor['roles']): Actor {
  return {
    userId: '00000002-0000-4000-8000-000000000010',
    tenantId: '00000001-0000-4000-8000-000000000001',
    roles,
    capabilities: [],
  };
}

function input(overrides: Partial<PastSessionInput> = {}): PastSessionInput {
  return {
    actor: actor(['admin']),
    practitionerId: PRACTITIONER,
    practitionerCapabilities: [credential()],
    serviceTypeId: SERVICE,
    on: '2026-03-04',
    deliveryMode: 'home',
    hasDateOfBirth: true,
    isMinor: false,
    activeConsentPurposes: ['participation', 'home_visit', 'health_data'],
    ...overrides,
  };
}

describe('pastSessionDateProblem', () => {
  it('allows any day from the practice opening up to today', () => {
    expect(pastSessionDateProblem('2026-09-16', '2026-09-16')).toBeNull();
    expect(pastSessionDateProblem('2026-03-04', '2026-09-16')).toBeNull();
    expect(pastSessionDateProblem(EARLIEST_PAST_SESSION_ON, '2026-09-16')).toBeNull();
  });

  it('refuses tomorrow: a visit cannot have happened yet', () => {
    expect(pastSessionDateProblem('2026-09-17', '2026-09-16')).toBe('in_the_future');
  });

  it('refuses a day before the practice existed, which is a mistyped year', () => {
    expect(pastSessionDateProblem('2023-12-31', '2026-09-16')).toBe('too_old');
  });

  it('refuses a day the calendar does not have, before comparing it with anything', () => {
    expect(pastSessionDateProblem('2026-02-31', '2026-09-16')).toBe('not_a_day');
    expect(pastSessionDateProblem('2025-13-01', '2026-09-16')).toBe('not_a_day');
    expect(pastSessionDateProblem('2024-02-29', '2026-09-16')).toBeNull();
  });
});

describe('pastSessionTimes', () => {
  it("turns a day, a clock time and a length into the visit's two instants in the practice's zone", () => {
    expect(pastSessionTimes({ on: '2026-03-04', startTime: '15:30', durationMinutes: 60 })).toEqual(
      { startsAt: '2026-03-04T11:30:00.000Z', endsAt: '2026-03-04T12:30:00.000Z' },
    );
  });

  it('refuses to make instants out of a day that does not exist', () => {
    expect(() =>
      pastSessionTimes({ on: '2025-13-01', startTime: '10:00', durationMinutes: 60 }),
    ).toThrow(RangeError);
  });

  it('lets a late visit run past midnight without losing the day it started on', () => {
    expect(pastSessionTimes({ on: '2026-03-04', startTime: '23:30', durationMinutes: 45 })).toEqual(
      { startsAt: '2026-03-04T19:30:00.000Z', endsAt: '2026-03-04T20:15:00.000Z' },
    );
  });
});

describe('canRecordPastSession', () => {
  it('lets the owner, an admin and the lead practitioner log a visit for a credentialed practitioner', () => {
    for (const role of ['owner', 'admin', 'lead_practitioner'] as const) {
      expect(canRecordPastSession(input({ actor: actor([role]) }), NOW)).toEqual({
        ok: true,
        reasons: [],
      });
    }
  });

  it('refuses a practitioner and finance the office action', () => {
    for (const role of ['practitioner', 'finance', 'client_contact'] as const) {
      expect(canRecordPastSession(input({ actor: actor([role]) }), NOW).reasons).toEqual([
        'not_authorised',
      ]);
    }
  });

  it("judges the practitioner's credential on the visit's own date, not today", () => {
    // Certified from June: a visit in March is refused, one in July allowed.
    const later = [credential({ validFrom: '2026-06-01' })];
    expect(
      canRecordPastSession(input({ practitionerCapabilities: later, on: '2026-03-04' }), NOW)
        .reasons,
    ).toEqual(['not_authorised']);
    expect(
      canRecordPastSession(input({ practitionerCapabilities: later, on: '2026-07-04' }), NOW).ok,
    ).toBe(true);
    // A credential that has since lapsed still covers a visit inside its dates.
    const lapsed = [credential({ validTo: '2026-08-01' })];
    expect(canRecordPastSession(input({ practitionerCapabilities: lapsed }), NOW).ok).toBe(true);
  });

  it('refuses a practitioner with no credential for that service', () => {
    const other = [credential({ serviceTypeId: OTHER_SERVICE })];
    expect(canRecordPastSession(input({ practitionerCapabilities: other }), NOW).reasons).toEqual([
      'not_authorised',
    ]);
  });

  it('requires participation and health-data consent for every visit, active now', () => {
    expect(
      canRecordPastSession(input({ activeConsentPurposes: ['home_visit'] }), NOW).reasons,
    ).toEqual(['consent_missing_participation', 'consent_missing_health_data']);
  });

  it('requires home-visit consent for a home visit and not for a studio one', () => {
    const without = ['participation', 'health_data'] as const;
    expect(
      canRecordPastSession(input({ activeConsentPurposes: without, deliveryMode: 'home' }), NOW)
        .reasons,
    ).toEqual(['consent_missing_home_visit']);
    expect(
      canRecordPastSession(input({ activeConsentPurposes: without, deliveryMode: 'studio' }), NOW)
        .ok,
    ).toBe(true);
  });

  it("requires a guardian's consent for a minor, and blocks a client with no date of birth", () => {
    expect(canRecordPastSession(input({ isMinor: true }), NOW).reasons).toEqual([
      'consent_missing_minor_participation',
    ]);
    expect(
      canRecordPastSession(
        input({
          isMinor: true,
          activeConsentPurposes: [
            'participation',
            'minor_participation',
            'home_visit',
            'health_data',
          ],
        }),
        NOW,
      ).ok,
    ).toBe(true);
    expect(canRecordPastSession(input({ hasDateOfBirth: false }), NOW).reasons).toEqual([
      'date_of_birth_unknown',
    ]);
  });
});
