import { describe, expect, it } from 'vitest';
import { fils } from '../shared';
import { ageing, openItems, statementLines, type LedgerEntry, type OpenItems } from './ageing';

/**
 * The specification for who owes what and for how long
 * (docs/superpowers/specs/2026-10-23-debtors-design.md, "The allocation,
 * exactly"). Pure: "as at" is always an argument.
 */

const ASOF = '2026-10-23';

function charge(id: string, on: string, gross: number): LedgerEntry {
  return { kind: 'charge', id, reference: `INV-${id}`, on, grossFils: fils(gross) };
}
function payment(id: string, on: string, amount: number, invoiceId: string | null): LedgerEntry {
  return { kind: 'payment', id, reference: `PAY-${id}`, on, amountFils: fils(amount), invoiceId };
}
function credit(id: string, on: string, amount: number, invoiceId: string): LedgerEntry {
  return { kind: 'credit', id, reference: `CN-${id}`, on, amountFils: fils(amount), invoiceId };
}
function openOf(entries: LedgerEntry[], asOf = ASOF) {
  const result = openItems(entries, asOf);
  return { open: result.items.map((item) => item.openFils), credit: result.creditFils };
}

describe('openItems', () => {
  const jan = charge('000001', '2026-01-01', 100);
  const feb = charge('000002', '2026-02-01', 200);

  it('pays the oldest invoice first', () => {
    expect(openOf([jan, feb, payment('1', '2026-02-02', 150, null)])).toEqual({
      open: [150],
      credit: 0,
    });
  });

  it('a payment naming an invoice pays that one first', () => {
    expect(openOf([jan, feb, payment('1', '2026-02-02', 150, '000002')])).toEqual({
      open: [100, 50],
      credit: 0,
    });
  });

  it('a payment made before its invoice still pays it', () => {
    const result = openOf([
      payment('1', '2026-01-01', 300, null),
      charge('000003', '2026-01-05', 300),
    ]);
    expect(result.open).toEqual([]);
    expect(result.credit).toBe(0);
  });

  it('a credit note clears its own invoice', () => {
    const result = openOf([jan, feb, credit('1', '2026-02-02', 100, '000001')]);
    expect(result.open).toEqual([200]);
    expect(result.credit).toBe(0);
  });

  it('what a named payment or credit note leaves over pays the oldest open invoice', () => {
    // 150 against a 100 invoice leaves 50, which pays the oldest open one.
    const viaPayment = openOf([jan, feb, payment('1', '2026-02-02', 150, '000001')]);
    expect(viaPayment.open).toEqual([150]);
    const viaCredit = openOf([jan, feb, credit('1', '2026-02-02', 150, '000001')]);
    expect(viaCredit.open).toEqual([150]);
  });

  it("a payment naming an invoice that isn't in the ledger joins the pool", () => {
    expect(openOf([jan, feb, payment('1', '2026-02-02', 120, 'not-in-ledger')]).open).toEqual([
      180,
    ]);
  });

  it('an overpayment becomes credit and leaves no open invoice', () => {
    const result = openItems([jan, payment('1', '2026-01-02', 130, null)], ASOF);
    expect(result.items).toEqual([]);
    expect(result.creditFils).toBe(30);
  });

  it('entries after the as-at day are ignored', () => {
    const later = payment('1', '2026-03-01', 300, null);
    expect(openOf([jan, feb, later], '2026-02-15').open).toEqual([100, 200]);
    expect(openOf([jan, feb, later], '2026-03-01').open).toEqual([]);
  });

  it('lists only invoices with something still open, oldest first', () => {
    const result = openItems([feb, jan, payment('1', '2026-02-02', 100, null)], ASOF);
    expect(result.items).toEqual([
      { invoiceId: '000002', reference: 'INV-000002', on: '2026-02-01', openFils: 200 },
    ]);
  });
});

describe('ageing', () => {
  function oneAt(daysBeforeAsOf: string) {
    const open: OpenItems = {
      items: [{ invoiceId: 'a', reference: 'INV-000001', on: daysBeforeAsOf, openFils: fils(10) }],
      creditFils: fils(0),
    };
    return ageing(open, '2026-04-01');
  }

  it('buckets by days from the invoice date', () => {
    // asOf 2026-04-01: 30 days -> 03-02, 31 -> 03-01, 60 -> 01-31, 61 -> 01-30, 90 -> 01-01, 91 -> 2025-12-31
    expect(oneAt('2026-03-02').b0to30Fils).toBe(10);
    expect(oneAt('2026-03-01').b31to60Fils).toBe(10);
    expect(oneAt('2026-01-31').b31to60Fils).toBe(10);
    expect(oneAt('2026-01-30').b61to90Fils).toBe(10);
    expect(oneAt('2026-01-01').b61to90Fils).toBe(10);
    expect(oneAt('2025-12-31').over90Fils).toBe(10);
  });

  it('totals what is owed and names the oldest open invoice date', () => {
    const result = ageing(
      {
        items: [
          { invoiceId: 'a', reference: 'INV-000001', on: '2025-12-01', openFils: fils(5) },
          { invoiceId: 'b', reference: 'INV-000002', on: '2026-03-30', openFils: fils(7) },
        ],
        creditFils: fils(0),
      },
      '2026-04-01',
    );
    expect(result.owedFils).toBe(12);
    expect(result.oldestOpenOn).toBe('2025-12-01');
  });

  it('owes nothing and has no oldest date when nothing is open', () => {
    const result = ageing({ items: [], creditFils: fils(40) }, '2026-04-01');
    expect(result.owedFils).toBe(0);
    expect(result.oldestOpenOn).toBeNull();
  });
});

describe('statementLines', () => {
  it('statement lines carry a running balance from the opening balance', () => {
    const entries: LedgerEntry[] = [
      charge('000001', '2026-01-10', 500),
      payment('1', '2026-01-20', 200, null),
      payment('2', '2026-02-05', 100, null),
      charge('000002', '2026-02-05', 300),
      credit('1', '2026-02-20', 50, '000002'),
      charge('000003', '2026-03-05', 999),
    ];
    const result = statementLines(entries, '2026-02-01', '2026-02-28');
    expect(result.openingFils).toBe(300);
    expect(
      result.lines.map((line) => [
        line.reference,
        line.chargedFils,
        line.paidFils,
        line.balanceFils,
      ]),
    ).toEqual([
      ['INV-000002', 300, 0, 600],
      ['PAY-2', 0, 100, 500],
      ['CN-1', 0, 50, 450],
    ]);
    expect(result.closingFils).toBe(450);
  });

  it('shows a negative balance when the household is in credit', () => {
    const result = statementLines(
      [payment('1', '2026-02-05', 80, null)],
      '2026-02-01',
      '2026-02-28',
    );
    expect(result.closingFils).toBe(-80);
  });
});
