/**
 * Dirhams in, integer fils out (00-data-model.md section 1: money is an
 * integer number of fils, and a double is never money).
 *
 * The practitioner types what the parking machine charged — "5", "7.50" —
 * not five hundred. Both directions read the whole and fractional parts as
 * integers and only ever add them, so "0.1" becomes 10 exactly rather than
 * through `0.1 * 100`, which is 10.000000000000002 in IEEE 754.
 *
 * **This duplicates app/admin/billing/money.ts, deliberately and
 * temporarily.** That module is the billing stream's and is the one place
 * money is formatted; importing it here would pull `@domain/billing` into
 * the practitioner bundle through its `previewVat`, and
 * docs/SPEC/OWNERSHIP.md rule 3 is explicit that a module never imports
 * another module's `domain/`. The right home for these two pure functions is
 * `domain/shared`, which is exactly what rule 3 says to ask for; the request
 * is docs/CHANGE-REQUESTS/session-capture-02.md, and when it is granted this
 * file becomes a re-export and then goes.
 */

/** A non-negative amount with an optional one- or two-digit fraction: "0", "5", "7.5", "7.50". */
const AED_INPUT = /^(\d+)(?:\.(\d{1,2}))?$/;

/** visit_actuals.parking_cost_fils is a Postgres integer with its own ceiling. */
export const PARKING_MAX_FILS = 100_000;

/** Formats an integer number of fils as a bare figure: "7.50". */
export function formatFilsAsAed(amountFils: number): string {
  const rounded = Math.max(0, Math.round(amountFils));
  return `${Math.floor(rounded / 100).toLocaleString('en-GB')}.${String(rounded % 100).padStart(2, '0')}`;
}

/**
 * Parses a typed amount into exact fils, or null for anything that is not a
 * non-negative amount with at most two decimal places, or is above the
 * column's own ceiling. An empty field is 0: nothing paid is a real answer.
 */
export function parseAedToFils(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return 0;
  const match = AED_INPUT.exec(trimmed);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(whole)) return null;
  const total = whole * 100 + fraction;
  return total > PARKING_MAX_FILS ? null : total;
}
