import { describe, expect, it } from 'vitest';
import { generateSeed } from '../../db/seed/generate';
import { validateEmiratesId } from './validateEmiratesId';

// Drawn from the seed generator rather than hand-written (.claude/rules/testing.md):
// db/seed/generate.ts's emiratesId() computes a genuine Luhn check digit (via the
// exported luhnCheckDigit()), so a seeded guardian's identifier is valid Emirates ID
// shape and checksum both, not merely shape.
const SEEDED_CONTACT = generateSeed().contacts.find((c) => c.emiratesId !== null);
if (!SEEDED_CONTACT?.emiratesId) {
  throw new Error('The seed has no guardian with an Emirates ID; fixtures below assume one.');
}
const VALID = SEEDED_CONTACT.emiratesId;
const VALID_DIGITS = VALID.replace(/[^0-9]/g, '');
const LAST_DIGIT = Number(VALID_DIGITS.at(-1));
const OFF_BY_ONE = (LAST_DIGIT + 1) % 10;
// Same fifteen digits as VALID, with only the check digit altered by one.
const BAD_CHECKSUM = `${VALID_DIGITS.slice(0, -1)}${OFF_BY_ONE}`;

describe('validateEmiratesId', () => {
  it('accepts a fifteen-digit 784 number with a correct Luhn check digit', () => {
    expect(validateEmiratesId(VALID)).toEqual({ ok: true, normalised: VALID_DIGITS });
  });

  it('accepts digits written with spaces instead of dashes', () => {
    expect(validateEmiratesId(VALID.replace(/-/g, ' '))).toEqual({
      ok: true,
      normalised: VALID_DIGITS,
    });
  });

  it('fails with reason checksum when the last digit is one off', () => {
    expect(validateEmiratesId(BAD_CHECKSUM)).toEqual({ ok: false, reason: 'checksum' });
  });

  it('fails with reason length when there are not fifteen digits', () => {
    expect(validateEmiratesId('784-1900-000001-2')).toEqual({ ok: false, reason: 'length' });
    expect(validateEmiratesId('784-1900-00000123-4')).toEqual({ ok: false, reason: 'length' });
    expect(validateEmiratesId('')).toEqual({ ok: false, reason: 'length' });
  });

  it('fails with reason prefix when the number does not start 784', () => {
    // Same fifteen-digit shape as VALID, wrong prefix; the checksum is never reached.
    expect(validateEmiratesId(`123${VALID_DIGITS.slice(3)}`)).toEqual({
      ok: false,
      reason: 'prefix',
    });
  });
});
