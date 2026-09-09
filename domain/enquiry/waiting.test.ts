import { describe, expect, it } from 'vitest';
import { ENQUIRY_WAITING_AFTER_DAYS, enquiryWaitingDays } from './waiting';

// The operator's decision of 10 September 2026 (decision 3 of
// docs/OPERATOR/2026-09-10-decisions.md): an enquiry still new after thirty
// days is surfaced as waiting, and nothing dismisses it by itself.
const NOW = new Date('2026-10-20T08:00:00.000Z');

describe('an enquiry nobody has actioned', () => {
  it('is waiting once thirty days have passed, and says how many', () => {
    expect(ENQUIRY_WAITING_AFTER_DAYS).toBe(30);
    expect(enquiryWaitingDays('new', '2026-09-20T08:00:00.000Z', NOW)).toBe(30);
    expect(enquiryWaitingDays('new', '2026-09-10T19:30:00.000Z', NOW)).toBe(39);
  });

  it('is not waiting before thirty days, nor once it has been actioned', () => {
    expect(enquiryWaitingDays('new', '2026-09-21T08:00:00.000Z', NOW)).toBeNull();
    expect(enquiryWaitingDays('new', '2026-10-19T08:00:00.000Z', NOW)).toBeNull();
    expect(enquiryWaitingDays('converted', '2026-08-01T08:00:00.000Z', NOW)).toBeNull();
    expect(enquiryWaitingDays('dismissed', '2026-08-01T08:00:00.000Z', NOW)).toBeNull();
  });
});
