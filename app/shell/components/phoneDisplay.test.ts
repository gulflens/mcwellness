import { describe, expect, it } from 'vitest';
import { displayPhone } from './phoneDisplay';

describe('displayPhone', () => {
  it('groups a UAE mobile as +971 50 000 0071', () => {
    expect(displayPhone('+971500000071')).toBe('+971 50 000 0071');
  });

  it('groups a UAE landline by its one-digit area code', () => {
    expect(displayPhone('+97140000071')).toBe('+971 4 000 0071');
  });

  it('separates only the dialling code for a number outside the UAE', () => {
    expect(displayPhone('+966500000071')).toBe('+966 500000071');
  });

  it('leaves a UAE number of another shape grouped by its dialling code alone', () => {
    expect(displayPhone('+9718000071')).toBe('+971 8000071');
  });

  it('gives back anything that is not E.164 exactly as stored', () => {
    expect(displayPhone('0500000071')).toBe('0500000071');
    expect(displayPhone('')).toBe('');
  });

  it('only changes what is shown, never the digits', () => {
    for (const stored of ['+971500000071', '+97140000071', '+966500000071']) {
      expect(displayPhone(stored).replace(/ /g, '')).toBe(stored);
    }
  });
});
