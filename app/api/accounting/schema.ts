import { z } from 'zod';
import { ACCOUNT_ROLES, ACCOUNT_TYPES, JOURNAL_KINDS } from '../../../domain/accounting';
import { cleanText } from '../_middleware/text';

/**
 * Every shape the books' routes accept and answer (docs/SPEC/accounting.md
 * section 9). Nothing here carries a client id, a name, an invoice number or a
 * payment reference, and every response is parsed through its schema before it
 * leaves the process.
 *
 * `IsoDate`, `MINIMUM_REASON` and `isRealText` are copied from
 * app/api/billing/schema.ts rather than imported: a stream does not reach into
 * another stream's paths (docs/SPEC/OWNERSHIP.md), and thirty lines of
 * arithmetic duplicated is cheaper than a dependency between two streams'
 * schemas.
 */

/** YYYY-MM-DD, and a real calendar date: 2026-13-45 matches the shape and names no day. */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD.')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    if (year === undefined || month === undefined || day === undefined) {
      return false;
    }
    const asDate = new Date(Date.UTC(year, month - 1, day));
    return (
      asDate.getUTCFullYear() === year &&
      asDate.getUTCMonth() === month - 1 &&
      asDate.getUTCDate() === day
    );
  }, 'Dates must be a real calendar date.');

/** A reason worth reading a year later: eight characters, and not one repeated. */
export const MINIMUM_REASON = 8;

export function isRealText(value: string): boolean {
  if (value.length < MINIMUM_REASON) {
    return false;
  }
  const withoutSpaces = value.replace(/\s/g, '');
  if (withoutSpaces.length < MINIMUM_REASON) {
    return false;
  }
  return new Set(withoutSpaces).size > 1;
}

/** A memo is at most 200 characters and says something; it never names anybody. */
const Memo = z
  .string()
  .transform((value) => cleanText(value, 200))
  .refine((value) => value.length > 0, 'A memo says what the entry is.');

const Name80 = z
  .string()
  .transform((value) => cleanText(value, 80))
  .refine((value) => value.length > 0, 'An account has a name.');

export const AccountRow = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
  type: z.enum(ACCOUNT_TYPES),
  role: z.enum(ACCOUNT_ROLES).nullable(),
  archivedAt: z.string().nullable(),
  balanceFils: z.number().int(),
});
export type AccountRow = z.infer<typeof AccountRow>;

export const AccountsResponse = z.object({ accounts: z.array(AccountRow) });
export type AccountsResponse = z.infer<typeof AccountsResponse>;

export const AccountResponse = z.object({ account: AccountRow });
export type AccountResponse = z.infer<typeof AccountResponse>;

export const LineRow = z.object({
  lineNo: z.number().int(),
  accountId: z.uuid(),
  accountCode: z.string(),
  accountName: z.string(),
  debitFils: z.number().int().nonnegative(),
  creditFils: z.number().int().nonnegative(),
});
export type LineRow = z.infer<typeof LineRow>;

export const EntryRow = z.object({
  id: z.uuid(),
  reference: z.string(),
  enteredOn: IsoDate,
  occurredOn: IsoDate.nullable(),
  kind: z.enum(JOURNAL_KINDS),
  memo: z.string(),
  sourceEvent: z.string().nullable(),
  reversesEntryId: z.uuid().nullable(),
  reversedByEntryId: z.uuid().nullable(),
  debitTotalFils: z.number().int().nonnegative(),
});
export type EntryRow = z.infer<typeof EntryRow>;

export const EntriesResponse = z.object({
  entries: z.array(EntryRow),
  truncated: z.boolean(),
});
export type EntriesResponse = z.infer<typeof EntriesResponse>;

export const EntryResponse = z.object({ entry: EntryRow, lines: z.array(LineRow) });
export type EntryResponse = z.infer<typeof EntryResponse>;

export const YearRow = z.object({
  id: z.uuid(),
  startsOn: IsoDate,
  endsOn: IsoDate,
  status: z.enum(['open', 'closed']),
  closedAt: z.string().nullable(),
  closeReason: z.string().nullable(),
  reopenedAt: z.string().nullable(),
  reopenReason: z.string().nullable(),
});
export type YearRow = z.infer<typeof YearRow>;

export const YearsResponse = z.object({ years: z.array(YearRow) });
export type YearsResponse = z.infer<typeof YearsResponse>;

export const YearResponse = z.object({ year: YearRow });
export type YearResponse = z.infer<typeof YearResponse>;

export const SettingsResponse = z.object({
  booksStartOn: IsoDate,
  yearEndMonth: z.number().int(),
  yearEndDay: z.number().int(),
  lockedThrough: IsoDate.nullable(),
  corporateTaxRateBasisPoints: z.number().int(),
  corporateTaxThresholdFils: z.number().int(),
  smallBusinessReliefElected: z.boolean(),
  smallBusinessReliefThresholdFils: z.number().int(),
  entryCount: z.number().int(),
});
export type SettingsResponse = z.infer<typeof SettingsResponse>;

export const LedgerRowSchema = z.object({
  entryReference: z.string(),
  enteredOn: IsoDate,
  memo: z.string(),
  debitFils: z.number().int(),
  creditFils: z.number().int(),
  runningBalanceFils: z.number().int(),
});

export const LedgerResponse = z.object({
  account: AccountRow,
  from: IsoDate,
  to: IsoDate,
  openingBalanceFils: z.number().int(),
  rows: z.array(LedgerRowSchema),
  closingBalanceFils: z.number().int(),
});
export type LedgerResponse = z.infer<typeof LedgerResponse>;

