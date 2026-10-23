import { fils, type Fils, type IsoDate } from '../shared';
import { accountByRole, assertBalanced, cr, dr } from './journal';
import type { ChartAccount, DraftLine, JournalDraft } from './types';

/**
 * docs/SPEC/accounting.md section 7, the posting rules: one money event in,
 * one balanced journal draft out, or null when the event posts nothing. The
 * chart is known only by roles (rule 6); amounts are the source row's own and
 * nothing is recomputed. Memos are fixed words: the books name nobody.
 *
 * **An event worth nothing posts nothing** (`worthNothing`, rule 18). A
 * session given free is an invoice for nought and a credit worth nought; the
 * journal holds no line of nought (rule 1), so there is no entry to write and
 * none is attempted. An event with a figure in it that does not add up is a
 * different thing, and is still refused.
 */

export type MoneyEvent =
  | {
      event: 'invoice.issued';
      sourceId: string;
      occurredOn: IsoDate;
      invoiceKind: 'session' | 'package' | 'call_out_fee' | 'statement' | 'single_session';
      netFils: Fils;
      vatFils: Fils;
      grossFils: Fils;
    }
  | {
      event: 'fee.waived';
      sourceId: string;
      occurredOn: IsoDate;
      netFils: Fils;
      vatFils: Fils;
      grossFils: Fils;
    }
  | {
      event: 'payment.received';
      sourceId: string;
      occurredOn: IsoDate;
      method: 'cash' | 'transfer' | 'link';
      amountFils: Fils;
    }
  | {
      /** A payment recorded in error, cancelled in full on the day it was reversed (419). */
      event: 'payment.reversed';
      sourceId: string;
      occurredOn: IsoDate;
      method: 'cash' | 'transfer' | 'link';
      amountFils: Fils;
    }
  | {
      event: 'credit.consumed';
      sourceId: string;
      occurredOn: IsoDate;
      allocatedNetFils: Fils;
      serviceCode: string;
    }
  | {
      event: 'credit.waived';
      sourceId: string;
      occurredOn: IsoDate;
      allocatedNetFils: Fils;
      serviceCode: string;
      hasReplacement: boolean;
    }
  | { event: 'credit.expired'; sourceId: string; occurredOn: IsoDate; allocatedNetFils: Fils }
  | { event: 'credit.refunded'; sourceId: string; occurredOn: IsoDate; allocatedNetFils: Fils }
  | {
      event: 'credit_note.issued';
      sourceId: string;
      occurredOn: IsoDate;
      invoiceKind: 'session' | 'package' | 'call_out_fee' | 'statement' | 'single_session';
      netFils: Fils;
      vatFils: Fils;
      grossFils: Fils;
      /** The part of the net that comes off sessions owed (2400); the rest was already income. */
      releasedNetFils: Fils;
      /** The corrected invoice's service, for the income the rest of the net reverses. */
      serviceCode: string | null;
    };

export const SOURCE_TABLE: Record<
  MoneyEvent['event'],
  'invoice' | 'payment' | 'entitlement' | 'credit_note'
> = {
  'invoice.issued': 'invoice',
  'fee.waived': 'invoice',
  'payment.received': 'payment',
  'payment.reversed': 'payment',
  'credit.consumed': 'entitlement',
  'credit.waived': 'entitlement',
  'credit.expired': 'entitlement',
  'credit.refunded': 'entitlement',
  'credit_note.issued': 'credit_note',
};

/** The brain map is the one service whose income has its own account. */
const ASSESSMENT_CODE = 'brain-map';

function incomeAccountFor(chart: readonly ChartAccount[], serviceCode: string): ChartAccount {
  return accountByRole(
    chart,
    serviceCode === ASSESSMENT_CODE ? 'income_assessments' : 'income_sessions',
  );
}

function draft(event: MoneyEvent, memo: string, lines: DraftLine[]): JournalDraft {
  assertBalanced(lines);
  return {
    enteredOn: event.occurredOn,
    occurredOn: null,
    kind: 'automatic',
    memo,
    lines,
    source: { table: SOURCE_TABLE[event.event], id: event.sourceId, event: event.event },
  };
}

/**
 * Whether every figure the event carries is nought.
 *
 * Every figure, and not the total alone: an invoice with a total and nothing
 * sold behind it, or with something sold and no total, is a fault in the row
 * and `assertBalanced` must still be given the chance to say so.
 */
