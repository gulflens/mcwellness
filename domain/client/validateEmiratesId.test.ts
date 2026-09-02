import { describe, expect, it } from 'vitest';
import { validateEmiratesId } from './validateEmiratesId';

// Both in the reserved 784-1900 range (.claude/rules/testing.md), with a genuine
// Luhn check digit computed by hand, not the seed generator's simpler sum-of-digits
// stand-in (db/seed/generate.ts's emiratesId() is shape-only and need not pass a
// real Luhn check).
const VALID = '784-1900-0000012-6';
const BAD_CHECKSUM = '784-1900-0000012-7'; // last digit off by one from VALID

describe('validateEmiratesId', () => {
  it('accepts a fifteen-digit 784 number with a correct Luhn check digit', () => {
    expect(validateEmiratesId(VALID)).toEqual({ ok: true, normalised: '784190000000126' });
  });

  it('accepts digits written with spaces instead of dashes', () => {
    expect(validateEmiratesId('784 1900 0000012 6')).toEqual({
      ok: true,
      normalised: '784190000000126',
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
    expect(validateEmiratesId('123-1900-0000012-6')).toEqual({ ok: false, reason: 'prefix' });
  });
});
