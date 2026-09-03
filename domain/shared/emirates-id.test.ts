import { describe, expect, it } from 'vitest';
import { formatEmiratesId, normaliseEmiratesId, toLatinDigits } from './emirates-id';

// Synthetic throughout: the 784-1900 range is reserved for fakes.
const ID = '784-1900-0000001-7';

describe('normaliseEmiratesId', () => {
  it('keeps the fifteen digits and drops the dashes', () => {
    expect(normaliseEmiratesId(ID)).toBe('784190000000017');
    expect(normaliseEmiratesId('784 1900 0000001 7')).toBe('784190000000017');
  });

  it('refuses anything that is not fifteen digits starting 784', () => {
    expect(() => normaliseEmiratesId('784-1900-000000-7')).toThrow('fifteen digits');
    expect(() => normaliseEmiratesId('123-1900-0000001-7')).toThrow('starting 784');
  });

  it('formats the canonical digits back into the display form', () => {
    expect(formatEmiratesId('784190000000017')).toBe(ID);
  });
});

describe('toLatinDigits and Arabic-Indic input', () => {
  it('folds Arabic-Indic and Extended Arabic-Indic digits to Latin, leaving the rest alone', () => {
    expect(toLatinDigits('٧٨٤-١٩٠٠')).toBe('784-1900');
    expect(toLatinDigits('۷۸۴ MW')).toBe('784 MW');
    expect(toLatinDigits('784')).toBe('784');
  });

  it('normalises an Emirates ID typed on an Arabic keyboard exactly as one typed in Latin', () => {
    const latin = normaliseEmiratesId('784-1900-0000013-4');
    expect(normaliseEmiratesId('٧٨٤-١٩٠٠-٠٠٠٠٠١٣-٤')).toBe(latin);
    expect(normaliseEmiratesId('۷۸۴-۱۹۰۰-۰۰۰۰۰۱۳-۴')).toBe(latin);
  });
});
