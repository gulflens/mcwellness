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
  it('builds the stored form, dropping the local trunk zero', () => {
    expect(joinE164('+971', '0500001234')).toBe('+971500001234');
    expect(joinE164('+971', '50 000 1234')).toBe('+971500001234');
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

  it('round-trips: splitting then rejoining reproduces the value exactly', () => {
    for (const value of ['+971500001234', '+442079460000', '+919999900000']) {
      const parts = splitE164(value, CODES);
      expect(parts).not.toBe(null);
      expect(joinE164(parts!.diallingCode, parts!.national)).toBe(value);
    }
  });
});
