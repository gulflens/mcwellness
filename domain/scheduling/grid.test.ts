import { describe, expect, it } from 'vitest';
import { ceilToQuarterHour } from './grid';

/** Asia/Dubai is UTC+4 with no daylight saving: a quarter hour there is a quarter hour in UTC. */
describe('ceilToQuarterHour', () => {
  it('leaves a quarter hour where it is', () => {
    const at = new Date('2026-09-07T05:15:00Z');
    expect(ceilToQuarterHour(at).toISOString()).toBe('2026-09-07T05:15:00.000Z');
  });
  it('rounds up, never down', () => {
    expect(ceilToQuarterHour(new Date('2026-09-07T05:15:00.001Z')).toISOString()).toBe(
      '2026-09-07T05:30:00.000Z',
    );
    expect(ceilToQuarterHour(new Date('2026-09-07T05:52:30Z')).toISOString()).toBe(
      '2026-09-07T06:00:00.000Z',
    );
  });
});
