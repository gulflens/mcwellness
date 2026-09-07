import { describe, expect, it } from 'vitest';
import { fils } from '../shared';
import { MissingRoleError, assertBalanced, cr, dr } from './journal';
import { SOURCE_TABLE, postingsFor, type MoneyEvent } from './posting';
import type { AccountRole, AccountType, ChartAccount } from './types';

/**
 * docs/SPEC/accounting.md section 7, one case per row of the table. The chart
 * is synthetic and holds exactly the twelve accounts a role names.
 */
function account(
  suffix: string,
  code: string,
  name: string,
  type: AccountType,
  role: AccountRole,
): ChartAccount {
  return {
    id: `0000000e-0000-4000-8000-0000000010${suffix}`,
    code,
    name,
    nameAr: null,
    type,
    role,
    archivedAt: null,
  };
}

const BANK = account('01', '1010', 'Bank, operating', 'asset', 'bank');
const CASH = account('02', '1020', 'Cash box', 'asset', 'cash');
const LINK = account('03', '1030', 'Payment link clearing', 'asset', 'link_clearing');
const RECEIVABLE = account('04', '1200', 'Accounts receivable', 'asset', 'receivable');
const REFUNDS = account('05', '2100', 'Refunds payable', 'liability', 'refunds_payable');
const CONTRACT = account('06', '2400', 'Contract liability', 'liability', 'contract_liability');
const VAT = account('07', '2500', 'VAT payable', 'liability', 'vat_payable');
const OPENING = account('08', '3100', 'Opening balance equity', 'equity', 'opening_balance');
const SESSIONS = account('09', '4000', 'Session income', 'income', 'income_sessions');
const ASSESSMENTS = account('10', '4100', 'Brain map income', 'income', 'income_assessments');
const FEES = account('11', '4300', 'Call-out fee income', 'income', 'income_fees');
const EXPIRED = account('12', '4400', 'Income from expired credits', 'income', 'income_expired');

const CHART = [
  BANK,
  CASH,
  LINK,
  RECEIVABLE,
  REFUNDS,
  CONTRACT,
  VAT,
  OPENING,
  SESSIONS,
  ASSESSMENTS,
  FEES,
  EXPIRED,
];

const INV = '0000000e-0000-4000-8000-000000002001';
const INV2 = '0000000e-0000-4000-8000-000000002002';
const INV3 = '0000000e-0000-4000-8000-000000002003';
const PAY = '0000000e-0000-4000-8000-000000003001';
const ENT = '0000000e-0000-4000-8000-000000004001';

const PACKAGE_INVOICE: MoneyEvent = {
  event: 'invoice.issued',
  sourceId: INV,
  occurredOn: '2026-09-01',
  invoiceKind: 'package',
  netFils: fils(1_032_500),
  vatFils: fils(51_625),
  grossFils: fils(1_084_125),
};

const PAYMENT: MoneyEvent = {
  event: 'payment.received',
  sourceId: PAY,
  occurredOn: '2026-09-02',
  method: 'transfer',
  amountFils: fils(1_084_125),
};

describe('SOURCE_TABLE', () => {
  it('names the billing table each event comes from', () => {
    expect(SOURCE_TABLE['invoice.issued']).toBe('invoice');
    expect(SOURCE_TABLE['fee.waived']).toBe('invoice');
    expect(SOURCE_TABLE['payment.received']).toBe('payment');
    expect(SOURCE_TABLE['credit.consumed']).toBe('entitlement');
    expect(SOURCE_TABLE['credit.waived']).toBe('entitlement');
    expect(SOURCE_TABLE['credit.expired']).toBe('entitlement');
    expect(SOURCE_TABLE['credit.refunded']).toBe('entitlement');
  });
});

