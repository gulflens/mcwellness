import { describe, expect, it } from 'vitest';
import { splitE164 } from '@domain/shared';
import { CANONICAL, COUNTRIES, countryForDialling, DIALLING_CODES } from './countries';

/**
 * A hand-entered table of ~236 rows is exactly the kind of thing that rots
 * silently — a typo'd dialling code doesn't throw, it just quietly attaches
 * the wrong country to a number. These are integrity checks on the table
 * itself, not on any control built with it (no control is built yet).
 */
describe('COUNTRIES', () => {
  it('gives every row a two-letter uppercase ISO code, and no two rows share one', () => {
    const isoCodes = COUNTRIES.map((c) => c.iso);
    for (const iso of isoCodes) expect(iso).toMatch(/^[A-Z]{2}$/);
    expect(new Set(isoCodes).size).toBe(isoCodes.length);
  });

  it('gives every row a dialling code of the form +<1-9><0-3 more digits>', () => {
    for (const country of COUNTRIES) expect(country.dialling).toMatch(/^\+[1-9]\d{0,3}$/);
  });

  it('gives every row a non-empty name, and no two rows share one', () => {
    const names = COUNTRIES.map((c) => c.name);
    for (const name of names) expect(name.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it('computes a flag that is exactly two regional-indicator code points', () => {
    for (const country of COUNTRIES) {
      // Array.from splits on code points; .length would count UTF-16 units
      // and read 4, because each regional-indicator symbol is outside the
      // BMP and encoded as a surrogate pair.
      expect(Array.from(country.flag).length).toBe(2);
    }
  });

  it('puts the United Arab Emirates first, dialling +971', () => {
    expect(COUNTRIES[0]!.iso).toBe('AE');
    expect(COUNTRIES[0]!.dialling).toBe('+971');
  });

  it('puts the rest of the GCC in the next five rows', () => {
    const nextFive = COUNTRIES.slice(1, 6).map((c) => c.iso);
    expect(new Set(nextFive)).toEqual(new Set(['SA', 'QA', 'BH', 'KW', 'OM']));
  });

  it('sorts everything after the first six alphabetically by name', () => {
    const rest = COUNTRIES.slice(6);
    for (let i = 1; i < rest.length; i++) {
      expect(rest[i - 1]!.name.localeCompare(rest[i]!.name, 'en')).toBeLessThanOrEqual(0);
    }
  });
});

describe('DIALLING_CODES', () => {
  it('has the same length as COUNTRIES', () => {
    expect(DIALLING_CODES.length).toBe(COUNTRIES.length);
  });

  it('is the real integration point with the committed splitE164 rule', () => {
    // The synthetic +971 50 000 xxxx range, as used throughout the domain tests.
    expect(splitE164('+971500001234', DIALLING_CODES)).toEqual({
      diallingCode: '+971',
      national: '500001234',
    });
  });
});

/**
 * A shared dialling code needs a stated default when it is read backwards —
 * without one, the alphabetically-first territory wins (Guernsey, ahead of
 * the United Kingdom), which is a visible wrongness on a code a Dubai
 * practice sees often.
 */
describe('countryForDialling', () => {
  it('resolves a shared code to its stated canonical member, not the alphabetical winner', () => {
    expect(countryForDialling('+44')?.name).toBe('United Kingdom');
    expect(countryForDialling('+1')?.name).toBe('United States');
    expect(countryForDialling('+7')?.name).toBe('Russia');
  });

  it('resolves a single-member code to that member', () => {
    expect(countryForDialling('+971')?.name).toBe('United Arab Emirates');
  });

  it('resolves an unknown code to undefined rather than guessing', () => {
    expect(countryForDialling('+0')).toBeUndefined();
  });

  // Fix round finding 8, 2026-09-12: `countryForDialling` falls through
  // silently to table order for an ISO that `CANONICAL` names but the table
  // does not actually carry, so a typo'd override would draw the WRONG
  // country from the list rather than fail — exactly the kind of rot the
  // module's own docstring warns a hand-entered table invites.
  it('names an ISO in CANONICAL that the table actually carries', () => {
    for (const iso of Object.values(CANONICAL)) {
      expect(
        COUNTRIES.some((country) => country.iso === iso),
        `CANONICAL names ${iso}, which is not in COUNTRIES`,
      ).toBe(true);
    }
  });
});
