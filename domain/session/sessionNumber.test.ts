import { describe, expect, it } from 'vitest';
import { sessionNumber, type EntitlementEntry, type SessionHistoryEntry } from './sessionNumber';

const SERVICE = '00000000-0000-4000-8000-0000000000f1';
const OTHER_SERVICE = '00000000-0000-4000-8000-0000000000f2';

function past(n: number, over: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
  return {
    id: `00000000-0000-4000-8000-00000000a${String(n).padStart(3, '0')}`,
    serviceTypeId: SERVICE,
    status: 'completed',
    checkedInAt: `2026-0${n}-01T06:30:00.000Z`,
    ...over,
  };
}

const TODAY = {
  id: '00000000-0000-4000-8000-00000000b001',
  serviceTypeId: SERVICE,
  checkedInAt: '2026-09-03T06:30:00.000Z',
};

function credits(available: number, consumed = 0): EntitlementEntry[] {
  return [
    ...Array.from({ length: available }, () => ({
      serviceTypeId: SERVICE,
      status: 'available' as const,
    })),
    ...Array.from({ length: consumed }, () => ({
      serviceTypeId: SERVICE,
      status: 'consumed' as const,
    })),
  ];
}

describe('sessionNumber', () => {
  it('numbers a client first visit as one', () => {
    expect(sessionNumber([], TODAY)).toEqual({ number: 1, of: null });
  });

  it('counts only completed visits of the same service before this one', () => {
    const history = [
      past(1),
      past(2),
      past(3, { status: 'cancelled' }),
      past(4, { status: 'no_show' }),
      past(5, { serviceTypeId: OTHER_SERVICE }),
    ];
    expect(sessionNumber(history, TODAY).number).toBe(3);
  });

  it('does not count this visit twice when it is already in the history', () => {
    const history = [past(1), { ...past(2), id: TODAY.id, checkedInAt: TODAY.checkedInAt }];
    expect(sessionNumber(history, TODAY).number).toBe(2);
  });

  it('has no denominator when the practice holds no credits for the service', () => {
    expect(sessionNumber([past(1)], TODAY).of).toBeNull();
  });

  it('makes the programme what has been done plus what is still owed', () => {
    // Two completed, eight still available: session 3 of 10.
    expect(sessionNumber([past(1), past(2)], TODAY, credits(8, 2))).toEqual({ number: 3, of: 10 });
  });

  it('counts neither an expired nor a refunded credit towards the programme', () => {
    const entitlements: EntitlementEntry[] = [
      ...credits(2),
      { serviceTypeId: SERVICE, status: 'expired' },
      { serviceTypeId: SERVICE, status: 'refunded' },
    ];
    expect(sessionNumber([past(1)], TODAY, entitlements)).toEqual({ number: 2, of: 3 });
  });

  it('ignores credits for another service', () => {
    const entitlements: EntitlementEntry[] = [
      { serviceTypeId: OTHER_SERVICE, status: 'available' },
    ];
    expect(sessionNumber([], TODAY, entitlements).of).toBeNull();
  });

  it('never reports a number beyond the programme it names', () => {
    // Overrun: more visits done than the credits ever allowed for.
    expect(sessionNumber([past(1), past(2), past(3)], TODAY, credits(0, 3)).of).toBe(4);
  });

  it('orders visits checked in at the same moment by their own ids, stably', () => {
    // Same instant, so the tie breaks on the id: one sorts after this visit
    // and does not count, the other sorts before it and does.
    const after = past(1, {
      id: '00000000-0000-4000-8000-00000000c001',
      checkedInAt: TODAY.checkedInAt,
    });
    expect(sessionNumber([after], TODAY).number).toBe(1);
    const before = past(1, {
      id: '00000000-0000-4000-8000-00000000a001',
      checkedInAt: TODAY.checkedInAt,
    });
    expect(sessionNumber([before], TODAY).number).toBe(2);
  });
});
