/**
 * Who owes the practice what, and for how long
 * (docs/superpowers/specs/2026-10-23-debtors-design.md). The ledger is
 * read as one pass over every entry up to the as-at day, not replayed day by
 * day, so a payment made before its invoice existed still pays it.
 *
 * Pure: no I/O, and "as at" is always an argument (.claude/rules/testing.md).
 */

import { fils, type Fils, type IsoDate } from '../shared';
import { daysBetween } from './expiry';

export type LedgerEntry =
  | { kind: 'charge'; id: string; reference: string; on: IsoDate; grossFils: Fils }
  | {
      kind: 'payment';
      id: string;
      reference: string;
      on: IsoDate;
      amountFils: Fils;
      invoiceId: string | null;
    }
  | {
      kind: 'credit';
      id: string;
      reference: string;
      on: IsoDate;
      amountFils: Fils;
      invoiceId: string;
    }
  | {
      /** A payment recorded in error, cancelled in full on the day it was reversed. */
      kind: 'reversal';
      id: string;
      reference: string;
      on: IsoDate;
      paymentId: string;
      amountFils: Fils;
    };

export type OpenItem = { invoiceId: string; reference: string; on: IsoDate; openFils: Fils };

/** Open invoices or credit, never both non-zero. */
export type OpenItems = { items: OpenItem[]; creditFils: Fils };

export type Ageing = {
  b0to30Fils: Fils;
  b31to60Fils: Fils;
  b61to90Fils: Fils;
  over90Fils: Fils;
  owedFils: Fils;
  oldestOpenOn: IsoDate | null;
};

export type StatementLine = {
  on: IsoDate;
  reference: string;
  kind: 'charge' | 'payment' | 'credit' | 'reversal';
  chargedFils: Fils;
  paidFils: Fils;
  balanceFils: Fils;
};

function byDateThenReference(
  a: { on: IsoDate; reference: string },
  b: { on: IsoDate; reference: string },
): number {
  if (a.on !== b.on) return a.on < b.on ? -1 : 1;
  if (a.reference === b.reference) return 0;
  return a.reference < b.reference ? -1 : 1;
}

/**
 * The six-step allocation: every invoice starts open at its gross; credit
 * notes go against their own invoice; named payments go against theirs,
 * oldest first; whatever is not used (unnamed payments, the excess of named
 * ones, anything naming an invoice not in the ledger) forms one pool that
 * pays the open invoices oldest first; what the pool has left is credit.
 */
export function openItems(entries: readonly LedgerEntry[], asOf: IsoDate): OpenItems {
  const dated = entries.filter((entry) => entry.on <= asOf);
  // A payment reversed by the as-at day is as if it was never made, and its
  // reversal with it; as at an earlier day the payment still counts.
  const reversed = new Set<string>();
  for (const entry of dated) {
    if (entry.kind === 'reversal') reversed.add(entry.paymentId);
  }
  const upTo = dated
    .filter(
      (entry) => entry.kind !== 'reversal' && !(entry.kind === 'payment' && reversed.has(entry.id)),
    )
    .sort(byDateThenReference);

  const invoices = new Map<string, OpenItem>();
  for (const entry of upTo) {
    if (entry.kind === 'charge') {
      invoices.set(entry.id, {
        invoiceId: entry.id,
        reference: entry.reference,
        on: entry.on,
        openFils: entry.grossFils,
      });
    }
  }

  let pool = 0;
  const applyTo = (invoiceId: string | null, amount: number): void => {
    const invoice = invoiceId === null ? undefined : invoices.get(invoiceId);
    if (!invoice) {
      pool += amount;
      return;
    }
    const used = Math.min(amount, invoice.openFils);
    invoice.openFils = fils(invoice.openFils - used);
    pool += amount - used;
  };

  // Step 2, then step 3 (entries are already oldest first).
  for (const entry of upTo) {
    if (entry.kind === 'credit') applyTo(entry.invoiceId, entry.amountFils);
  }
  for (const entry of upTo) {
    if (entry.kind === 'payment') applyTo(entry.invoiceId, entry.amountFils);
  }

  // Steps 4 and 5: the pool pays the open invoices oldest first.
  const items = [...invoices.values()].sort(byDateThenReference);
  for (const item of items) {
    const used = Math.min(pool, item.openFils);
    item.openFils = fils(item.openFils - used);
    pool -= used;
  }

  return { items: items.filter((item) => item.openFils > 0), creditFils: fils(pool) };
}

/** The open invoices in four age bands, counted in days from the invoice date. */
export function ageing(open: OpenItems, asOf: IsoDate): Ageing {
  let b0to30 = 0;
  let b31to60 = 0;
  let b61to90 = 0;
  let over90 = 0;
  let oldestOpenOn: IsoDate | null = null;

  for (const item of open.items) {
    const days = daysBetween(item.on, asOf);
    if (days <= 30) b0to30 += item.openFils;
    else if (days <= 60) b31to60 += item.openFils;
    else if (days <= 90) b61to90 += item.openFils;
    else over90 += item.openFils;
    if (oldestOpenOn === null || item.on < oldestOpenOn) oldestOpenOn = item.on;
  }

  return {
    b0to30Fils: fils(b0to30),
    b31to60Fils: fils(b31to60),
    b61to90Fils: fils(b61to90),
    over90Fils: fils(over90),
    owedFils: fils(b0to30 + b31to60 + b61to90 + over90),
    oldestOpenOn,
  };
}

/**
 * A statement of account for `from` to `to` inclusive: the balance carried in
 * from before `from`, each entry with a running balance, and the closing
 * balance. A credit note counts as paid; a reversal counts as charged. Negative means the household is in credit.
 */
export function statementLines(
  entries: readonly LedgerEntry[],
  from: IsoDate,
  to: IsoDate,
): { openingFils: number; lines: StatementLine[]; closingFils: number } {
  const signed = (entry: LedgerEntry): { charged: number; paid: number } =>
    entry.kind === 'charge'
      ? { charged: entry.grossFils, paid: 0 }
      : entry.kind === 'reversal'
        ? { charged: entry.amountFils, paid: 0 }
        : { charged: 0, paid: entry.amountFils };

  let opening = 0;
  for (const entry of entries) {
    if (entry.on < from) {
      const { charged, paid } = signed(entry);
      opening += charged - paid;
    }
  }

  let balance = opening;
  const lines: StatementLine[] = entries
    .filter((entry) => entry.on >= from && entry.on <= to)
    .sort(byDateThenReference)
    .map((entry) => {
      const { charged, paid } = signed(entry);
      balance += charged - paid;
      return {
        on: entry.on,
        reference: entry.reference,
        kind: entry.kind,
        chargedFils: fils(charged),
        paidFils: fils(paid),
        balanceFils: fils(balance),
      };
    });

  return { openingFils: opening, lines, closingFils: balance };
}
