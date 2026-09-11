import { describe, expect, it } from 'vitest';
import { termWords } from './term';

/**
 * The words a term is said in, English and Arabic, for the sale drawers and
 * the invoice line (the controller's ruling of 12 September 2026,
 * .superpowers/sdd/2026-09-12-optional-terms/progress.md).
 *
 * The function this replaces counted months only. It now counts in either
 * unit and, above all, answers **null for a termless sale** — the sale that
 * names no term prints none, rather than printing a form of words about
 * nothing.
 *
 * Arabic counts one, two, three-to-ten and eleven-upwards differently, and
 * each unit has all four forms. Every one of them is here, in both units, at
 * the boundaries that separate them.
 */

describe('termWords', () => {
  it('says nothing at all about a sale with no term', () => {
    // Null in, null out: the caller prints no term, which is what "these
    // credits never expire" looks like on a document.
    expect(termWords(null)).toBeNull();
  });

  describe('a term counted in months', () => {
    it('says the practice’s own six months in both languages', () => {
      expect(termWords({ amount: 6, unit: 'month' })).toEqual({ en: '6 months', ar: '6 أشهر' });
    });

    it('knows Arabic counts one, two, a few and many', () => {
      expect(termWords({ amount: 1, unit: 'month' })).toEqual({
        en: '1 month',
        ar: 'شهر واحد',
      });
      expect(termWords({ amount: 2, unit: 'month' })).toEqual({ en: '2 months', ar: 'شهران' });
      expect(termWords({ amount: 3, unit: 'month' })).toEqual({ en: '3 months', ar: '3 أشهر' });
      expect(termWords({ amount: 10, unit: 'month' })).toEqual({ en: '10 months', ar: '10 أشهر' });
      expect(termWords({ amount: 11, unit: 'month' })).toEqual({ en: '11 months', ar: '11 شهرًا' });
      expect(termWords({ amount: 12, unit: 'month' })).toEqual({ en: '12 months', ar: '12 شهرًا' });
    });
  });

  describe('a term counted in days', () => {
    it('says a fortnight in both languages', () => {
      expect(termWords({ amount: 14, unit: 'day' })).toEqual({ en: '14 days', ar: '14 يومًا' });
    });

    it('counts one, two, a few and many exactly as the months do', () => {
      expect(termWords({ amount: 1, unit: 'day' })).toEqual({ en: '1 day', ar: 'يوم واحد' });
      expect(termWords({ amount: 2, unit: 'day' })).toEqual({ en: '2 days', ar: 'يومان' });
      expect(termWords({ amount: 3, unit: 'day' })).toEqual({ en: '3 days', ar: '3 أيام' });
      expect(termWords({ amount: 10, unit: 'day' })).toEqual({ en: '10 days', ar: '10 أيام' });
      expect(termWords({ amount: 11, unit: 'day' })).toEqual({ en: '11 days', ar: '11 يومًا' });
      expect(termWords({ amount: 30, unit: 'day' })).toEqual({ en: '30 days', ar: '30 يومًا' });
    });
  });

  it('refuses a term that is not a whole number, one or more, in either unit', () => {
    expect(() => termWords({ amount: 0, unit: 'month' })).toThrow(RangeError);
    expect(() => termWords({ amount: 1.5, unit: 'month' })).toThrow(RangeError);
    expect(() => termWords({ amount: -3, unit: 'day' })).toThrow(RangeError);
    expect(() => termWords({ amount: 0, unit: 'day' })).toThrow(RangeError);
  });

  it('refuses a unit the practice does not count in', () => {
    // Unreachable from typed code; reachable from a row read out of the
    // database, which is the same judgement `expiryOn` makes beside it — a
    // loud refusal rather than words about a term nobody can honour.
    expect(() =>
      termWords({ amount: 3, unit: 'week' } as unknown as { amount: number; unit: 'day' }),
    ).toThrow(RangeError);
  });
});