describe('postingsFor', () => {
  it('posts a package invoice to receivable, contract liability and VAT payable', () => {
    const draft = postingsFor(PACKAGE_INVOICE, CHART);
    expect(draft?.kind).toBe('automatic');
    expect(draft?.memo).toBe('Invoice issued');
    expect(draft?.enteredOn).toBe('2026-09-01');
    expect(draft?.occurredOn).toBeNull();
    expect(draft?.source).toEqual({ table: 'invoice', id: INV, event: 'invoice.issued' });
    expect(draft?.lines).toEqual([
      dr(RECEIVABLE.id, fils(1_084_125)),
      cr(CONTRACT.id, fils(1_032_500)),
      cr(VAT.id, fils(51_625)),
    ]);
    expect(() => assertBalanced(draft!.lines)).not.toThrow();
  });

  it('omits the VAT line when VAT is zero', () => {
    const draft = postingsFor(
      {
        event: 'invoice.issued',
        sourceId: INV2,
        occurredOn: '2026-09-01',
        invoiceKind: 'session',
        netFils: fils(45_000),
        vatFils: fils(0),
        grossFils: fils(45_000),
      },
      CHART,
    );
    expect(draft?.lines).toEqual([dr(RECEIVABLE.id, fils(45_000)), cr(CONTRACT.id, fils(45_000))]);
  });

  it('posts a call-out fee to fee income', () => {
    const draft = postingsFor(
      {
        event: 'invoice.issued',
        sourceId: INV3,
        occurredOn: '2026-09-03',
        invoiceKind: 'call_out_fee',
        netFils: fils(10_000),
        vatFils: fils(500),
        grossFils: fils(10_500),
      },
      CHART,
    );
    expect(draft?.memo).toBe('Call-out fee charged');
    expect(draft?.lines).toEqual([
      dr(RECEIVABLE.id, fils(10_500)),
      cr(FEES.id, fils(10_000)),
      cr(VAT.id, fils(500)),
    ]);
  });

  it('posts nothing for a statement invoice', () => {
    expect(
      postingsFor(
        {
          event: 'invoice.issued',
          sourceId: INV3,
          occurredOn: '2026-09-03',
          invoiceKind: 'statement',
          netFils: fils(10_000),
          vatFils: fils(500),
          grossFils: fils(10_500),
        },
        CHART,
      ),
    ).toBeNull();
  });

  it('unwinds a waived call-out fee against fee income and the VAT', () => {
    const draft = postingsFor(
      {
        event: 'fee.waived',
        sourceId: INV3,
        occurredOn: '2026-09-04',
        netFils: fils(10_000),
        vatFils: fils(500),
        grossFils: fils(10_500),
      },
      CHART,
    );
    expect(draft?.memo).toBe('Call-out fee waived');
    expect(draft?.lines).toEqual([
      dr(FEES.id, fils(10_000)),
      dr(VAT.id, fils(500)),
      cr(RECEIVABLE.id, fils(10_500)),
    ]);
  });

  it('omits the VAT line on a waiver of a fee that carried none', () => {
    const draft = postingsFor(
      {
        event: 'fee.waived',
        sourceId: INV3,
        occurredOn: '2026-09-04',
        netFils: fils(10_000),
        vatFils: fils(0),
        grossFils: fils(10_000),
      },
      CHART,
    );
    expect(draft?.lines).toEqual([dr(FEES.id, fils(10_000)), cr(RECEIVABLE.id, fils(10_000))]);
  });

  it('posts a payment to the account its method names', () => {
    expect(postingsFor(PAYMENT, CHART)?.lines).toEqual([
      dr(BANK.id, fils(1_084_125)),
      cr(RECEIVABLE.id, fils(1_084_125)),
    ]);
    expect(postingsFor({ ...PAYMENT, method: 'cash' }, CHART)?.lines[0]).toEqual(
      dr(CASH.id, fils(1_084_125)),
    );
    expect(postingsFor({ ...PAYMENT, method: 'link' }, CHART)?.lines[0]).toEqual(
      dr(LINK.id, fils(1_084_125)),
    );
    expect(postingsFor(PAYMENT, CHART)?.memo).toBe('Payment received');
  });

  it('recognises a consumed credit as session or brain-map income by service code', () => {
    const session = postingsFor(
      {
        event: 'credit.consumed',
        sourceId: ENT,
        occurredOn: '2026-09-05',
        allocatedNetFils: fils(90_000),
        serviceCode: 'nf-session',
      },
      CHART,
    );
    expect(session?.memo).toBe('Credit used up');
    expect(session?.lines).toEqual([dr(CONTRACT.id, fils(90_000)), cr(SESSIONS.id, fils(90_000))]);
    const map = postingsFor(
      {
        event: 'credit.consumed',
        sourceId: ENT,
        occurredOn: '2026-09-05',
        allocatedNetFils: fils(150_000),
        serviceCode: 'brain-map',
      },
      CHART,
    );
    expect(map?.lines).toEqual([dr(CONTRACT.id, fils(150_000)), cr(ASSESSMENTS.id, fils(150_000))]);
  });

  it('restores the liability for a waived credit that has a replacement, and nothing otherwise', () => {
    const restored = postingsFor(
      {
        event: 'credit.waived',
        sourceId: ENT,
        occurredOn: '2026-09-06',
        allocatedNetFils: fils(90_000),
        serviceCode: 'nf-session',
        hasReplacement: true,
      },
      CHART,
    );
    expect(restored?.memo).toBe('Credit restored');
    expect(restored?.lines).toEqual([dr(SESSIONS.id, fils(90_000)), cr(CONTRACT.id, fils(90_000))]);
    expect(
      postingsFor(
        {
          event: 'credit.waived',
          sourceId: ENT,
          occurredOn: '2026-09-06',
          allocatedNetFils: fils(90_000),
          serviceCode: 'nf-session',
          hasReplacement: false,
        },
        CHART,
      ),
    ).toBeNull();
  });

  it('posts an expired credit to expired-credit income and a refunded one to refunds payable', () => {
    const expired = postingsFor(
      {
        event: 'credit.expired',
        sourceId: ENT,
        occurredOn: '2026-12-31',
        allocatedNetFils: fils(90_000),
      },
      CHART,
    );
    expect(expired?.memo).toBe('Credit expired');
    expect(expired?.lines).toEqual([dr(CONTRACT.id, fils(90_000)), cr(EXPIRED.id, fils(90_000))]);
    const refunded = postingsFor(
      {
        event: 'credit.refunded',
        sourceId: ENT,
        occurredOn: '2026-10-01',
        allocatedNetFils: fils(90_000),
      },
      CHART,
    );
    expect(refunded?.memo).toBe('Credit refunded');
    expect(refunded?.lines).toEqual([dr(CONTRACT.id, fils(90_000)), cr(REFUNDS.id, fils(90_000))]);
  });

  it('throws MissingRoleError when the chart lacks a role the event needs', () => {
    expect(() =>
      postingsFor(
        PAYMENT,
        CHART.filter((a) => a.role !== 'bank'),
      ),
    ).toThrow(MissingRoleError);
    expect(() =>
      postingsFor(
        PACKAGE_INVOICE,
        CHART.filter((a) => a.role !== 'contract_liability'),
      ),
    ).toThrow(MissingRoleError);
  });

  it('names no household in any memo', () => {
    const events: MoneyEvent[] = [
      PACKAGE_INVOICE,
      PAYMENT,
      {
        event: 'fee.waived',
        sourceId: INV3,
        occurredOn: '2026-09-04',
        netFils: fils(10_000),
        vatFils: fils(500),
        grossFils: fils(10_500),
      },
      {
        event: 'credit.consumed',
        sourceId: ENT,
        occurredOn: '2026-09-05',
        allocatedNetFils: fils(90_000),
        serviceCode: 'nf-session',
      },
      {
        event: 'credit.waived',
        sourceId: ENT,
        occurredOn: '2026-09-06',
        allocatedNetFils: fils(90_000),
        serviceCode: 'nf-session',
        hasReplacement: true,
      },
      {
        event: 'credit.expired',
        sourceId: ENT,
        occurredOn: '2026-12-31',
        allocatedNetFils: fils(90_000),
      },
      {
        event: 'credit.refunded',
        sourceId: ENT,
        occurredOn: '2026-10-01',
        allocatedNetFils: fils(90_000),
      },
    ];
    for (const event of events) {
      const draft = postingsFor(event, CHART);
      expect(draft, event.event).not.toBeNull();
      expect(draft!.memo).not.toMatch(/[0-9a-f]{8}-/);
      expect(draft!.memo.length).toBeLessThanOrEqual(200);
    }
  });

  it('every draft balances', () => {
    const events: MoneyEvent[] = [
      PACKAGE_INVOICE,
      PAYMENT,
      { ...PAYMENT, method: 'cash' },
      { ...PAYMENT, method: 'link' },
      {
        event: 'fee.waived',
        sourceId: INV3,
        occurredOn: '2026-09-04',
        netFils: fils(10_000),
        vatFils: fils(500),
        grossFils: fils(10_500),
      },
      {
        event: 'credit.consumed',
        sourceId: ENT,
        occurredOn: '2026-09-05',
        allocatedNetFils: fils(90_000),
        serviceCode: 'brain-map',
      },
      {
        event: 'credit.waived',
        sourceId: ENT,
        occurredOn: '2026-09-06',
        allocatedNetFils: fils(90_000),
        serviceCode: 'nf-session',
        hasReplacement: true,
      },
      {
        event: 'credit.expired',
        sourceId: ENT,
        occurredOn: '2026-12-31',
        allocatedNetFils: fils(90_000),
      },
      {
        event: 'credit.refunded',
        sourceId: ENT,
        occurredOn: '2026-10-01',
        allocatedNetFils: fils(90_000),
      },
    ];
    for (const event of events) {
      const draft = postingsFor(event, CHART);
      expect(() => assertBalanced(draft!.lines), event.event).not.toThrow();
    }
  });
});
