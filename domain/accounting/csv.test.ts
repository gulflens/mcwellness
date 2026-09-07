import { describe, expect, it } from 'vitest';
import { fils } from '../shared';
import {
  ZOHO_ACCOUNT_HEADINGS,
  ZOHO_JOURNAL_HEADINGS,
  amountCell,
  escapeCell,
  filsToDecimal,
  toCsv,
  zohoAccountRows,
  zohoJournalRows,
} from './csv';
import type { ChartAccount, PostedLine } from './types';

const LINES: PostedLine[] = [
  {
    entryId: '0000000e-0000-4000-8000-000000000001',
    entryReference: 'JE-000001',
    enteredOn: '2026-02-01',
    kind: 'manual',
    memo: 'Supplies, tea and "biscuits"',
    accountId: '0000000e-0000-4000-8000-000000006000',
    accountCode: '6000',
    accountName: 'General expenses',
    accountType: 'expense',
    accountRole: null,
    debitFils: fils(20_000),
    creditFils: fils(0),
  },
  {
    entryId: '0000000e-0000-4000-8000-000000000001',
    entryReference: 'JE-000001',
    enteredOn: '2026-02-01',
    kind: 'manual',
    memo: 'Supplies, tea and "biscuits"',
    accountId: '0000000e-0000-4000-8000-000000001010',
    accountCode: '1010',
    accountName: 'Bank, operating',
    accountType: 'asset',
    accountRole: 'bank',
    debitFils: fils(0),
    creditFils: fils(20_000),
  },
];

const CHART: ChartAccount[] = [
  {
    id: '0000000e-0000-4000-8000-000000001010',
    code: '1010',
    name: 'Bank, operating',
    nameAr: null,
    type: 'asset',
    role: 'bank',
    archivedAt: null,
  },
  {
    id: '0000000e-0000-4000-8000-000000001020',
    code: '1020',
    name: 'Cash box',
    nameAr: null,
    type: 'asset',
    role: 'cash',
    archivedAt: null,
  },
  {
    id: '0000000e-0000-4000-8000-000000001500',
    code: '1500',
    name: 'Equipment, at cost',
    nameAr: null,
    type: 'asset',
    role: null,
    archivedAt: null,
  },
  {
    id: '0000000e-0000-4000-8000-000000002400',
    code: '2400',
    name: 'Contract liability, sessions owed',
    nameAr: null,
    type: 'liability',
    role: 'contract_liability',
    archivedAt: null,
  },
  {
    id: '0000000e-0000-4000-8000-000000003100',
    code: '3100',
    name: 'Opening balance equity',
    nameAr: null,
    type: 'equity',
    role: 'opening_balance',
    archivedAt: null,
  },
  {
    id: '0000000e-0000-4000-8000-000000004000',
    code: '4000',
    name: 'Session income',
    nameAr: null,
    type: 'income',
    role: 'income_sessions',
    archivedAt: null,
  },
  {
    id: '0000000e-0000-4000-8000-000000006000',
    code: '6000',
    name: 'General expenses',
    nameAr: null,
    type: 'expense',
    role: null,
    archivedAt: null,
  },
];

describe('escapeCell', () => {
  it('opens a text field that would be a formula with a quotation of its own', () => {
    for (const opener of ['=', '+', '-', '@', '\t', '\r']) {
      expect(escapeCell(`${opener}SUM(A1)`, 'text')).toContain(`'${opener}`);
    }
    expect(escapeCell('=1+1', 'text')).toBe("'=1+1");
    expect(escapeCell('@import', 'text')).toBe("'@import");
  });

  it('leaves an amount alone, however it begins', () => {
    expect(escapeCell(filsToDecimal(-5), 'amount')).toBe('-0.05');
    expect(escapeCell(filsToDecimal(-123_456), 'amount')).toBe('-1234.56');
    expect(escapeCell(filsToDecimal(0), 'amount')).toBe('0.00');
  });

  it('leaves ordinary text where it is', () => {
    expect(escapeCell('Bank, operating', 'text')).toBe('"Bank, operating"');
    expect(escapeCell('General expenses', 'text')).toBe('General expenses');
  });

  it('quotes what it has guarded, when the field needs quoting too', () => {
    expect(escapeCell('=1+1,2', 'text')).toBe('"\'=1+1,2"');
    expect(escapeCell('\tone\ttwo', 'text')).toBe("'\tone\ttwo");
  });
});

