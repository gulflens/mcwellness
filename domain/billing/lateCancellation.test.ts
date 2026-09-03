import { describe, expect, it } from 'vitest';
import {
  CHARGING_OUTCOMES,
  LATE_CANCELLATION_NOTICE_HOURS,
  consumesEntitlement,
  isLateCancellation,
} from './lateCancellation';

/**
 * The specification for the notice period (docs/SPEC/billing.md section 4.3,
 * and the founder's decision of 2026-09-03).
 */

const WINDOW_START = new Date('2026-09-10T06:00:00.000Z'); // 10:00 in Dubai

describe('isLateCancellation', () => {
  it('holds the practice to twenty-four hours', () => {
    expect(LATE_CANCELLATION_NOTICE_HOURS).toBe(24);
  });

  it('is not late with a full day of notice, to the minute', () => {
    expect(isLateCancellation(WINDOW_START, new Date('2026-09-09T06:00:00.000Z'))).toBe(false);
  });

  it('is late a minute inside the notice period', () => {
    expect(isLateCancellation(WINDOW_START, new Date('2026-09-09T06:01:00.000Z'))).toBe(true);
  });

  it('is not late with a week of notice', () => {
    expect(isLateCancellation(WINDOW_START, new Date('2026-09-03T06:00:00.000Z'))).toBe(false);
  });

  it('is late when the visit has already come and gone', () => {
    expect(isLateCancellation(WINDOW_START, new Date('2026-09-11T06:00:00.000Z'))).toBe(true);
  });

  it('takes a different notice period when the practice sets one', () => {
    expect(isLateCancellation(WINDOW_START, new Date('2026-09-08T06:00:00.000Z'), 72)).toBe(true);
    expect(isLateCancellation(WINDOW_START, new Date('2026-09-08T06:00:00.000Z'), 24)).toBe(false);
  });

  it('refuses a notice period that is not a number of hours', () => {
    expect(() => isLateCancellation(WINDOW_START, WINDOW_START, -1)).toThrow(RangeError);
  });
});

describe('consumesEntitlement', () => {
  it('charges a late cancellation and a no-show', () => {
    expect(consumesEntitlement('cancelled_late')).toBe(true);
    expect(consumesEntitlement('no_show')).toBe(true);
  });

  it('charges nothing for a visit called off in time, or one still to happen', () => {
    for (const status of [
      'proposed',
      'confirmed',
      'checked_in',
      'completed',
      'cancelled',
      'rescheduled',
    ]) {
      expect(consumesEntitlement(status)).toBe(false);
    }
  });

  it('charges nothing for a status nobody has named here', () => {
    expect(consumesEntitlement('some_future_status')).toBe(false);
    expect(CHARGING_OUTCOMES).toEqual(['cancelled_late', 'no_show']);
  });
});
