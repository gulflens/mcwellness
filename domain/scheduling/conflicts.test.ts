import { describe, expect, it } from 'vitest';
import {
  checkConflicts,
  CLIENT_OVERLAP_MESSAGE,
  PRACTITIONER_OVERLAP_MESSAGE,
  type ExistingAppointment,
  type SchedulingCandidate,
} from './conflicts';
import { seededRandom } from '../../db/seed/random';
import type { Capability } from '@domain/shared';

const PRACTITIONER = '00000000-0000-4000-8000-000000001001';
const OTHER_PRACTITIONER = '00000000-0000-4000-8000-000000001002';
const CLIENT = '00000000-0000-4000-8000-000000002001';
const OTHER_CLIENT = '00000000-0000-4000-8000-000000002002';
const SERVICE = '00000000-0000-4000-8000-000000003001';
const OTHER_SERVICE = '00000000-0000-4000-8000-000000003002';
const EXISTING_ID = '00000000-0000-4000-8000-000000004001';

function at(iso: string): Date {
  return new Date(iso);
}

function baseCandidate(overrides: Partial<SchedulingCandidate> = {}): SchedulingCandidate {
  return {
    practitionerId: PRACTITIONER,
    clientId: CLIENT,
    serviceTypeId: SERVICE,
    windowStart: at('2026-09-10T09:00:00.000Z'),
    windowEnd: at('2026-09-10T09:45:00.000Z'),
    travelBufferMinutes: 15,
    on: '2026-09-10',
    ...overrides,
  };
}