/** What the poster wrote, and what it did not know what to do with. */
export const PostResponse = z.object({
  posted: z.number().int(),
  unknown: z.number().int(),
});
export type PostResponse = z.infer<typeof PostResponse>;

export const CreateEntryInput = z.object({
  kind: z.enum(['manual', 'opening']),
  enteredOn: IsoDate,
  memo: Memo,
  lines: z
    .array(
      z.object({
        accountId: z.uuid(),
        debitFils: z.number().int().nonnegative(),
        creditFils: z.number().int().nonnegative(),
      }),
    )
    .min(2)
    .max(50),
  balanceWithOpeningEquity: z.boolean().default(false),
});
export type CreateEntryInput = z.infer<typeof CreateEntryInput>;

export const CreateAccountInput = z.object({
  code: z.string().regex(/^[1-6][0-9]{3}$/),
  name: Name80,
  nameAr: Name80.nullable().default(null),
  type: z.enum(ACCOUNT_TYPES),
});
export type CreateAccountInput = z.infer<typeof CreateAccountInput>;

export const PatchAccountInput = z.object({
  name: Name80.optional(),
  nameAr: Name80.nullable().optional(),
  archive: z.boolean().optional(),
});
export type PatchAccountInput = z.infer<typeof PatchAccountInput>;

/**
 * The longest day each month has in *every* year, which is 450's own
 * `accounting_setting_year_end_is_a_day` said in TypeScript: February is 28,
 * never 29, because a year end must fall in every year and not only in a leap
 * one. The two are meant to agree; the constraint is the one that binds, and
 * `settings.ts` turns its refusal into the same coded answer for a patch that
 * names only one of the pair.
 */
const LONGEST_DAY_OF_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const PatchSettingsInput = z
  .object({
    booksStartOn: IsoDate.optional(),
    yearEndMonth: z.number().int().min(1).max(12).optional(),
    yearEndDay: z.number().int().min(1).max(31).optional(),
    corporateTaxRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
    corporateTaxThresholdFils: z.number().int().nonnegative().optional(),
    smallBusinessReliefElected: z.boolean().optional(),
    smallBusinessReliefThresholdFils: z.number().int().nonnegative().optional(),
  })
  .refine(
    (input) =>
      input.yearEndMonth === undefined ||
      input.yearEndDay === undefined ||
      input.yearEndDay <= (LONGEST_DAY_OF_MONTH[input.yearEndMonth - 1] ?? 31),
    'A year end is a day the calendar has in every year.',
  );
export type PatchSettingsInput = z.infer<typeof PatchSettingsInput>;

export const LockInput = z.object({ lockedThrough: IsoDate });
export type LockInput = z.infer<typeof LockInput>;

export const LockResponse = z.object({
  lockedThrough: IsoDate,
  move: z.enum(['forward', 'backward', 'unchanged']),
});
export type LockResponse = z.infer<typeof LockResponse>;

export const StatementRowSchema = z.object({
  accountCode: z.string(),
  accountName: z.string(),
  accountType: z.enum(ACCOUNT_TYPES),
  balanceFils: z.number().int(),
});
export type StatementRowSchema = z.infer<typeof StatementRowSchema>;

export const TrialBalanceResponse = z.object({
  asOf: IsoDate,
  rows: z.array(
    StatementRowSchema.extend({ debitFils: z.number().int(), creditFils: z.number().int() }),
  ),
  totalDebitFils: z.number().int(),
  totalCreditFils: z.number().int(),
});
export type TrialBalanceResponse = z.infer<typeof TrialBalanceResponse>;

export const ProfitAndLossResponse = z.object({
  from: IsoDate,
  to: IsoDate,
  income: z.array(StatementRowSchema),
  expenses: z.array(StatementRowSchema),
  incomeFils: z.number().int(),
  expenseFils: z.number().int(),
  resultFils: z.number().int(),
});
export type ProfitAndLossResponse = z.infer<typeof ProfitAndLossResponse>;

export const BalanceSheetResponse = z.object({
  asOf: IsoDate,
  assets: z.array(StatementRowSchema),
  liabilities: z.array(StatementRowSchema),
  equity: z.array(StatementRowSchema),
  resultYearToDateFils: z.number().int(),
  retainedEarningsFils: z.number().int(),
  totalAssetsFils: z.number().int(),
  totalLiabilitiesAndEquityFils: z.number().int(),
});
export type BalanceSheetResponse = z.infer<typeof BalanceSheetResponse>;

export const CashFlowResponse = z.object({
  from: IsoDate,
  to: IsoDate,
  byCategory: z.object({
    fromHouseholds: z.number().int(),
    forExpenses: z.number().int(),
    toOwners: z.number().int(),
    tax: z.number().int(),
    other: z.number().int(),
    transfers: z.number().int(),
  }),
  openingCashFils: z.number().int(),
  netChangeFils: z.number().int(),
  closingCashFils: z.number().int(),
});
export type CashFlowResponse = z.infer<typeof CashFlowResponse>;

export const OverviewResponse = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  asOf: IsoDate,
  fiscalYearStartsOn: IsoDate,
  resultYearToDateFils: z.number().int(),
  revenueYearToDateFils: z.number().int(),
  cashPositionFils: z.number().int(),
  cashAccounts: z.array(StatementRowSchema),
  receivableFils: z.number().int(),
  corporateTaxEstimateFils: z.number().int(),
  reliefWatch: z.enum(['clear', 'approaching', 'exceeded']),
  reliefThresholdFils: z.number().int(),
  reliefElected: z.boolean(),
  unpostedCount: z.number().int(),
  unknownCount: z.number().int(),
  recentEntries: z.array(EntryRow),
});
export type OverviewResponse = z.infer<typeof OverviewResponse>;
