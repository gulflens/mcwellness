/**
 * Whether a payment recorded in error may be reversed (docs/superpowers/specs/
 * 2026-10-23-payment-reversal-design.md): one reversal per payment, in full,
 * and never for an erased client's record.
 *
 * Refusals, in this order: `client_erased`, `already_reversed`.
 *
 * The same rule is mirrored in SQL where the database must hold it
 * (migration 419, `app.reverse_payment`); this is the specification. Pure: no
 * I/O, no clock (.claude/rules/testing.md).
 */

export type ReversalRefusal = 'client_erased' | 'already_reversed';

export type ReversibleResult = { ok: true } | { ok: false; refusal: ReversalRefusal };

export function reversibleFor(payment: {
  reversed: boolean;
  clientErased: boolean;
}): ReversibleResult {
  if (payment.clientErased) return { ok: false, refusal: 'client_erased' };
  if (payment.reversed) return { ok: false, refusal: 'already_reversed' };
  return { ok: true };
}
