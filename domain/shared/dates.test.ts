import { describe, expect, it } from 'vitest';
import { ageOn, displayFromIso, groupDateDigits, isRealDate, isoFromDisplay } from './dates';

describe('ageOn', () => {
  it('counts whole years the way a person does', () => {
    expect(ageOn('2008-09-02', '2026-09-02')).toBe(18);
    expect(ageOn('2008-09-03', '2026-09-02')).toBe(17);
    expect(ageOn('1990-01-31', '2026-01-30')).toBe(35);
  });

  it('refuses a malformed date', () => {
    expect(() => ageOn('yesterday', '2026-09-02')).toThrow('Bad date of birth');
    expect(() => ageOn('2008-09-02', 'today')).toThrow('Bad date.');
  });
});

describe('groupDateDigits', () => {
  it('inserts the slashes as the digits arrive', () => {
    expect(groupDateDigits('')).toBe('');
    expect(groupDateDigits('1')).toBe('1');
    expect(groupDateDigits('12')).toBe('12');
    expect(groupDateDigits('120')).toBe('12/0');
    expect(groupDateDigits('1209')).toBe('12/09');
    expect(groupDateDigits('12091988')).toBe('12/09/1988');
  });

  it('reads the digits through whatever separators arrive, and folds Arabic-Indic', () => {
    expect(groupDateDigits('12/09/1988')).toBe('12/09/1988');
    expect(groupDateDigits('12-09-1988')).toBe('12/09/1988');
    expect(groupDateDigits('١٢٠٩١٩٨٨')).toBe('12/09/1988');
  });

  it('never exceeds eight digits', () => {
    expect(groupDateDigits('120919889999')).toBe('12/09/1988');
  });
});

describe('isRealDate', () => {
  it('accepts a day the calendar has', () => {
    expect(isRealDate(1988, 9, 12)).toBe(true);
    expect(isRealDate(2024, 2, 29)).toBe(true);
  });

  it('refuses a day it does not', () => {
    expect(isRealDate(2026, 2, 31)).toBe(false);
    expect(isRealDate(2026, 2, 29)).toBe(false);
    expect(isRealDate(2026, 13, 1)).toBe(false);
    expect(isRealDate(2026, 0, 1)).toBe(false);
    expect(isRealDate(2026, 4, 31)).toBe(false);
  });
});

describe('isoFromDisplay and displayFromIso', () => {
  it('turns a complete typed date into the stored form', () => {
    expect(isoFromDisplay('12/09/1988')).toBe('1988-09-12');
  });

  it('gives null while the date is incomplete or impossible', () => {
    expect(isoFromDisplay('')).toBe(null);
    expect(isoFromDisplay('12/09/19')).toBe(null);
    expect(isoFromDisplay('31/02/2026')).toBe(null);
  });

  it('turns a stored date back into the typed form, and survives a round trip', () => {
    expect(displayFromIso('1988-09-12')).toBe('12/09/1988');
    expect(displayFromIso('')).toBe('');
    expect(isoFromDisplay(displayFromIso('1988-09-12'))).toBe('1988-09-12');
  });
});
