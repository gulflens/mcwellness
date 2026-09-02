const MRN_PATTERN = /^MW-(\d+)$/;

/** The number back from 'MW-000001', or null when the string is not exactly that shape. */
export function parseMrn(s: string): number | null {
  const match = MRN_PATTERN.exec(s);
  const digits = match?.[1];
  if (digits === undefined) {
    return null;
  }
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}
