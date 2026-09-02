import { describe, expect, it } from 'vitest';
import { formatEmiratesId, normaliseEmiratesId } from './emirates-id';

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
