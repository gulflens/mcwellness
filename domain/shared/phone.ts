/**
 * A phone number's two halves, and the one rule that makes joining them safe.
 *
 * Stored numbers are E.164 — a plus, then seven to fifteen digits — which is
 * what `contact.phone`'s check constraint holds (db/migrations/060_client.sql)
 * and what the routes accept. Nothing here rewrites a stored value: the split
 * is a display decision, and rejoining what was split reproduces the original
 * byte for byte, so a number whose country was guessed wrong is still the same
 * number.
 *
 * Pure and browser-safe: no I/O, no Node built-in.
 */

/**
 * A national number with its trunk prefix removed. A UAE mobile is written
 * `050 000 1234` on a card and `+971500001234` in E.164; concatenating the
 * written form yields `+9710500001234`, which looks plausible and cannot be
 * dialled. Exactly one leading zero goes, because a second is a typo rather
 * than a convention.
 */
export function stripTrunkPrefix(national: string): string {
  const digits = national.replace(/[^0-9]/g, '');
  return digits.startsWith('0') ? digits.slice(1) : digits;
}

/** The stored form. Empty in, empty out — an optional number stays optional. */
export function joinE164(diallingCode: string, national: string): string {
  const rest = stripTrunkPrefix(national);
  if (rest === '') return '';
  return `${diallingCode}${rest}`;
}

/**
 * The stored value as a country and a remainder, by longest matching dialling
 * code. `+1` is shared by more than twenty places and E.164 records which one
 * nowhere, so the country shown beside such a number is a guess; the number is
 * not, and `joinE164` puts it back unchanged.
 */
export function splitE164(
  value: string,
  codes: readonly string[],
): { diallingCode: string; national: string } | null {
  if (!/^\+[1-9][0-9]{6,14}$/.test(value)) return null;
  let best: string | null = null;
  for (const code of codes) {
    if (value.startsWith(code) && (best === null || code.length > best.length)) best = code;
  }
  if (best === null) return null;
  return { diallingCode: best, national: value.slice(best.length) };
}
