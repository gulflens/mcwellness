import { describe, expect, it } from 'vitest';
import { fils, type Fils, type IsoDate } from '../shared';
import {
  UnbalancedBooksError,
  accountLedger,
  balanceOf,
  balanceSheet,
  cashFlow,
  cashPosition,
  profitAndLoss,
  trialBalance,
} from './statements';
import type { AccountRole, AccountType, JournalKind, PostedLine } from './types';

/**
 * One small set of books, kept by hand, and every statement read off it
 * (docs/SPEC/accounting.md section 4.5): an opening entry, a package invoice,
 * the payment for it, one credit used up and one expense paid from the bank.
 */

type Side = 'dr' | 'cr';

const ACCOUNTS: Record<
  string,
  { code: string; name: string; type: AccountType; role: AccountRole | null }
> = {
  bank: { code: '1010', name: 'Bank, operating', type: 'asset', role: 'bank' },
  cashBox: { code: '1020', name: 'Cash box', type: 'asset', role: 'cash' },
  link: { code: '1030', name: 'Payment link clearing', type: 'asset', role: 'link_clearing' },
  receivable: { code: '1200', name: 'Accounts receivable', type: 'asset', role: 'receivable' },
  contract: {
    code: '2400',
    name: 'Contract liability, sessions owed',
    type: 'liability',
    role: 'contract_liability',
  },
  vat: { code: '2500', name: 'VAT payable', type: 'liability', role: 'vat_payable' },
  opening: {
    code: '3100',
    name: 'Opening balance equity',
    type: 'equity',
    role: 'opening_balance',
  },
  sessions: { code: '4000', name: 'Session income', type: 'income', role: 'income_sessions' },
  expenses: { code: '6000', name: 'General expenses', type: 'expense', role: null },
};

function line(
  entryNumber: number,
  enteredOn: IsoDate,
  kind: JournalKind,
  memo: string,
  key: keyof typeof ACCOUNTS,
  side: Side,
  amount: number,
): PostedLine {
  const account = ACCOUNTS[key]!;
  return {
    entryId: `0000000e-0000-4000-8000-00000000000${entryNumber}`,
    entryReference: `JE-${String(entryNumber).padStart(6, '0')}`,
    enteredOn,
    kind,
    memo,
    accountId: `0000000e-0000-4000-8000-0000000010${account.code}`,
    accountCode: account.code,
    accountName: account.name,
    accountType: account.type,
    accountRole: account.role,
    debitFils: fils(side === 'dr' ? amount : 0),
    creditFils: fils(side === 'cr' ? amount : 0),
  };
}

const LINES: PostedLine[] = [
  line(1, '2026-01-01', 'opening', 'Opening balances', 'bank', 'dr', 1_000_000),
  line(1, '2026-01-01', 'opening', 'Opening balances', 'opening', 'cr', 1_000_000),
  line(2, '2026-02-01', 'automatic', 'Invoice issued', 'receivable', 'dr', 105_000),
  line(2, '2026-02-01', 'automatic', 'Invoice issued', 'contract', 'cr', 100_000),
  line(2, '2026-02-01', 'automatic', 'Invoice issued', 'vat', 'cr', 5_000),
  line(3, '2026-02-02', 'automatic', 'Payment received', 'bank', 'dr', 105_000),
  line(3, '2026-02-02', 'automatic', 'Payment received', 'receivable', 'cr', 105_000),
  line(4, '2026-02-10', 'automatic', 'Credit used up', 'contract', 'dr', 40_000),
  line(4, '2026-02-10', 'automatic', 'Credit used up', 'sessions', 'cr', 40_000),
  line(5, '2026-02-15', 'manual', 'Office supplies', 'expenses', 'dr', 20_000),
  line(5, '2026-02-15', 'manual', 'Office supplies', 'bank', 'cr', 20_000),
];

function row(rows: readonly { accountCode: string }[], code: string) {
  return rows.find((r) => r.accountCode === code);
}

describe('balanceOf', () => {
  it('reads an account in its natural direction', () => {
    expect(balanceOf('asset', fils(500), fils(200))).toBe(300);
    expect(balanceOf('expense', fils(500), fils(200))).toBe(300);
    expect(balanceOf('liability', fils(200), fils(500))).toBe(300);
    expect(balanceOf('equity', fils(200), fils(500))).toBe(300);
    expect(balanceOf('income', fils(200), fils(500))).toBe(300);
    expect(balanceOf('asset', fils(200), fils(500))).toBe(-300);
  });
});

