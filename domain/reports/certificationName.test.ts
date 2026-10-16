import { describe, expect, it } from 'vitest';
import { CERTIFICATION_NAMES, certificationName } from './certificationName';

describe('certificationName', () => {
  it('names a BCIA neurofeedback certification in words, not by its code', () => {
    expect(certificationName('bcia_bcn')).toEqual({
      en: 'BCIA Board Certified in Neurofeedback',
      ar: 'شهادة BCIA المعتمدة في الارتجاع العصبي',
    });
  });

  it('names every code the practice records, in English and in Arabic', () => {
    for (const code of ['bcia_bcn', 'vendor_qeeg', 'degree', 'psychology_degree']) {
      const name = certificationName(code);
      expect(name.en).not.toBe(code);
      expect(name.en).not.toMatch(/_/);
      expect(name.ar).toMatch(/[؀-ۿ]/);
    }
    expect(Object.keys(CERTIFICATION_NAMES).sort()).toEqual([
      'bcia_bcn',
      'degree',
      'psychology_degree',
      'vendor_qeeg',
    ]);
  });

  it('reads a code whatever its case or stray spaces', () => {
    expect(certificationName(' BCIA_BCN ').en).toBe('BCIA Board Certified in Neurofeedback');
  });

  it('prints a certification it has no name for exactly as it was recorded', () => {
    // The column is an open set: a typed title is already words.
    expect(certificationName('Neurofeedback practitioner')).toEqual({
      en: 'Neurofeedback practitioner',
      ar: 'Neurofeedback practitioner',
    });
    expect(certificationName('constructor')).toEqual({ en: 'constructor', ar: 'constructor' });
  });
});
