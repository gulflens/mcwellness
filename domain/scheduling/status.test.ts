import { describe, expect, it } from 'vitest';
import {
  APPOINTMENT_STATUSES,
  SETTLED_STATUSES,
  canBeConfirmed,
  householdHasBeenTold,
  isSettled,
} from './status';

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

describe('canBeConfirmed', () => {
  it('confirms a visit the household has not been told about yet', () => {
    expect(canBeConfirmed('proposed')).toBe(true);
  });

  it('does not confirm a visit that is already confirmed', () => {
    expect(canBeConfirmed('confirmed')).toBe(false);
  });

  it('never reopens a visit that has already happened one way or another', () => {
    for (const status of SETTLED_STATUSES) {
      expect(canBeConfirmed(status)).toBe(false);
    }
    expect(canBeConfirmed('checked_in')).toBe(false);
  });

  it('answers for every status the lifecycle has', () => {
    expect(APPOINTMENT_STATUSES.filter(canBeConfirmed)).toEqual(['proposed']);
  });
});

describe('householdHasBeenTold', () => {
  it('says a proposed visit is one nobody has been told about', () => {
    expect(householdHasBeenTold('proposed')).toBe(false);
  });

  it('says every other status is on the far side of somebody having said so', () => {
    const untold = APPOINTMENT_STATUSES.filter((status) => !householdHasBeenTold(status));
    expect(untold).toEqual(['proposed']);
  });
});
