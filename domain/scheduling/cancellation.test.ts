import { describe, expect, it } from 'vitest';
import {
  ALWAYS_LATE_REASONS,
  CANCELLATION_REASONS,
  DEFAULT_NOTICE_HOURS,
  NEVER_LATE_REASONS,
  cancellationStatusFor,
  isLateCancellation,
  reasonCanBeGivenAt,
} from './cancellation';

/**
 * The notice rule (docs/SPEC/scheduling-manual.md section 6.4,
 * docs/SPEC/billing.md section 4.3, and the operator's decision of
 * 2026-09-03: twenty-four hours). Every figure here is an argument: the
 * function reads no clock and no setting of its own.
 */

const WINDOW_START = new Date('2026-09-10T06:00:00Z'); // 10:00 in Dubai
const visit = { windowStart: WINDOW_START };

/** `hours` before the window opens. */
function noticeOf(hours: number): Date {
  return new Date(WINDOW_START.getTime() - hours * 3_600_000);
}

describe('isLateCancellation', () => {
  it('is late at twenty-three hours, with the practice on twenty-four', () => {
    expect(isLateCancellation(visit, noticeOf(23), 24)).toBe(true);
  });

  it('is in time at twenty-five hours, with the practice on twenty-four', () => {
    expect(isLateCancellation(visit, noticeOf(25), 24)).toBe(false);
  });

  it('counts exactly the notice period as in time, not as late', () => {
    // "Under 24 hours consumes the entitlement" (billing.md section 4.3): the
    // boundary itself is the last moment a family may call off for nothing.
    expect(isLateCancellation(visit, noticeOf(24), 24)).toBe(false);
    // One millisecond later is inside it.
    expect(isLateCancellation(visit, new Date(noticeOf(24).getTime() + 1), 24)).toBe(true);
  });

  it("reads the practice's own notice period, not a constant", () => {
    // The same twenty-three hours' notice, judged by three practices.
    expect(isLateCancellation(visit, noticeOf(23), 12)).toBe(false);
    expect(isLateCancellation(visit, noticeOf(23), 24)).toBe(true);
    expect(isLateCancellation(visit, noticeOf(23), 48)).toBe(true);
  });

  it('defaults to the twenty-four hours the practice starts with', () => {
    expect(DEFAULT_NOTICE_HOURS).toBe(24);
    expect(isLateCancellation(visit, noticeOf(23))).toBe(true);
    expect(isLateCancellation(visit, noticeOf(25))).toBe(false);
  });

  it('is late when the window has already opened', () => {
    const duringTheVisit = new Date(WINDOW_START.getTime() + 10 * 60_000);
    expect(isLateCancellation(visit, duringTheVisit, 24)).toBe(true);
  });

  it('is never late when the practice keeps no notice period at all', () => {
    expect(isLateCancellation(visit, noticeOf(0.5), 0)).toBe(false);
    // Even then, the window having opened is still late: the notice is negative.
    expect(isLateCancellation(visit, new Date(WINDOW_START.getTime() + 1), 0)).toBe(true);
  });
});

describe('cancellationStatusFor', () => {
  it('takes the credit from a visit called off inside the notice period', () => {
    expect(cancellationStatusFor(visit, 'client_request', noticeOf(23), 24)).toBe('cancelled_late');
  });

  it('takes nothing from a visit called off in time', () => {
    expect(cancellationStatusFor(visit, 'client_request', noticeOf(25), 24)).toBe('cancelled');
  });

  it('takes the credit when the practitioner arrived and the visit could not go ahead', () => {
    // A month's notice on the calendar, and none at all at the door.
    expect(cancellationStatusFor(visit, 'unfit_to_attend', noticeOf(720), 24)).toBe(
      'cancelled_late',
    );
  });

  it('takes nothing from a visit cancelled because a consent was withdrawn', () => {
    // Even standing inside the notice period: withdrawing a consent is a right,
    // and charging for the visits it cancels would be a penalty on using it.
    expect(cancellationStatusFor(visit, 'consent_withdrawn', noticeOf(1), 24)).toBe('cancelled');
  });

  it('holds the practice to its own notice period when it cancels', () => {
    // Deliberately not excused by who was at fault: the coordinator waives it,
    // with a reason, rather than the status quietly deciding.
    expect(cancellationStatusFor(visit, 'practice_request', noticeOf(2), 24)).toBe(
      'cancelled_late',
    );
    expect(cancellationStatusFor(visit, 'practice_request', noticeOf(48), 24)).toBe('cancelled');
  });

  it('answers one of the two cancelled statuses for every reason there is', () => {
    for (const reason of CANCELLATION_REASONS) {
      expect(['cancelled', 'cancelled_late'], reason).toContain(
        cancellationStatusFor(visit, reason, noticeOf(23), 24),
      );
      expect(['cancelled', 'cancelled_late'], reason).toContain(
        cancellationStatusFor(visit, reason, noticeOf(48), 24),
      );
    }
  });

  it('keeps the two override lists apart, so no reason is both', () => {
    for (const reason of ALWAYS_LATE_REASONS) {
      expect(NEVER_LATE_REASONS, reason).not.toContain(reason);
    }
  });
});

describe('reasonCanBeGivenAt', () => {
  it('refuses "could not go ahead at the door" before the door was ever reached', () => {
    // The fault this exists to stop: two hundred hours' notice, called off as
    // unfit, and a full session taken for it.
    expect(reasonCanBeGivenAt('unfit_to_attend', visit, noticeOf(200))).toBe(false);
    expect(reasonCanBeGivenAt('unfit_to_attend', visit, noticeOf(1))).toBe(false);
  });

  it('allows it from the moment the arrival window opens', () => {
    // A practitioner may reasonably be at the door the minute it opens.
    expect(reasonCanBeGivenAt('unfit_to_attend', visit, WINDOW_START)).toBe(true);
    expect(
      reasonCanBeGivenAt('unfit_to_attend', visit, new Date(WINDOW_START.getTime() + 60_000)),
    ).toBe(true);
    expect(reasonCanBeGivenAt('unfit_to_attend', visit, new Date(WINDOW_START.getTime() - 1))).toBe(
      false,
    );
  });

  it('puts no moment on the other reasons: a visit may be called off at any time', () => {
    for (const reason of CANCELLATION_REASONS.filter((r) => r !== 'unfit_to_attend')) {
      expect(reasonCanBeGivenAt(reason, visit, noticeOf(200)), reason).toBe(true);
      expect(reasonCanBeGivenAt(reason, visit, WINDOW_START), reason).toBe(true);
    }
  });
});