function worthNothing(event: MoneyEvent): boolean {
  switch (event.event) {
    case 'invoice.issued':
    case 'fee.waived':
    case 'credit_note.issued':
      return event.grossFils === 0 && event.netFils === 0 && event.vatFils === 0;
    case 'payment.received':
    case 'payment.reversed':
      return event.amountFils === 0;
    case 'credit.consumed':
    case 'credit.waived':
    case 'credit.expired':
    case 'credit.refunded':
      return event.allocatedNetFils === 0;
  }
}

export function postingsFor(
  event: MoneyEvent,
  chart: readonly ChartAccount[],
): JournalDraft | null {
  if (worthNothing(event)) {
    return null;
  }
  switch (event.event) {
    case 'invoice.issued': {
      // A statement invoice is a re-presentation of charges already invoiced
      // (953); it posts nothing and the overview counts it as unknown.
      if (event.invoiceKind === 'statement') {
        return null;
      }
      const receivable = accountByRole(chart, 'receivable');
      const credited =
        event.invoiceKind === 'call_out_fee'
          ? accountByRole(chart, 'income_fees')
          : accountByRole(chart, 'contract_liability');
      const lines = [dr(receivable.id, event.grossFils), cr(credited.id, event.netFils)];
      if (event.vatFils > 0) {
        lines.push(cr(accountByRole(chart, 'vat_payable').id, event.vatFils));
      }
      return draft(
        event,
        event.invoiceKind === 'call_out_fee' ? 'Call-out fee charged' : 'Invoice issued',
        lines,
      );
    }
    case 'fee.waived': {
      const lines = [dr(accountByRole(chart, 'income_fees').id, event.netFils)];
      if (event.vatFils > 0) {
        lines.push(dr(accountByRole(chart, 'vat_payable').id, event.vatFils));
      }
      lines.push(cr(accountByRole(chart, 'receivable').id, event.grossFils));
      return draft(event, 'Call-out fee waived', lines);
    }
    case 'payment.received': {
      const role =
        event.method === 'transfer' ? 'bank' : event.method === 'cash' ? 'cash' : 'link_clearing';
      return draft(event, 'Payment received', [
        dr(accountByRole(chart, role).id, event.amountFils),
        cr(accountByRole(chart, 'receivable').id, event.amountFils),
      ]);
    }
    case 'payment.reversed': {
      const role =
        event.method === 'transfer' ? 'bank' : event.method === 'cash' ? 'cash' : 'link_clearing';
      return draft(event, 'Payment reversed', [
        dr(accountByRole(chart, 'receivable').id, event.amountFils),
        cr(accountByRole(chart, role).id, event.amountFils),
      ]);
    }
    case 'credit.consumed':
      return draft(event, 'Credit used up', [
        dr(accountByRole(chart, 'contract_liability').id, event.allocatedNetFils),
        cr(incomeAccountFor(chart, event.serviceCode).id, event.allocatedNetFils),
      ]);
    case 'credit.waived':
      // Without a replacement credit the consumption stands and nothing is
      // unwound (section 7).
      if (!event.hasReplacement) {
        return null;
      }
      return draft(event, 'Credit restored', [
        dr(incomeAccountFor(chart, event.serviceCode).id, event.allocatedNetFils),
        cr(accountByRole(chart, 'contract_liability').id, event.allocatedNetFils),
      ]);
    case 'credit.expired':
      return draft(event, 'Credit expired', [
        dr(accountByRole(chart, 'contract_liability').id, event.allocatedNetFils),
        cr(accountByRole(chart, 'income_expired').id, event.allocatedNetFils),
      ]);
    case 'credit.refunded':
      return draft(event, 'Credit refunded', [
        dr(accountByRole(chart, 'contract_liability').id, event.allocatedNetFils),
        cr(accountByRole(chart, 'refunds_payable').id, event.allocatedNetFils),
      ]);
    case 'credit_note.issued': {
      // The mirror of the invoice: what was owed in sessions is released from
      // 2400, and the rest of the net had already become income (a call-out
      // fee, or a visit delivered) and is taken back out of it.
      const lines: DraftLine[] = [];
      if (event.releasedNetFils > 0) {
        lines.push(dr(accountByRole(chart, 'contract_liability').id, event.releasedNetFils));
      }
      const incomeFils = fils(event.netFils - event.releasedNetFils);
      if (incomeFils > 0) {
        const income =
          event.invoiceKind === 'call_out_fee'
            ? accountByRole(chart, 'income_fees')
            : incomeAccountFor(chart, event.serviceCode ?? '');
        lines.push(dr(income.id, incomeFils));
      }
      if (event.vatFils > 0) {
        lines.push(dr(accountByRole(chart, 'vat_payable').id, event.vatFils));
      }
      lines.push(cr(accountByRole(chart, 'receivable').id, event.grossFils));
      return draft(event, 'Credit note issued', lines);
    }
  }
}
