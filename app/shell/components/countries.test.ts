import { describe, expect, it } from 'vitest';
import { splitE164 } from '@domain/shared';
import { COUNTRIES, DIALLING_CODES } from './countries';

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
