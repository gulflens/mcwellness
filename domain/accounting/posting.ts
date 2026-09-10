import type { Fils, IsoDate } from '../shared';
import { accountByRole, assertBalanced, cr, dr } from './journal';
import type { ChartAccount, DraftLine, JournalDraft } from './types';

/**
 * docs/SPEC/accounting.md section 7, the posting rules: one money event in,
 * one balanced journal draft out, or null when the event posts nothing. The
 * chart is known only by roles (rule 6); amounts are the source row's own and
 * nothing is recomputed. Memos are fixed words: the books name nobody.
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
  | { event: 'credit.refunded'; sourceId: string; occurredOn: IsoDate; allocatedNetFils: Fils };

export const SOURCE_TABLE: Record<MoneyEvent['event'], 'invoice' | 'payment' | 'entitlement'> = {
  'invoice.issued': 'invoice',
  'fee.waived': 'invoice',
  'payment.received': 'payment',
  'credit.consumed': 'entitlement',
  'credit.waived': 'entitlement',
  'credit.expired': 'entitlement',
  'credit.refunded': 'entitlement',
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

export function postingsFor(
  event: MoneyEvent,
  chart: readonly ChartAccount[],
): JournalDraft | null {
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
  }
}