describe('trialBalance', () => {
  const tb = trialBalance(LINES, '2026-02-28');

  it('agrees side to side at 12,700.00', () => {
    expect(tb.asOf).toBe('2026-02-28');
    expect(tb.totalDebitFils).toBe(1_270_000);
    expect(tb.totalCreditFils).toBe(1_270_000);
  });

  it('reads the bank at 10,850.00 and lists the accounts by code', () => {
    expect(row(tb.rows, '1010')).toEqual({
      accountCode: '1010',
      accountName: 'Bank, operating',
      accountType: 'asset',
      debitFils: 1_105_000,
      creditFils: 20_000,
      balanceFils: 1_085_000,
    });
    expect(tb.rows.map((r) => r.accountCode)).toEqual([
      '1010',
      '1200',
      '2400',
      '2500',
      '3100',
      '4000',
      '6000',
    ]);
  });

  it('takes nothing dated after the day asked for', () => {
    expect(trialBalance(LINES, '2026-01-31').totalDebitFils).toBe(1_000_000);
  });
});

describe('profitAndLoss', () => {
  it('gives income 400.00, expenses 200.00 and a result of 200.00 for February', () => {
    const pl = profitAndLoss(LINES, '2026-02-01', '2026-02-28');
    expect(pl.from).toBe('2026-02-01');
    expect(pl.to).toBe('2026-02-28');
    expect(pl.incomeFils).toBe(40_000);
    expect(pl.expenseFils).toBe(20_000);
    expect(pl.resultFils).toBe(20_000);
    expect(pl.income.map((r) => r.accountCode)).toEqual(['4000']);
    expect(pl.expenses.map((r) => r.accountCode)).toEqual(['6000']);
  });

  it('counts nothing outside the period', () => {
    expect(profitAndLoss(LINES, '2026-01-01', '2026-01-31').resultFils).toBe(0);
  });
});

describe('balanceSheet', () => {
  it('balances, with the year to date computed and retained earnings at zero', () => {
    const bs = balanceSheet(LINES, '2026-02-28', '2026-01-01');
    expect(bs.totalAssetsFils).toBe(1_085_000);
    expect(bs.totalLiabilitiesAndEquityFils).toBe(1_085_000);
    expect(bs.resultYearToDateFils).toBe(20_000);
    expect(bs.retainedEarningsFils).toBe(0);
    expect(bs.assets.map((r) => r.accountCode)).toEqual(['1010', '1200']);
    expect(bs.liabilities.map((r) => r.accountCode)).toEqual(['2400', '2500']);
    expect(bs.equity.map((r) => r.accountCode)).toEqual(['3100']);
  });

  it('keeps retained earnings at zero when the earlier year holds only an equity entry', () => {
    const earlier = LINES.map((l) =>
      l.entryReference === 'JE-000001' ? { ...l, enteredOn: '2025-12-31' } : l,
    );
    const bs = balanceSheet(earlier, '2026-02-28', '2026-01-01');
    expect(bs.retainedEarningsFils).toBe(0);
    expect(bs.totalAssetsFils).toBe(bs.totalLiabilitiesAndEquityFils);
  });

  it('throws rather than show a sheet that does not balance', () => {
    const broken = LINES.filter((l) => !(l.entryReference === 'JE-000001' && l.creditFils > 0));
    expect(() => balanceSheet(broken, '2026-02-28', '2026-01-01')).toThrow(UnbalancedBooksError);
  });
});

describe('cashPosition', () => {
  it('sums the accounts with a cash role and nothing else', () => {
    const position = cashPosition(LINES, '2026-02-28');
    expect(position.accounts.map((r) => r.accountCode)).toEqual(['1010']);
    expect(position.totalFils).toBe(1_085_000);
  });

  it('adds the cash box and the link clearing account to the bank', () => {
    const withMore: PostedLine[] = [
      ...LINES,
      line(6, '2026-02-20', 'automatic', 'Payment received', 'cashBox', 'dr', 30_000),
      line(6, '2026-02-20', 'automatic', 'Payment received', 'receivable', 'cr', 30_000),
      line(7, '2026-02-21', 'automatic', 'Payment received', 'link', 'dr', 12_000),
      line(7, '2026-02-21', 'automatic', 'Payment received', 'receivable', 'cr', 12_000),
    ];
    const position = cashPosition(withMore, '2026-02-28');
    expect(position.accounts.map((r) => r.accountCode)).toEqual(['1010', '1020', '1030']);
    expect(position.totalFils).toBe(1_127_000);
  });
});

