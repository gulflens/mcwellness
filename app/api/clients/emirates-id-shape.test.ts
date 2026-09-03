import { describe, expect, it } from 'vitest';
import {
  digitsOf,
  isEmiratesIdShaped,
  toLatinDigits,
  wholeEmiratesIdDigits,
} from './emirates-id-shape';

/** The reserved synthetic range (.claude/rules/testing.md), with its own check digit. */
const WHOLE = '784-1900-0000013-4';
const BARE = '784190000000134';

describe('isEmiratesIdShaped', () => {
  it('is true for every prefix of one being typed, and for the whole', () => {
    for (let i = 1; i <= WHOLE.length; i += 1) {
      expect(isEmiratesIdShaped(WHOLE.slice(0, i))).toBe(true);
    }
    expect(isEmiratesIdShaped(BARE)).toBe(true);
  });

  it('reads the digits through whatever a person or a paste puts between them', () => {
    const separated = [
      '784 1900 0000013 4',
      '784 1900 0000013 4', // non-breaking spaces
      '784‌1900‌0000013‌4', // a zero-width joiner cleanText keeps
      '(784) 1900.0000013-4',
      '+784190000000134',
    ];
    for (const term of separated) {
      expect(isEmiratesIdShaped(term)).toBe(true);
      expect(wholeEmiratesIdDigits(term)).toBe(BARE);
    }
  });

  it('reads an Emirates ID typed on an Arabic keyboard', () => {
    const arabicIndic = '٧٨٤-١٩٠٠-٠٠٠٠٠١٣-٤';
    const extended = '۷۸۴۱۹۰۰۰۰۰۰۰۱۳۴';
    expect(toLatinDigits(arabicIndic)).toBe(WHOLE);
    expect(isEmiratesIdShaped(arabicIndic)).toBe(true);
    expect(wholeEmiratesIdDigits(arabicIndic)).toBe(BARE);
    expect(wholeEmiratesIdDigits(extended)).toBe(BARE);
  });

  it('finds a whole one buried in a longer term, wherever it sits', () => {
    // The anchored rule was blind to both of these: neither was refused from `?q=`
    // nor routed to the lookup, so a complete identity number reached the query
    // string entire (security review of pull request 35).
    for (const term of ['MW-1 784-1900-0000013-4', '0784190000000134', 'x 784 1900 0000013 4']) {
      expect(isEmiratesIdShaped(term)).toBe(true);
      expect(wholeEmiratesIdDigits(term)).toBe(BARE);
    }
  });

  it('will not guess at a run that carries on past fifteen digits', () => {
    // A sixteenth digit is a typo, not a number. Still refused from `?q=`, but the
    // screen asks again rather than quietly searching the first fifteen of something
    // the person did not type.
    const tooLong = `${BARE}9`;
    expect(isEmiratesIdShaped(tooLong)).toBe(true);
    expect(wholeEmiratesIdDigits(tooLong)).toBeNull();
  });

  it('leaves a name and a record number alone', () => {
    for (const term of ['Juniper', 'MW-000031', '000031', 'Quarry 12', '', '1784']) {
      expect(isEmiratesIdShaped(term)).toBe(false);
      expect(wholeEmiratesIdDigits(term)).toBeNull();
    }
  });

  it('is not whole until there are fifteen digits opening 784', () => {
    expect(wholeEmiratesIdDigits(BARE.slice(0, 14))).toBeNull();
    expect(wholeEmiratesIdDigits(`${BARE}9`)).toBeNull();
    // Fifteen digits that do not open 784 are not one either.
    expect(wholeEmiratesIdDigits('123456789012345')).toBeNull();
    expect(digitsOf('a1b2c3')).toBe('123');
  });
});
