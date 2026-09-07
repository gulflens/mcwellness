import { addFils, fils, type Fils } from '../shared';
import type { AccountRole, AccountType, ChartAccount, DraftLine } from './types';

/**
 * The journal's own rules (docs/SPEC/accounting.md section 6, rules 1, 6, 7,
 * 8, 9): balanced or refused, roles found never assumed, a code matches its
 * type, an account with a role or a balance is not archived, and the opening
 * entry can be levelled with one line on the opening-balance account. The
 * database enforces rules 1, 2, 3 and 7 again (migration 453); this file is
 * what refuses a bad request before it ever reaches the database.
 */

export class UnbalancedEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnbalancedEntryError';
  }
}

export class MissingRoleError extends Error {
  constructor(role: AccountRole) {
    super(`The chart has no account with the role "${role}".`);
    this.name = 'MissingRoleError';
  }
}

const ZERO = fils(0);

export function dr(accountId: string, amount: Fils): DraftLine {
  return { accountId, debitFils: amount, creditFils: ZERO };
}

export function cr(accountId: string, amount: Fils): DraftLine {
  return { accountId, debitFils: ZERO, creditFils: amount };
}

function sides(lines: readonly DraftLine[]): { debits: Fils; credits: Fils } {
  let debits = ZERO;
  let credits = ZERO;
  for (const line of lines) {
    debits = addFils(debits, line.debitFils);
    credits = addFils(credits, line.creditFils);
  }
  return { debits, credits };
}

/** Rule 1. Throws `UnbalancedEntryError` naming the fault; returns nothing. */
export function assertBalanced(lines: readonly DraftLine[]): void {
  if (lines.length < 2) {
    throw new UnbalancedEntryError('An entry needs at least two lines.');
  }
  for (const line of lines) {
    const hasDebit = line.debitFils > 0;
    const hasCredit = line.creditFils > 0;
    if (hasDebit === hasCredit) {
      throw new UnbalancedEntryError('Each line carries exactly one side, greater than zero.');
    }
  }
  const { debits, credits } = sides(lines);
  if (debits !== credits) {
    throw new UnbalancedEntryError(`Debits ${debits} do not equal credits ${credits}.`);
  }
}

/** The reversing entry's lines: each side exchanged, order kept (section 4.2). */
export function reversalOf(lines: readonly DraftLine[]): DraftLine[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    debitFils: line.creditFils,
    creditFils: line.debitFils,
  }));
}

/** Rule 6. */
export function accountByRole(chart: readonly ChartAccount[], role: AccountRole): ChartAccount {
  const found = chart.find((account) => account.role === role && account.archivedAt === null);
  if (!found) {
    throw new MissingRoleError(role);
  }
  return found;
}

/** Rule 7: four digits, first digit by type (5 or 6 for an expense). */
export function codeMatchesType(code: string, type: AccountType): boolean {
  if (!/^[1-6][0-9]{3}$/.test(code)) {
    return false;
  }
  const first = code[0];
  switch (type) {
    case 'asset':
      return first === '1';
    case 'liability':
      return first === '2';
    case 'equity':
      return first === '3';
    case 'income':
      return first === '4';
    case 'expense':
      return first === '5' || first === '6';
  }
}

/** Rule 8. */
export function mayArchive(account: ChartAccount, balanceFils: Fils): boolean {
  return account.role === null && account.archivedAt === null && balanceFils === 0;
}

/**
 * The opening balances are posted once. The spec speaks of "the opening
 * entry" (docs/SPEC/accounting.md sections 4.2 and 5.2) and the drawer hides
 * the kind once the journal holds anything, but hiding is not refusing: a
 * second set of opening balances would be equity invented twice, and nothing
 * in the journal would say which was meant.
 */
export function mayPostOpening(existingOpeningCount: number): boolean {
  return existingOpeningCount === 0;
}

/** Rule 9: the lines plus one on the opening-balance account for the difference, or unchanged. */
export function balanceWithOpeningEquity(
  lines: readonly DraftLine[],
  chart: readonly ChartAccount[],
): DraftLine[] {
  const { debits, credits } = sides(lines);
  if (debits === credits) {
    return [...lines];
  }
  const opening = accountByRole(chart, 'opening_balance');
  return debits > credits
    ? [...lines, cr(opening.id, fils(debits - credits))]
    : [...lines, dr(opening.id, fils(credits - debits))];
}