describe('cashFlow', () => {
  const cf = cashFlow(LINES, '2026-02-01', '2026-02-28');

  it('classifies the month by what stood on the other side of each entry', () => {
    expect(cf.byCategory.fromHouseholds).toBe(105_000);
    expect(cf.byCategory.forExpenses).toBe(-20_000);
    expect(cf.byCategory.toOwners).toBe(0);
    expect(cf.byCategory.tax).toBe(0);
    expect(cf.byCategory.other).toBe(0);
    expect(cf.byCategory.transfers).toBe(0);
  });

  it('opens at 10,000.00 and closes at 10,850.00', () => {
    expect(cf.openingCashFils).toBe(1_000_000);
    expect(cf.netChangeFils).toBe(85_000);
    expect(cf.closingCashFils).toBe(1_085_000);
    expect(cf.closingCashFils).toBe(cashPosition(LINES, '2026-02-28').totalFils);
  });

  it('nets a transfer between two cash accounts to nothing and lists it separately', () => {
    const withTransfer: PostedLine[] = [
      ...LINES,
      line(6, '2026-02-20', 'manual', 'Cash banked', 'bank', 'dr', 30_000),
      line(6, '2026-02-20', 'manual', 'Cash banked', 'cashBox', 'cr', 30_000),
    ];
    const moved = cashFlow(withTransfer, '2026-02-01', '2026-02-28');
    expect(moved.byCategory.transfers).toBe(0);
    expect(moved.netChangeFils).toBe(85_000);
  });

  it('puts a VAT payment under tax and a share of capital under owners', () => {
    const withMore: PostedLine[] = [
      ...LINES,
      line(6, '2026-02-20', 'manual', 'VAT paid', 'vat', 'dr', 5_000),
      line(6, '2026-02-20', 'manual', 'VAT paid', 'bank', 'cr', 5_000),
      line(7, '2026-02-21', 'manual', 'Capital introduced', 'bank', 'dr', 50_000),
      line(7, '2026-02-21', 'manual', 'Capital introduced', 'opening', 'cr', 50_000),
    ];
    const cash = cashFlow(withMore, '2026-02-01', '2026-02-28');
    expect(cash.byCategory.tax).toBe(-5_000);
    expect(cash.byCategory.toOwners).toBe(50_000);
  });

  it('refuses a period that runs backwards rather than answer it', () => {
    // Opening cash is read the day before `from` and the closing position on
    // `to`; a period whose end precedes its start cannot tie, and rule 17 says
    // a statement that does not tie is an error, never a figure.
    expect(() => cashFlow(LINES, '2026-02-20', '2026-02-05')).toThrow(UnbalancedBooksError);
  });
});

describe('accountLedger', () => {
  it('runs the bank from 10,000.00 through 11,050.00 to 10,850.00', () => {
    const ledger = accountLedger(LINES, '1010', '2026-01-01', '2026-02-28');
    expect(ledger.openingBalanceFils).toBe(0);
    expect(ledger.rows.map((r) => r.runningBalanceFils)).toEqual([1_000_000, 1_105_000, 1_085_000]);
    expect(ledger.rows.map((r) => r.entryReference)).toEqual([
      'JE-000001',
      'JE-000003',
      'JE-000005',
    ]);
    expect(ledger.rows[2]).toMatchObject({
      enteredOn: '2026-02-15',
      memo: 'Office supplies',
      debitFils: 0,
      creditFils: 20_000,
    });
    expect(ledger.closingBalanceFils).toBe(1_085_000);
  });

  it('opens at the balance carried into the period', () => {
    const ledger = accountLedger(LINES, '1010', '2026-02-01', '2026-02-28');
    expect(ledger.openingBalanceFils).toBe(1_000_000);
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.closingBalanceFils).toBe(1_085_000);
  });

  it('gives an account with no movement an empty ledger', () => {
    const ledger = accountLedger(LINES, '1020', '2026-01-01', '2026-02-28');
    expect(ledger.rows).toEqual([]);
    expect(ledger.openingBalanceFils).toBe(0);
    expect(ledger.closingBalanceFils).toBe(0);
  });
});

describe('every amount is an integer number of fils', () => {
  it('keeps the brand through the statements', () => {
    const values: Fils[] = [
      trialBalance(LINES, '2026-02-28').totalDebitFils,
      profitAndLoss(LINES, '2026-02-01', '2026-02-28').resultFils,
      balanceSheet(LINES, '2026-02-28', '2026-01-01').totalAssetsFils,
      cashFlow(LINES, '2026-02-01', '2026-02-28').closingCashFils,
      cashPosition(LINES, '2026-02-28').totalFils,
      accountLedger(LINES, '1010', '2026-01-01', '2026-02-28').closingBalanceFils,
    ];
    for (const value of values) {
      expect(Number.isSafeInteger(value)).toBe(true);
    }
  });
});
