import { describe, expect, it } from 'vitest';
import { groupIban, isValidIban } from './iban';

// The IBAN standard's own documentation examples (ISO 13616 / the SWIFT IBAN
// registry), which name no real account, and one invented UAE-shaped IBAN
// with an all-zero bank code and a sequential account number.
const DOCUMENTATION_EXAMPLES = ['GB82WEST12345698765432', 'DE89370400440532013000'];
const INVENTED_AE = 'AE360000000000000000001';

describe('isValidIban', () => {
  it('accepts the standard’s documentation examples', () => {
    for (const iban of DOCUMENTATION_EXAMPLES) {
      expect(isValidIban(iban)).toBe(true);
    }
  });

  it('accepts the invented UAE IBAN the tests use', () => {
    expect(isValidIban(INVENTED_AE)).toBe(true);
  });

  it('accepts one written in lower case and grouped in fours', () => {
    expect(isValidIban('gb82 west 1234 5698 7654 32')).toBe(true);
  });

  it('refuses the same IBAN with a single digit changed', () => {
    expect(isValidIban('GB82WEST12345698765433')).toBe(false);
    expect(isValidIban('DE89370400440532013001')).toBe(false);
    expect(isValidIban('AE360000000000000000002')).toBe(false);
  });

  it('refuses a wrong check digit', () => {
    expect(isValidIban('AE370000000000000000001')).toBe(false);
  });

  it('refuses characters an IBAN never holds, and an empty string', () => {
    expect(isValidIban('AE36-0000-0000-0000-0000-001')).toBe(false);
    expect(isValidIban('')).toBe(false);
  });
});

// Moved here from a private copy in app/admin/settings/PracticePage.tsx
// (round 61, Task 4): the invoice's bank block and the Settings page print
// the same grouping, so the one function lives beside isValidIban.
describe('groupIban', () => {
  it('groups the stored UAE IBAN in fours', () => {
    expect(groupIban(INVENTED_AE)).toBe('AE36 0000 0000 0000 0000 001');
  });

  it('groups a longer foreign IBAN in fours, the last group short', () => {
    expect(groupIban('GB82WEST12345698765432')).toBe('GB82 WEST 1234 5698 7654 32');
  });

  it('leaves an empty string empty', () => {
    expect(groupIban('')).toBe('');
  });
});