describe('toCsv', () => {
  it('separates rows with a carriage return and a line feed and ends with one', () => {
    expect(toCsv([['a', 'b'], ['c']])).toBe('a,b\r\nc\r\n');
  });

  it('guards a text field that would be a formula, and never an amount', () => {
    expect(toCsv([['=cmd|calc', amountCell(-5)]])).toBe("'=cmd|calc,-0.05\r\n");
    expect(toCsv([['-Reversed, by hand', amountCell(-123_456)]])).toBe(
      '"\'-Reversed, by hand",-1234.56\r\n',
    );
  });

  it('quotes a field holding a comma, a quotation mark or a line break', () => {
    expect(toCsv([['plain', 'has, comma']])).toBe('plain,"has, comma"\r\n');
    expect(toCsv([['say "hello"']])).toBe('"say ""hello"""\r\n');
    expect(toCsv([['two\nlines']])).toBe('"two\nlines"\r\n');
  });

  it('writes an empty table as nothing at all', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('filsToDecimal', () => {
  it('writes fils as a plain decimal with no grouping', () => {
    expect(filsToDecimal(123_456)).toBe('1234.56');
    expect(filsToDecimal(0)).toBe('0.00');
    expect(filsToDecimal(-5)).toBe('-0.05');
    expect(filsToDecimal(-123_456)).toBe('-1234.56');
    expect(filsToDecimal(5)).toBe('0.05');
  });
});

describe('zohoJournalRows', () => {
  const rows = zohoJournalRows(LINES);

  it('opens with the template headings', () => {
    expect(rows[0]).toEqual([...ZOHO_JOURNAL_HEADINGS]);
    expect(ZOHO_JOURNAL_HEADINGS).toEqual([
      'Journal Date',
      'Reference Number',
      'Notes',
      'Account',
      'Debit',
      'Credit',
    ]);
  });

  it('writes one row per line, the day as YYYY-MM-DD and both sides as amounts', () => {
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual([
      '2026-02-01',
      'JE-000001',
      'Supplies, tea and "biscuits"',
      'General expenses',
      amountCell(20_000),
      amountCell(0),
    ]);
    expect(rows[2]).toEqual([
      '2026-02-01',
      'JE-000001',
      'Supplies, tea and "biscuits"',
      'Bank, operating',
      amountCell(0),
      amountCell(20_000),
    ]);
  });

  it('survives the quoting when it becomes a file', () => {
    const csv = toCsv(rows);
    expect(csv.split('\r\n')[0]).toBe('Journal Date,Reference Number,Notes,Account,Debit,Credit');
    expect(csv).toContain('"Supplies, tea and ""biscuits"""');
  });
});

describe('zohoAccountRows', () => {
  const rows = zohoAccountRows(CHART);

  it('opens with the template headings', () => {
    expect(rows[0]).toEqual([...ZOHO_ACCOUNT_HEADINGS]);
    expect(ZOHO_ACCOUNT_HEADINGS).toEqual(['Account Code', 'Account Name', 'Account Type']);
  });

  it('names each type the way Zoho Books names it', () => {
    expect(rows.slice(1)).toEqual([
      ['1010', 'Bank, operating', 'Bank'],
      ['1020', 'Cash box', 'Cash'],
      ['1500', 'Equipment, at cost', 'Other Current Asset'],
      ['2400', 'Contract liability, sessions owed', 'Other Current Liability'],
      ['3100', 'Opening balance equity', 'Equity'],
      ['4000', 'Session income', 'Income'],
      ['6000', 'General expenses', 'Expense'],
    ]);
  });
});