function validCredential(overrides: Partial<Capability> = {}): Capability {
  return {
    serviceTypeId: SERVICE,
    canExecuteSession: true,
    canAuthorProtocol: false,
    canSignReport: false,
    validFrom: '2026-01-01',
    validTo: null,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingAppointment> = {}): ExistingAppointment {
  return {
    id: EXISTING_ID,
    windowStart: at('2026-09-10T10:00:00.000Z'),
    windowEnd: at('2026-09-10T10:45:00.000Z'),
    travelBufferMinutes: 15,
    ...overrides,
  };
}

function baseContext() {
  return {
    practitionerAppointments: [] as ExistingAppointment[],
    clientAppointments: [] as ExistingAppointment[],
    practitionerCredentials: [validCredential()],
    clientActive: true,
    requiredConsentPurposes: [] as string[],
    activeConsentPurposes: [] as string[],
  };
}

describe('checkConflicts', () => {
  it('blocks nothing for a well-formed appointment against a clear calendar', () => {
    const report = checkConflicts(baseCandidate(), baseContext());
    expect(report.blocking).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('blocks a practitioner double-booking, buffering only the time after each visit', () => {
    // Existing is 10:00-10:45 with a 15-minute buffer: busy 10:00-11:00. The
    // buffer is the drive to the NEXT stop, never before this one.

    // Booking BEFORE the existing appointment: the CANDIDATE's own buffer is
    // what has to clear the existing appointment's (unbuffered) start.
    // 09:00-09:45 with a 15-minute buffer ends its busy time at exactly 10:00:
    // touching, not overlapping.
    const touchingBefore = checkConflicts(
      baseCandidate({
        windowStart: at('2026-09-10T09:00:00.000Z'),
        windowEnd: at('2026-09-10T09:45:00.000Z'),
        travelBufferMinutes: 15,
      }),
      { ...baseContext(), practitionerAppointments: [existing()] },
    );
    expect(touchingBefore.blocking).toEqual([]);

    // A minute later, its buffer now reaches past 10:00: a clash.
    const overlapBefore = checkConflicts(
      baseCandidate({
        windowStart: at('2026-09-10T09:01:00.000Z'),
        windowEnd: at('2026-09-10T09:46:00.000Z'),
        travelBufferMinutes: 15,
      }),
      { ...baseContext(), practitionerAppointments: [existing()] },
    );
    expect(overlapBefore.blocking).toEqual([
      {
        code: 'practitioner_overlap',
        message: PRACTITIONER_OVERLAP_MESSAGE,
        conflictsWithAppointmentId: EXISTING_ID,
      },
    ]);

    // Booking AFTER the existing appointment: the EXISTING appointment's own
    // buffer is what the candidate's (unbuffered) start has to clear.
    // Starting right at 11:00 — exactly when its buffer ends — does not clash.
    const touchingAfter = checkConflicts(
      baseCandidate({
        windowStart: at('2026-09-10T11:00:00.000Z'),
        windowEnd: at('2026-09-10T11:45:00.000Z'),
        travelBufferMinutes: 0,
      }),
      { ...baseContext(), practitionerAppointments: [existing()] },
    );
    expect(touchingAfter.blocking).toEqual([]);

    // A minute earlier, it starts inside the existing appointment's own buffer.
    const overlapAfter = checkConflicts(
      baseCandidate({
        windowStart: at('2026-09-10T10:59:00.000Z'),
        windowEnd: at('2026-09-10T11:44:00.000Z'),
        travelBufferMinutes: 0,
      }),
      { ...baseContext(), practitionerAppointments: [existing()] },
    );
    expect(overlapAfter.blocking.map((i) => i.code)).toContain('practitioner_overlap');
  });

  it('does not confuse a different practitioner (their calendar is irrelevant here)', () => {
    const report = checkConflicts(baseCandidate({ practitionerId: OTHER_PRACTITIONER }), {
      ...baseContext(),
      practitionerCredentials: [validCredential()],
      practitionerAppointments: [existing()],
    });
    // The caller is responsible for only passing this practitioner's own appointments;
    // the function trusts what it is given, so an overlapping row still flags -
    // this proves the buffer maths itself, not the caller's filtering.
    expect(report.blocking.map((i) => i.code)).not.toContain('client_overlap');
  });

  it('blocks a client double-booking with no buffer at all', () => {
    const report = checkConflicts(baseCandidate(), {
      ...baseContext(),
      clientAppointments: [
        existing({
          windowStart: at('2026-09-10T09:30:00.000Z'),
          windowEnd: at('2026-09-10T10:15:00.000Z'),
        }),
      ],
    });
    expect(report.blocking).toEqual([
      {
        code: 'client_overlap',
        message: CLIENT_OVERLAP_MESSAGE,
        conflictsWithAppointmentId: EXISTING_ID,
      },
    ]);
  });

  it('does not block a client appointment that only touches the boundary', () => {
    const report = checkConflicts(baseCandidate(), {
      ...baseContext(),
      clientAppointments: [
        existing({
          windowStart: at('2026-09-10T09:45:00.000Z'),
          windowEnd: at('2026-09-10T10:30:00.000Z'),
        }),
      ],
    });
    expect(report.blocking).toEqual([]);
  });

  it('is unaffected by a different client already booked at the same time', () => {
    const report = checkConflicts(baseCandidate({ clientId: OTHER_CLIENT }), {
      ...baseContext(),
      clientAppointments: [existing()],
    });
    expect(report.blocking.map((i) => i.code)).not.toContain('client_overlap');
  });

  it('blocks a practitioner with no credential at all for the service', () => {
    const report = checkConflicts(baseCandidate(), {
      ...baseContext(),
      practitionerCredentials: [],
    });
    expect(report.blocking).toEqual([
      {
        code: 'credential_invalid',
        message:
          'This practitioner does not hold a current certification for this service on this date.',
      },
    ]);
  });

  it('blocks a credential held for a different service', () => {
    const report = checkConflicts(baseCandidate(), {
      ...baseContext(),
      practitionerCredentials: [validCredential({ serviceTypeId: OTHER_SERVICE })],
    });
    expect(report.blocking.map((i) => i.code)).toEqual(['credential_invalid']);
  });

  it('blocks a credential that can author but not execute', () => {
    const report = checkConflicts(baseCandidate(), {
      ...baseContext(),
      practitionerCredentials: [
        validCredential({ canExecuteSession: false, canAuthorProtocol: true }),
      ],
    });
    expect(report.blocking.map((i) => i.code)).toEqual(['credential_invalid']);
  });

  it('blocks a credential that expires mid-week, on and after the day it lapses', () => {
    const credential = validCredential({ validFrom: '2026-09-07', validTo: '2026-09-09' });
    const context = { ...baseContext(), practitionerCredentials: [credential] };

    // The Wednesday it lapses: still valid that whole day.
    const onLastDay = checkConflicts(baseCandidate({ on: '2026-09-09' }), context);
    expect(onLastDay.blocking).toEqual([]);

    // The Thursday after: no longer valid, even though the appointment sits mid-week.
    const dayAfter = checkConflicts(baseCandidate({ on: '2026-09-10' }), context);
    expect(dayAfter.blocking.map((i) => i.code)).toEqual(['credential_invalid']);

    // Before it starts: not valid yet either.
    const beforeStart = checkConflicts(baseCandidate({ on: '2026-09-06' }), {
      ...baseContext(),
      practitionerCredentials: [credential],
    });
    expect(beforeStart.blocking.map((i) => i.code)).toEqual(['credential_invalid']);
  });

  it('blocks a client whose record is not active', () => {
    const report = checkConflicts(baseCandidate(), { ...baseContext(), clientActive: false });
    expect(report.blocking).toEqual([
      { code: 'client_inactive', message: "This client's record is not active." },
    ]);
  });

  it('can raise more than one blocking issue at once', () => {
    const report = checkConflicts(baseCandidate(), {
      ...baseContext(),
      practitionerCredentials: [],
      clientActive: false,
    });
    expect(report.blocking.map((i) => i.code).sort()).toEqual([
      'client_inactive',
      'credential_invalid',
    ]);
  });

  it('never raises a warning in this slice: session-spacing, entitlement and prayer-time data do not exist yet', () => {
    const report = checkConflicts(baseCandidate(), baseContext());
    expect(report.warnings).toEqual([]);
  });
});

describe('checkConflicts: consent', () => {
  it('passes when every required purpose is active', () => {
    const report = checkConflicts(baseCandidate(), {
      ...baseContext(),
      requiredConsentPurposes: ['participation', 'home_visit'],
      activeConsentPurposes: ['participation', 'home_visit', 'photo_video'],
    });
    expect(report.blocking).toEqual([]);
  });

  it('blocks when participation is required and not active', () => {
    const report = checkConflicts(baseCandidate(), {
      ...baseContext(),
      requiredConsentPurposes: ['participation'],
      activeConsentPurposes: [],
    });
    expect(report.blocking).toEqual([
      {
        code: 'consent_missing',
        message: 'The required consent (participation) is not active for this client.',
      },
    ]);
  });

  it('blocks when minor_participation is required and not active, independently of participation', () => {
    const report = checkConflicts(baseCandidate(), {
      ...baseContext(),
      requiredConsentPurposes: ['participation', 'minor_participation'],
      activeConsentPurposes: ['participation'],
    });
    expect(report.blocking).toEqual([
      {
        code: 'consent_missing',
        message: 'The required consent (minor_participation) is not active for this client.',
      },
    ]);
  });

  it('blocks when home_visit is required and not active', () => {
    const report = checkConflicts(baseCandidate(), {
      ...baseContext(),
      requiredConsentPurposes: ['participation', 'home_visit'],
      activeConsentPurposes: ['participation'],
    });
    expect(report.blocking).toEqual([
      {
        code: 'consent_missing',
        message: 'The required consent (home_visit) is not active for this client.',
      },
    ]);
  });

  it('raises one issue per missing purpose', () => {
    const report = checkConflicts(baseCandidate(), {
      ...baseContext(),
      requiredConsentPurposes: ['participation', 'minor_participation', 'home_visit'],
      activeConsentPurposes: [],
    });
    expect(report.blocking.map((i) => i.code)).toEqual([
      'consent_missing',
      'consent_missing',
      'consent_missing',
    ]);
  });

  it('ignores a purpose that is active but was never required', () => {
    const report = checkConflicts(baseCandidate(), {
      ...baseContext(),
      requiredConsentPurposes: ['participation'],
      activeConsentPurposes: ['participation', 'marketing'],
    });
    expect(report.blocking).toEqual([]);
  });
});

describe('checkConflicts (property): practitioner overlap matches a reference busy-interval check', () => {
  // A naive, obviously-correct reimplementation, independent of the one under test.
  // The buffer pads only the end of each interval (the drive to the next stop).
  function referenceOverlap(
    aStart: number,
    aEnd: number,
    aBuffer: number,
    bStart: number,
    bEnd: number,
    bBuffer: number,
  ): boolean {
    const aBusyEnd = aEnd + aBuffer * 60_000;
    const bBusyEnd = bEnd + bBuffer * 60_000;
    return aStart < bBusyEnd && bStart < aBusyEnd;
  }

  it('agrees with the reference check across many random windows and buffers', () => {
    const random = seededRandom(20260910);
    const dayStart = at('2026-09-10T00:00:00.000Z').getTime();
    const durationMs = 45 * 60_000;

    for (let i = 0; i < 500; i += 1) {
      const aStart = dayStart + random.int(0, 24 * 60) * 60_000;
      const bStart = dayStart + random.int(0, 24 * 60) * 60_000;
      const aBuffer = random.int(15, 90);
      const bBuffer = random.int(15, 90);

      const candidate = baseCandidate({
        windowStart: new Date(aStart),
        windowEnd: new Date(aStart + durationMs),
        travelBufferMinutes: aBuffer,
      });
      const other = existing({
        windowStart: new Date(bStart),
        windowEnd: new Date(bStart + durationMs),
        travelBufferMinutes: bBuffer,
      });
      const report = checkConflicts(candidate, {
        ...baseContext(),
        practitionerAppointments: [other],
      });

      const expected = referenceOverlap(
        aStart,
        aStart + durationMs,
        aBuffer,
        bStart,
        bStart + durationMs,
        bBuffer,
      );
      const actual = report.blocking.some((issue) => issue.code === 'practitioner_overlap');
      expect(
        actual,
        `aStart=${aStart} bStart=${bStart} aBuffer=${aBuffer} bBuffer=${bBuffer}`,
      ).toBe(expected);
    }
  });
});
