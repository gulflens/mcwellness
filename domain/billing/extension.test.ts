import { describe, expect, it } from 'vitest';
import { EXTENSION_MONTHS, MAX_EXTENSIONS, nextExtension, termWords } from './extension';
import { DEFAULT_EXPIRY_MONTHS } from './expiry';

describe('the term', () => {
  it('runs six months by default from this round', () => {
    expect(DEFAULT_EXPIRY_MONTHS).toBe(6);
  });
});

describe('nextExtension', () => {
  it('adds exactly three months to the current end, and numbers it one', () => {
    expect(nextExtension('2027-03-15', 0)).toEqual({
      ordinal: 1,
      fromOn: '2027-03-15',
      toOn: '2027-06-15',
    });
  });

  it('adds three more from the extended end, and numbers it two', () => {
    expect(nextExtension('2027-06-15', 1)).toEqual({
      ordinal: 2,
      fromOn: '2027-06-15',
      toOn: '2027-09-15',
    });
  });

  it('refuses a third: the programme has had its two', () => {
    expect(nextExtension('2027-09-15', 2)).toBeNull();
  });

  it('clamps to the shorter month, as the sale does', () => {
    expect(nextExtension('2026-11-30', 0)?.toOn).toBe('2027-02-28');
  });

  it('is three months and two at most, by name', () => {
    expect(EXTENSION_MONTHS).toBe(3);
    expect(MAX_EXTENSIONS).toBe(2);
  });
});

describe('termWords', () => {
  it('says six months in both languages', () => {
    expect(termWords(6)).toEqual({ en: '6 months', ar: '6 أشهر' });
  });

  it('knows Arabic counts one, two, a few and many', () => {
    expect(termWords(1)).toEqual({ en: '1 month', ar: 'شهر واحد' });
    expect(termWords(2)).toEqual({ en: '2 months', ar: 'شهران' });
    expect(termWords(12)).toEqual({ en: '12 months', ar: '12 شهرًا' });
  });
});
