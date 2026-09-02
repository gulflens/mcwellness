const MRN_PREFIX = 'MW-';
const MRN_MIN_DIGITS = 6;

/** 'MW-000001': the prefix and the number, zero-padded to six digits (more if it needs them). */
export function formatMrn(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error('An MRN number is a positive integer.');
  }
  return `${MRN_PREFIX}${String(n).padStart(MRN_MIN_DIGITS, '0')}`;
}
