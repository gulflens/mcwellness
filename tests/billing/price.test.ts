import { describe, expect, it } from 'vitest';
import { currentPriceFor, validateNewPrice, type Price } from '../../domain/billing';
import { fils } from '../../domain/shared';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const BRAIN_MAP = '00000000-0000-4000-8000-0000000000a2';

function price(serviceTypeId: string, unitPriceFils: number, validFrom: string): Price {
  return {
    id: `${serviceTypeId}-${validFrom}`,
    serviceTypeId,
    unitPriceFils: fils(unitPriceFils),
    validFrom,
  };
}

describe('currentPriceFor', () => {
  it('returns null when the service has never had a price', () => {
    expect(currentPriceFor([], SESSION, '2026-09-02')).toBeNull();
  });

  it('returns the only price when there is one', () => {
    const p = price(SESSION, 90_000, '2026-01-01');
    expect(currentPriceFor([p], SESSION, '2026-09-02')).toEqual(p);
  });

  it('picks the latest price at or before the date, ignoring a later one and another service', () => {
    const superseded = price(SESSION, 85_000, '2026-01-01');
    const current = price(SESSION, 90_000, '2026-06-01');
    const future = price(SESSION, 95_000, '2026-12-01');
    const other = price(BRAIN_MAP, 145_000, '2026-01-01');
    expect(currentPriceFor([superseded, current, future, other], SESSION, '2026-09-02')).toEqual(
      current,
    );
  });

  it('treats validFrom as inclusive: a price counts from its own day', () => {
    const p = price(SESSION, 90_000, '2026-09-02');
    expect(currentPriceFor([p], SESSION, '2026-09-02')).toEqual(p);
    expect(currentPriceFor([p], SESSION, '2026-09-01')).toBeNull();
  });

  it('is unaffected by the order prices are given in', () => {
    const older = price(SESSION, 80_000, '2025-01-01');
    const newer = price(SESSION, 90_000, '2026-01-01');
    expect(currentPriceFor([newer, older], SESSION, '2026-09-02')).toEqual(newer);
    expect(currentPriceFor([older, newer], SESSION, '2026-09-02')).toEqual(newer);
  });
});

describe('validateNewPrice', () => {
  const TODAY = '2026-09-02';

  it('accepts a first price starting today', () => {
    expect(validateNewPrice(null, { validFrom: TODAY }, TODAY)).toEqual({ ok: true });
  });

  it('accepts a first price starting in the future', () => {
    expect(validateNewPrice(null, { validFrom: '2026-10-01' }, TODAY)).toEqual({ ok: true });
  });

  it('refuses a first price backdated before today', () => {
    const result = validateNewPrice(null, { validFrom: '2026-09-01' }, TODAY);
    expect(result.ok).toBe(false);
  });

  it('refuses a price that does not start after the one it supersedes', () => {
    const current = price(SESSION, 90_000, '2026-06-01');
    expect(validateNewPrice(current, { validFrom: '2026-06-01' }, TODAY).ok).toBe(false);
    expect(validateNewPrice(current, { validFrom: '2026-01-01' }, TODAY).ok).toBe(false);
  });

  it('accepts a price that starts after the one it supersedes', () => {
    const current = price(SESSION, 90_000, '2026-06-01');
    expect(validateNewPrice(current, { validFrom: TODAY }, TODAY)).toEqual({ ok: true });
  });

  it('names the problem in the refusal, for the screen to show later', () => {
    const result = validateNewPrice(null, { validFrom: '2026-01-01' }, TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
