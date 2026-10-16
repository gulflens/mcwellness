/**
 * The name a person reads for a certification, in place of the code the
 * credential row holds (`credential.certification`, migration 050: an open
 * set of short codes such as `bcia_bcn`).
 *
 * A signed report printed that code as it stood — "bcia_bcn" in the
 * signature block. This is the name to print instead — on a report issued
 * from now on, and never on one already filed: a lost file is rebuilt from
 * its row and must match the hash it was filed with
 * (app/api/reports/get.ts), so an issued report keeps printing what it
 * printed. A report's own body carries no mark yet that tells the two apart;
 * the renderer calls this once one does.
 *
 * The column is an open set, so a value this has no name for is printed
 * exactly as it was recorded: a title someone typed is already words, and a
 * new code is better shown than hidden. Pure.
 *
 * The Arabic names are awaiting a native speaker's check.
 */

export type CertificationName = { readonly en: string; readonly ar: string };

export const CERTIFICATION_NAMES: Readonly<Record<string, CertificationName>> = Object.freeze({
  bcia_bcn: {
    en: 'BCIA Board Certified in Neurofeedback',
    ar: 'شهادة BCIA المعتمدة في الارتجاع العصبي',
  },
  vendor_qeeg: {
    en: 'qEEG certification from the equipment maker',
    ar: 'شهادة qEEG من الشركة المصنّعة للأجهزة',
  },
  degree: { en: 'University degree', ar: 'شهادة جامعية' },
  psychology_degree: { en: 'University degree in psychology', ar: 'شهادة جامعية في علم النفس' },
});

export function certificationName(recorded: string): CertificationName {
  const code = recorded.trim().toLowerCase();
  // Own keys only: a recorded "constructor" is a title, not a prototype's.
  const known = Object.hasOwn(CERTIFICATION_NAMES, code) ? CERTIFICATION_NAMES[code] : undefined;
  return known ?? { en: recorded, ar: recorded };
}
