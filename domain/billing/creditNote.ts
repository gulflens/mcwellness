/**
 * What a credit note may credit, and the VAT on it (docs/superpowers/specs/
 * 2026-10-22-credit-notes-design.md): a credit note corrects an issued
 * invoice, and the question is how much of it still stands to be corrected.
 *
 *   - A call-out fee, or a session already delivered: the whole invoice,
 *     taken back from income.
 *   - A sold-ahead session whose credit is unused (or a delivered visit's
 *     invoice whose credit a void restored): the whole invoice, taken back
 *     from sessions owed, and that credit is closed as `credited`.
 *   - A package: only what the client has not used, at the net each credit
 *     was allocated (so a discounted package is credited at its discounted
 *     rate), with the VAT in the same proportion.
 *   - A session whose credit was refunded or has expired: nothing — refused
 *     as `nothing_left`, so a refund is never followed by a note for the same
 *     money.
 *
 * The same rules are mirrored in SQL where the database must hold them; this
 * is the specification. Pure: no I/O, no clock (.claude/rules/testing.md).
 */

import { fils, type Fils } from '../shared';
import type { EntitlementStatus } from './balance';

export type CreditableInvoice = {
  id: string;
  kind: 'session' | 'package' | 'call_out_fee' | 'statement' | 'single_session';
  waived: boolean;
  alreadyCredited: boolean;
  clientErased: boolean;
  lines: readonly { id: string; netFils: Fils; vatFils: Fils }[];
};

/** A credit sold on the invoice, reduced to what this rule needs. */
export type CreditableCredit = {
  id: string;
  status: EntitlementStatus;
  allocatedNetFils: Fils;
};

export type CreditRefusal =
  'statement' | 'waived' | 'already_credited' | 'nothing_left' | 'client_erased';

export type CreditPlan = {
  lines: { invoiceLineId: string; netFils: Fils; vatFils: Fils; grossFils: Fils }[];
  netFils: Fils;
  vatFils: Fils;
  grossFils: Fils;
  /** The part debited to sessions owed rather than to income. */
  releasedNetFils: Fils;
  /** Available credits that become `credited`. */
  creditedEntitlementIds: string[];
};

/**
 * The VAT on part of a line: the line's VAT in proportion to the net being
 * credited, in integer fils, rounding half away from zero (inputs are
 * non-negative) and never more than the line's own VAT. A line with no net
 * carries no VAT.
 */
export function proportionalVat(lineVatFils: Fils, lineNetFils: Fils, creditedNetFils: Fils): Fils {
  if (lineNetFils <= 0) {
    return fils(0);
  }
  const share = Math.floor((2 * lineVatFils * creditedNetFils + lineNetFils) / (2 * lineNetFils));
  return fils(Math.min(lineVatFils, share));
}

function planFor(
  invoice: CreditableInvoice,
  netByLine: readonly Fils[],
  releasedNetFils: Fils,
  creditedEntitlementIds: string[],
  exactVat: boolean,
): CreditPlan {
  let net = 0;
  let vat = 0;
  const lines = invoice.lines.map((line, index) => {
    const lineNet = netByLine[index] ?? fils(0);
    const lineVat = exactVat ? line.vatFils : proportionalVat(line.vatFils, line.netFils, lineNet);
    net += lineNet;
    vat += lineVat;
    return {
      invoiceLineId: line.id,
      netFils: lineNet,
      vatFils: lineVat,
      grossFils: fils(lineNet + lineVat),
    };
  });
  return {
    lines,
    netFils: fils(net),
    vatFils: fils(vat),
    grossFils: fils(net + vat),
    releasedNetFils,
    creditedEntitlementIds,
  };
}

/** What a credit note on this invoice may credit, or why it may not. */
export function creditableFor(
  invoice: CreditableInvoice,
  credits: readonly CreditableCredit[],
): { ok: true; plan: CreditPlan } | { ok: false; refusal: CreditRefusal } {
  if (invoice.clientErased) return { ok: false, refusal: 'client_erased' };
  if (invoice.kind === 'statement') return { ok: false, refusal: 'statement' };
  if (invoice.waived) return { ok: false, refusal: 'waived' };
  if (invoice.alreadyCredited) return { ok: false, refusal: 'already_credited' };

  const wholeNets = invoice.lines.map((line) => line.netFils);
  const available = credits.filter((credit) => credit.status === 'available');

  if (invoice.kind === 'package') {
    let remaining = available.reduce((total, credit) => total + credit.allocatedNetFils, 0);
    if (remaining <= 0) return { ok: false, refusal: 'nothing_left' };
    // Spread what is unused over the lines in order, no line more than its net.
    const nets = invoice.lines.map((line) => {
      const taken = Math.min(remaining, line.netFils);
      remaining -= taken;
      return fils(taken);
    });
    const released = fils(nets.reduce((total, net) => total + net, 0));
    return {
      ok: true,
      plan: planFor(
        invoice,
        nets,
        released,
        available.map((credit) => credit.id),
        false,
      ),
    };
  }

  // A session whose credit was refunded or lapsed has nothing left to
  // correct: the refund already gave the money back, and crediting the
  // invoice as well would give it back twice (an expired credit is the
  // practice's to have kept). Only when no credit on it is still available.
  if (
    (invoice.kind === 'single_session' || invoice.kind === 'session') &&
    available.length === 0 &&
    credits.some((credit) => credit.status === 'refunded' || credit.status === 'expired')
  ) {
    return { ok: false, refusal: 'nothing_left' };
  }

  // A sold-ahead session whose credit is still unused, or a delivered-visit
  // invoice whose credit a void gave back (migration 969 writes an available
  // replacement on the same invoice): the whole net comes off sessions owed.
  if ((invoice.kind === 'single_session' || invoice.kind === 'session') && available.length > 0) {
    const released = fils(wholeNets.reduce((total, net) => total + net, 0));
    return {
      ok: true,
      plan: planFor(
        invoice,
        wholeNets,
        released,
        available.map((credit) => credit.id),
        false,
      ),
    };
  }

  // Call-out fee, delivered session, or a sold-ahead session already used:
  // the whole invoice, and the VAT exactly as it was charged.
  return { ok: true, plan: planFor(invoice, wholeNets, fils(0), [], true) };
}
