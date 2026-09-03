import { describe, expect, it } from 'vitest';
import { fils } from '../shared';
import { balanceFor, outstandingBalanceFils, type EntitlementRecord } from './balance';

/**
 * The specification for what a client has left (docs/SPEC/billing.md
 * section 1). This is the arithmetic behind "Session 3 of 15" on a stop card
 * and behind the money panel on the client record.
 */

const NF = 'nf-session';
const MAP = 'brain-map';
const TODAY = '2026-09-03';
const EXPIRES = '2027-09-03';

function credit(over: Partial<EntitlementRecord> = {}): EntitlementRecord {
  return {
    serviceTypeId: NF,
    status: 'available',
    allocatedNetFils: fils(59_486),
    expiresOn: EXPIRES,
    consumptionKind: null,
    ...over,
  };
}

function credits(n: number, over: Partial<EntitlementRecord> = {}): EntitlementRecord[] {
  return Array.from({ length: n }, () => credit(over));
}

describe('balanceFor', () => {
  it('reads "Session 3 of 15" off fifteen credits with two delivered', () => {
    const balance = balanceFor(
      [...credits(2, { status: 'consumed', consumptionKind: 'session' }), ...credits(13)],
      TODAY,
    );
    const sessions = balance.services[0];
    expect(sessions?.serviceTypeId).toBe(NF);
    expect(sessions?.purchased).toBe(15);
    expect(sessions?.delivered).toBe(2);
    expect(sessions?.remaining).toBe(13);
    // The next visit is the third of fifteen.
    expect((sessions?.delivered ?? 0) + 1).toBe(3);
  });

  it('keeps each service apart, in the order the credits were first seen', () => {
    const balance = balanceFor(
      [
        credit({ serviceTypeId: MAP, allocatedNetFils: fils(70_108) }),
        ...credits(3),
        credit({
          serviceTypeId: MAP,
          status: 'consumed',
          consumptionKind: 'session',
          allocatedNetFils: fils(70_108),
        }),
      ],
      TODAY,
    );
    expect(balance.services.map((s) => s.serviceTypeId)).toEqual([MAP, NF]);
    expect(balance.services[0]?.purchased).toBe(2);
    expect(balance.services[0]?.delivered).toBe(1);
    expect(balance.services[1]?.remaining).toBe(3);
  });

  it('values what is left at the rate each credit was allocated at', () => {
    const balance = balanceFor(credits(3), TODAY);
    expect(balance.remainingValueNetFils).toBe(3 * 59_486);
  });

  it('counts a late cancellation as forfeited, not delivered', () => {
    const balance = balanceFor(
      [
        credit({ status: 'consumed', consumptionKind: 'session' }),
        credit({ status: 'consumed', consumptionKind: 'late_cancellation' }),
        credit({ status: 'consumed', consumptionKind: 'no_show' }),
        ...credits(2),
      ],
      TODAY,
    );
    const sessions = balance.services[0];
    expect(sessions?.delivered).toBe(1);
    expect(sessions?.forfeited).toBe(2);
    expect(sessions?.remaining).toBe(2);
    expect(sessions?.purchased).toBe(5);
  });

  it('leaves a waived credit out entirely: its replacement carries the client', () => {
    const balance = balanceFor(
      [
        credit({ status: 'waived', consumptionKind: 'late_cancellation' }),
        credit(), // the replacement written in its place
      ],
      TODAY,
    );
    const sessions = balance.services[0];
    expect(sessions?.purchased).toBe(1);
    expect(sessions?.forfeited).toBe(0);
    expect(sessions?.remaining).toBe(1);
  });

  it('leaves a refunded credit out entirely', () => {
    const balance = balanceFor([credit({ status: 'refunded' }), credit()], TODAY);
    expect(balance.services[0]?.purchased).toBe(1);
    expect(balance.remaining).toBe(1);
  });

  it('treats a credit past its date as lapsed, whether or not anything swept it', () => {
    const balance = balanceFor(
      [
        credit({ expiresOn: '2026-09-02' }), // yesterday: nothing has marked it yet
        credit({ status: 'expired', expiresOn: '2026-01-01' }),
        credit({ expiresOn: '2026-09-03' }), // today: still usable
      ],
      TODAY,
    );
    const sessions = balance.services[0];
    expect(sessions?.remaining).toBe(1);
    expect(sessions?.lapsed).toBe(2);
    expect(sessions?.remainingValueNetFils).toBe(59_486);
  });

  it('warns about the soonest date a usable credit runs out', () => {
    const balance = balanceFor(
      [credit({ expiresOn: '2027-06-01' }), credit({ expiresOn: '2026-10-15' })],
      TODAY,
    );
    expect(balance.nextExpiryOn).toBe('2026-10-15');
    expect(balance.expiryWarning).toBe('sixty_days');
  });

  it('says nothing about expiry when nothing is left to expire', () => {
    const balance = balanceFor(
      credits(2, { status: 'consumed', consumptionKind: 'session', expiresOn: '2026-09-04' }),
      TODAY,
    );
    expect(balance.nextExpiryOn).toBeNull();
    expect(balance.expiryWarning).toBe('none');
    expect(balance.services[0]?.expiryWarning).toBe('none');
  });

  it('answers an empty ledger with nothing rather than an error', () => {
    const balance = balanceFor([], TODAY);
    expect(balance.services).toEqual([]);
    expect(balance.delivered).toBe(0);
    expect(balance.remaining).toBe(0);
    expect(balance.remainingValueNetFils).toBe(0);
    expect(balance.nextExpiryOn).toBeNull();
  });
});

describe('outstandingBalanceFils', () => {
  it('is what was charged less what was paid', () => {
    expect(
      outstandingBalanceFils(
        [{ grossFils: fils(1_084_125) }, { grossFils: fils(73_500) }],
        [{ amountFils: fils(1_084_125) }],
      ),
    ).toBe(73_500);
  });

  it('goes negative when the practice holds credit for the household', () => {
    expect(
      outstandingBalanceFils([{ grossFils: fils(10_000) }], [{ amountFils: fils(15_000) }]),
    ).toBe(-5_000);
  });

  it('is nothing at all when nothing has happened', () => {
    expect(outstandingBalanceFils([], [])).toBe(0);
  });
});
