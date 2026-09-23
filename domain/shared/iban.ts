/**
 * The IBAN's own check (ISO 13616 / ISO 7064 mod 97-10): uppercase, spaces
 * removed, the first four characters moved to the end, each letter read as
 * 10 to 35, and the whole number taken modulo 97 — valid when that leaves 1.
 * It catches a mistyped or transposed digit, which the shape alone cannot.
 *
 * The remainder is carried a few digits at a time, so the number is never
 * held whole and nothing overflows. Pure; the shape (country, check digits,
 * length) is checked separately, by the schema and by the column (924).
 */
export function isValidIban(iban: string): boolean {
  const compact = iban.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z0-9]{5,}$/.test(compact)) {
    return false;
  }
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let digits = '';
  for (const char of rearranged) {
    digits += char >= 'A' && char <= 'Z' ? String(char.charCodeAt(0) - 55) : char;
  }
  let remainder = 0;
  for (let index = 0; index < digits.length; index += 7) {
    remainder = Number(`${remainder}${digits.slice(index, index + 7)}`) % 97;
  }
  return remainder === 1;
}
