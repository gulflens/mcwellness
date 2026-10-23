import type { LedgerEntry } from '../../../domain/billing';
import { fils } from '../../../domain/shared';

/**
 * One row of `app.billing_ledger`, with the invoice a payment or credit note
 * names joined on, as the debtors list and the statement both read it.
 */
export type LedgerDbRow = {
  entry_kind: 'charge' | 'payment' | 'credit';
  source_id: string;
  reference: string;
  occurred_on: string;
  amount_fils: number;
  invoice_id: string | null;
};

/**
 * The ledger's signed amount as the allocation rules read it: a charge is its
 * gross, a payment or credit note the (positive) amount that came off. A credit
 * note naming no invoice has nothing to be set against, so it yields nothing —
 * the same rule for every reader of the ledger.
 */
export function ledgerEntry(row: LedgerDbRow): LedgerEntry | null {
  const base = { id: row.source_id, reference: row.reference, on: row.occurred_on };
  if (row.entry_kind === 'charge') {
    return { kind: 'charge', ...base, grossFils: fils(row.amount_fils) };
  }
  if (row.entry_kind === 'payment') {
    return {
      kind: 'payment',
      ...base,
      amountFils: fils(-row.amount_fils),
      invoiceId: row.invoice_id,
    };
  }
  if (row.invoice_id === null) return null;
  return { kind: 'credit', ...base, amountFils: fils(-row.amount_fils), invoiceId: row.invoice_id };
}
