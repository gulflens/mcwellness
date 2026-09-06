import { describe, expect, it } from 'vitest';
import { fils } from '../shared';
import {
  CALL_OUT_FEE_OUTCOMES,
  CHARGING_OUTCOMES,
  FEE_EXEMPT_REASONS,
  LATE_CANCELLATION_NOTICE_HOURS,
  callOutFeeFor,
  consumesEntitlement,
  isLateCancellation,
} from './lateCancellation';

/**
 * The specification for the notice period and for what a visit called off
 * inside it costs (docs/SPEC/billing.md section 4.3, the founder's decision of
 * 2026-09-03 and her amendment of 2026-09-04: one fee, never a session).
 */

const WINDOW_START = new Date('2026-09-10T06:00:00.000Z'); // 10:00 in Dubai

/** The practice's own figure: AED 150, `scheduling_setting.unfit_fee_fils`. */
const SETTING = { callOutFeeFils: fils(15_000) };

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
  it('takes a session for nothing at all: the founder ended that on 2026-09-04', () => {
    expect(CHARGING_OUTCOMES).toEqual([]);
    for (const status of [
      'proposed',
      'confirmed',
      'checked_in',
      'completed',
      'cancelled',
      'cancelled_late',
      'no_show',
      'rescheduled',
      'some_future_status',
    ]) {
      expect(consumesEntitlement(status)).toBe(false);
    }
  });
});

describe('callOutFeeFor', () => {
  it('charges the fee for a visit called off inside the notice period', () => {
    expect(callOutFeeFor('cancelled_late', 'client_request', SETTING)).toBe(15_000);
  });

  it('charges the fee when the practitioner arrived and it could not go ahead', () => {
    expect(callOutFeeFor('cancelled_late', 'unfit_to_attend', SETTING)).toBe(15_000);
  });

  it('charges the fee for a no-show: a journey made and no session delivered', () => {
    // Claude's default of 2026-09-06, recorded in
    // docs/CHANGE-REQUESTS/billing-05.md for the founder to overrule. A
    // no-show carries no cancellation reason: nobody called it off.
    expect(callOutFeeFor('no_show', null, SETTING)).toBe(15_000);
  });

  it('charges nothing when the practice called the visit off itself', () => {
    expect(callOutFeeFor('cancelled_late', 'practice_request', SETTING)).toBeNull();
  });

  it('charges nothing when a consent was withdrawn', () => {
    expect(callOutFeeFor('cancelled_late', 'consent_withdrawn', SETTING)).toBeNull();
  });

  it('charges nothing for a visit called off in time, whatever the reason', () => {
    for (const reason of [...FEE_EXEMPT_REASONS, 'client_request', 'unfit_to_attend', null]) {
      expect(callOutFeeFor('cancelled', reason, SETTING)).toBeNull();
    }
  });

  it('charges nothing for a visit that has not been called off at all', () => {
    for (const status of ['proposed', 'confirmed', 'checked_in', 'completed', 'rescheduled']) {
      expect(callOutFeeFor(status, null, SETTING)).toBeNull();
    }
  });

  it('charges nothing for a status nobody has named here', () => {
    expect(callOutFeeFor('some_future_status', null, SETTING)).toBeNull();
    expect(CALL_OUT_FEE_OUTCOMES).toEqual(['cancelled_late', 'no_show']);
  });

  it('charges nothing at all when the practice has set its fee to zero', () => {
    const free = { callOutFeeFils: fils(0) };
    expect(callOutFeeFor('cancelled_late', 'client_request', free)).toBeNull();
    expect(callOutFeeFor('no_show', null, free)).toBeNull();
  });

  it('charges whatever figure the practice has set, not the one it started with', () => {
    expect(callOutFeeFor('no_show', null, { callOutFeeFils: fils(20_000) })).toBe(20_000);
  });
});
