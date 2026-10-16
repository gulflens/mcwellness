import { describe, expect, it } from 'vitest';
import { DECLINED_KEPT_DAYS, PENDING_KEPT_DAYS, testimonialRetentionCutoffs } from './retention';

describe('testimonialRetentionCutoffs', () => {
  it('keeps a declined review thirty days and an undecided one a hundred and eighty', () => {
    expect(DECLINED_KEPT_DAYS).toBe(30);
    expect(PENDING_KEPT_DAYS).toBe(180);
    const now = new Date('2026-10-06T03:00:00.000Z');
    expect(testimonialRetentionCutoffs(now)).toEqual({
      declinedBefore: new Date('2026-09-06T03:00:00.000Z'),
      pendingBefore: new Date('2026-04-09T03:00:00.000Z'),
    });
  });
});
