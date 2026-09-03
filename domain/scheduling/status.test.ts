import { describe, expect, it } from 'vitest';
import { APPOINTMENT_STATUSES, SETTLED_STATUSES, isSettled } from './status';

describe('isSettled', () => {
  it('calls a visit settled once it is delivered, called off, missed or moved', () => {
    for (const status of SETTLED_STATUSES) {
      expect(isSettled(status)).toBe(true);
    }
  });

  it('leaves a visit still owed open', () => {
    expect(isSettled('proposed')).toBe(false);
    expect(isSettled('confirmed')).toBe(false);
    expect(isSettled('checked_in')).toBe(false);
  });

  it('answers for every status the lifecycle has, so a new one cannot slip past unjudged', () => {
    const open = APPOINTMENT_STATUSES.filter((status) => !isSettled(status));
    expect(open).toEqual(['proposed', 'confirmed', 'checked_in']);
    expect(APPOINTMENT_STATUSES.length).toBe(open.length + SETTLED_STATUSES.length);
  });
});
