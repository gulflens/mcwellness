import { describe, expect, it } from 'vitest';
import { resolveSaleVat, resolveVat } from '../../domain/billing';
import { fils } from '../../domain/shared';

describe('resolveVat', () => {
  it('computes the standard 5% rate on a realistic session price', () => {
    const result = resolveVat(fils(90_000), { rateBasisPoints: 500, version: 1 });
    expect(result).toEqual({
      treatment: 'standard',
      rateBasisPoints: 500,
      settingVersion: 1,
      vatFils: 4_500,
      grossFils: 94_500,
    });
  });

  it('charges no VAT when the rate is zero', () => {
    const result = resolveVat(fils(90_000), { rateBasisPoints: 0, version: 2 });
    expect(result.vatFils).toBe(0);
    expect(result.grossFils).toBe(90_000);
  });

  it('charges VAT on the full amount when the rate is 100%', () => {
    const result = resolveVat(fils(1_000), { rateBasisPoints: 10_000, version: 1 });
    expect(result.vatFils).toBe(1_000);
    expect(result.grossFils).toBe(2_000);
  });

  it('rounds an exact half-fils up, not down and not to even', () => {
    // 10 fils at 5% is exactly 0.5 fils.
    const result = resolveVat(fils(10), { rateBasisPoints: 500, version: 1 });
    expect(result.vatFils).toBe(1);
    expect(result.grossFils).toBe(11);
  });

  it('rounds a near-half amount to the nearer fils on both sides', () => {
    const roundsDown = resolveVat(fils(29), { rateBasisPoints: 500, version: 1 }); // 1.45 -> 1
    expect(roundsDown.vatFils).toBe(1);
    const roundsUp = resolveVat(fils(31), { rateBasisPoints: 500, version: 1 }); // 1.55 -> 2
    expect(roundsUp.vatFils).toBe(2);
  });

  it('treats a net amount of zero as zero VAT', () => {
    const result = resolveVat(fils(0), { rateBasisPoints: 500, version: 1 });
    expect(result.vatFils).toBe(0);
    expect(result.grossFils).toBe(0);
  });

  it('carries the setting version through unchanged, for the invoice trail later', () => {
    const result = resolveVat(fils(100_000), { rateBasisPoints: 500, version: 7 });
    expect(result.settingVersion).toBe(7);
    expect(result.treatment).toBe('standard');
  });

  it('returns an integer number of fils, never a float', () => {
    const result = resolveVat(fils(33), { rateBasisPoints: 500, version: 1 });
    expect(Number.isInteger(result.vatFils)).toBe(true);
    expect(Number.isInteger(result.grossFils)).toBe(true);
  });
});

describe('resolveSaleVat', () => {
  const setting = { rateBasisPoints: 500, version: 3 };

  it('charges nothing on a sale by a practice that is not registered for VAT', () => {
    const result = resolveSaleVat(fils(70_000), setting, { vatRegistered: false });
    expect(result).toEqual({
      treatment: 'not_registered',
      rateBasisPoints: 0,
      settingVersion: 3,
      vatFils: 0,
      grossFils: 70_000,
    });
  });

  it('charges the standard rate once the practice is registered', () => {
    const result = resolveSaleVat(fils(70_000), setting, { vatRegistered: true });
    expect(result).toEqual({
      treatment: 'standard',
      rateBasisPoints: 500,
      settingVersion: 3,
      vatFils: 3_500,
      grossFils: 73_500,
    });
  });

  it('leaves the net price alone either way: the gross is the net, unregistered', () => {
    // Prices are published net (docs/SPEC/billing.md section 2.2), so
    // registering adds five per cent on top rather than carving it out of a
    // figure a family was already shown.
    const net = fils(1_032_500);
    expect(resolveSaleVat(net, setting, { vatRegistered: false }).grossFils).toBe(1_032_500);
    expect(resolveSaleVat(net, setting, { vatRegistered: true }).grossFils).toBe(1_084_125);
  });

  it('names the setting it consulted even when it charged nothing', () => {
    // The version is a foreign key on the invoice line, and the record of
    // which rate was in force on the day — not a claim about what was charged.
    const result = resolveSaleVat(
      fils(82_500),
      { rateBasisPoints: 500, version: 9 },
      {
        vatRegistered: false,
      },
    );
    expect(result.settingVersion).toBe(9);
    expect(result.rateBasisPoints).toBe(0);
  });

  it("does not call an unregistered practice's supply zero-rated or exempt", () => {
    // Both are treatments a *registered* supplier applies. Saying either on a
    // document would claim a registration the practice does not hold.
    const result = resolveSaleVat(fils(70_000), setting, { vatRegistered: false });
    expect(result.treatment).toBe('not_registered');
  });
});
