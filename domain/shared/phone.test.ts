import { describe, expect, it } from 'vitest';
import { joinE164, splitE164, stripTrunkPrefix } from './phone';

// Synthetic throughout: +971 50 000 xxxx is the reserved fake range.
const CODES = ['+971', '+966', '+1', '+44', '+91'] as const;

describe('stripTrunkPrefix', () => {
  it('drops one leading zero, which is how a mobile is written locally', () => {
    expect(stripTrunkPrefix('0500001234')).toBe('500001234');
  });

  it('drops only one, and leaves a number without it alone', () => {
    expect(stripTrunkPrefix('00500001234')).toBe('0500001234');
    expect(stripTrunkPrefix('500001234')).toBe('500001234');
  });

  it('keeps only digits', () => {
    expect(stripTrunkPrefix('050 000 1234')).toBe('500001234');
  });
});

describe('joinE164', () => {
  it('concatenates the dialling code and the national digits as given', () => {
    expect(joinE164('+971', '500001234')).toBe('+971500001234');
  });

  it('keeps only digits from the national part, but does not strip a leading zero', () => {
    expect(joinE164('+971', '50 000 1234')).toBe('+971500001234');
    // A leading zero is NOT removed here: some national significant numbers
    // legitimately keep one inside E.164 (see the Italian round-trip test
    // below), and joinE164 cannot tell such a value apart from typed input
    // a caller forgot to strip. Stripping typed input is stripTrunkPrefix's
    // job, applied by the caller before joining — see the next test.
    expect(joinE164('+971', '0500001234')).toBe('+9710500001234');
  });

  it('composes what the caller already stripped, via stripTrunkPrefix', () => {
    expect(joinE164('+971', stripTrunkPrefix('0500001234'))).toBe('+971500001234');
  });

  it('gives an empty string when there is no number yet', () => {
    expect(joinE164('+971', '')).toBe('');
  });
});

describe('splitE164', () => {
  it('finds the longest dialling code that prefixes the value', () => {
    expect(splitE164('+971500001234', CODES)).toEqual({
      diallingCode: '+971',
      national: '500001234',
    });
  });

  it('gives null for anything that is not a stored E.164 value', () => {
    expect(splitE164('', CODES)).toBe(null);
    expect(splitE164('0500001234', CODES)).toBe(null);
    expect(splitE164('+99900000000', CODES)).toBe(null);
  });

  it('picks the longest matching dialling code regardless of array order', () => {
    // +1 and +1242 (a structural stand-in for the NANP area-code-as-country
    // schemes) both prefix the value; the longer, more specific code must win
    // no matter which order the codes are listed in.
    expect(splitE164('+12425551234', ['+1', '+1242'])).toEqual({
      diallingCode: '+1242',
      national: '5551234',
    });
    expect(splitE164('+12425551234', ['+1242', '+1'])).toEqual({
      diallingCode: '+1242',
      national: '5551234',
    });
  });

  it('round-trips a national part that legitimately begins with zero', () => {
    // Italian mobiles keep their trunk zero inside E.164 — a structural
    // example, not a real subscriber. A naive joinE164 that stripped a
    // leading zero would turn this into the DIFFERENT valid number
    // +39612345678 without anyone typing anything.
    const value = '+390612345678';
    const parts = splitE164(value, ['+39']);
    expect(parts).toEqual({ diallingCode: '+39', national: '0612345678' });
    expect(joinE164(parts!.diallingCode, parts!.national)).toBe(value);
  });

  it('round-trips: splitting then rejoining reproduces the value exactly, across several dialling-code lengths', () => {
    const codes = [...CODES, '+1242'];
    for (const value of [
      '+971500001234', // +971: 3-digit dialling code
      '+442079460000', // +44: 2-digit dialling code
      '+919999900000', // +91: 2-digit dialling code
      '+12425551234', // +1242: 4-digit dialling code, alongside its own prefix +1
    ]) {
      const parts = splitE164(value, codes);
      expect(parts).not.toBe(null);
      expect(joinE164(parts!.diallingCode, parts!.national)).toBe(value);
    }
  });
});
