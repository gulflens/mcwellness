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
 * That losslessness is why `joinE164` is pure composition and never strips a
 * leading zero: some countries' national significant numbers legitimately
 * keep one inside E.164 (Italian mobiles are the standard example — see the
 * test file's `+390612345678` case). Stripping a trunk zero someone TYPED is
 * a different question, answered by `stripTrunkPrefix`, and it is the
 * caller's decision to apply it, made where the typing happens — not
 * `joinE164`'s to make on a value that might equally be a stored remainder
 * handed back by `splitE164`.
 *
 * Pure and browser-safe: no I/O, no Node built-in.
 */

/**
 * Removes a trunk zero from what a PERSON TYPED. A UAE mobile is written
 * `050 000 1234` on a card and `500001234` in E.164; exactly one leading zero
 * goes, because a second is a typo rather than a convention. Apply this to
 * typed input before calling `joinE164` — `joinE164` itself never strips a
 * leading zero, because a value it is given might be a stored remainder that
 * legitimately keeps one (see the module docstring).
 */
export function stripTrunkPrefix(national: string): string {
  const digits = national.replace(/[^0-9]/g, '');
  return digits.startsWith('0') ? digits.slice(1) : digits;
}

/**
 * The stored form: concatenates `diallingCode` with the digits of `national`,
 * unchanged. Never removes a leading zero — some national significant numbers
 * legitimately keep one inside E.164, and this function cannot tell such a
 * number apart from one a caller forgot to strip. Empty in, empty out — an
 * optional number stays optional.
 */
export function joinE164(diallingCode: string, national: string): string {
  const digits = national.replace(/[^0-9]/g, '');
  if (digits === '') return '';
  return `${diallingCode}${digits}`;
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
