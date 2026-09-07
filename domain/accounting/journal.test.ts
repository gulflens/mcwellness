import { describe, expect, it } from 'vitest';
import { fils } from '../shared';
import {
  MissingRoleError,
  UnbalancedEntryError,
  accountByRole,
  assertBalanced,
  balanceWithOpeningEquity,
  codeMatchesType,
  cr,
  dr,
  mayArchive,
  reversalOf,
} from './journal';
import type { ChartAccount } from './types';

const BANK: ChartAccount = {
  id: '0000000e-0000-4000-8000-000000001010',
  code: '1010',
  name: 'Bank, operating',
  nameAr: null,
  type: 'asset',
  role: 'bank',
  archivedAt: null,
};
const OPENING: ChartAccount = {
  id: '0000000e-0000-4000-8000-000000003100',
  code: '3100',
  name: 'Opening balance equity',
  nameAr: null,
  type: 'equity',
  role: 'opening_balance',
  archivedAt: null,
};
const GENERAL: ChartAccount = {
  id: '0000000e-0000-4000-8000-000000006000',
  code: '6000',
  name: 'General expenses',
  nameAr: null,
  type: 'expense',
  role: null,
  archivedAt: null,
};
const CHART = [BANK, OPENING, GENERAL];

describe('assertBalanced', () => {
  it('accepts an entry whose debits equal its credits', () => {
    expect(() => assertBalanced([dr(BANK.id, fils(500)), cr(OPENING.id, fils(500))])).not.toThrow();
  });
  it('refuses fewer than two lines', () => {
    expect(() => assertBalanced([dr(BANK.id, fils(500))])).toThrow(UnbalancedEntryError);
  });
  it('refuses unequal sides', () => {
    expect(() => assertBalanced([dr(BANK.id, fils(500)), cr(OPENING.id, fils(400))])).toThrow(
      UnbalancedEntryError,
    );
  });
  it('refuses a line with both sides or neither side', () => {
    expect(() =>
      assertBalanced([
        { accountId: BANK.id, debitFils: fils(5), creditFils: fils(5) },
        cr(OPENING.id, fils(0)),
      ]),
    ).toThrow(UnbalancedEntryError);
  });
});

describe('reversalOf', () => {
  it('swaps every line and keeps the order', () => {
    expect(reversalOf([dr(BANK.id, fils(500)), cr(OPENING.id, fils(500))])).toEqual([
      cr(BANK.id, fils(500)),
      dr(OPENING.id, fils(500)),
    ]);
  });
});

describe('accountByRole', () => {
  it('finds the account with the role and throws when it is missing', () => {
    expect(accountByRole(CHART, 'bank')).toBe(BANK);
    expect(() => accountByRole(CHART, 'receivable')).toThrow(MissingRoleError);
  });
});

describe('codeMatchesType', () => {
  it('matches the first digit to the type', () => {
    expect(codeMatchesType('1010', 'asset')).toBe(true);
    expect(codeMatchesType('2400', 'liability')).toBe(true);
    expect(codeMatchesType('3000', 'equity')).toBe(true);
    expect(codeMatchesType('4000', 'income')).toBe(true);
    expect(codeMatchesType('5000', 'expense')).toBe(true);
    expect(codeMatchesType('6200', 'expense')).toBe(true);
    expect(codeMatchesType('4000', 'expense')).toBe(false);
    expect(codeMatchesType('101', 'asset')).toBe(false);
    expect(codeMatchesType('7000', 'expense')).toBe(false);
  });
});

describe('mayArchive', () => {
  it('allows a roleless account with a zero balance and nothing else', () => {
    expect(mayArchive(GENERAL, fils(0))).toBe(true);
    expect(mayArchive(GENERAL, fils(1))).toBe(false);
    expect(mayArchive(BANK, fils(0))).toBe(false);
    expect(mayArchive({ ...GENERAL, archivedAt: '2026-09-07T00:00:00Z' }, fils(0))).toBe(false);
  });
});

describe('balanceWithOpeningEquity', () => {
  it('adds one credit line on the opening-balance account for a debit-heavy draft', () => {
    const out = balanceWithOpeningEquity([dr(BANK.id, fils(10_000))], CHART);
    expect(out).toEqual([dr(BANK.id, fils(10_000)), cr(OPENING.id, fils(10_000))]);
  });
  it('adds one debit line when credits exceed debits', () => {
    const out = balanceWithOpeningEquity([cr(GENERAL.id, fils(300))], CHART);
    expect(out.at(-1)).toEqual(dr(OPENING.id, fils(300)));
  });
  it('returns the lines unchanged when they already balance', () => {
    const lines = [dr(BANK.id, fils(5)), cr(OPENING.id, fils(5))];
    expect(balanceWithOpeningEquity(lines, CHART)).toEqual(lines);
  });
});
