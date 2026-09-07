import { fils } from '../../../domain/shared';
import type {
  BooksSetting,
  ChartAccount,
  FiscalYear,
  JournalKind,
  PostedLine,
} from '../../../domain/accounting';
import type { Db } from '../_middleware/request-context';
import type { EntryRow, LineRow, YearRow } from './schema';

/**
 * Reading the books out of the database and into the domain's own shapes. Each
 * function is the one place a column name meets a field name; every rule about
 * what the rows mean is a pure function under domain/accounting.
 *
 * Amounts come back as text and are turned into `Fils` here, because a bigint
 * is not a JavaScript number until somebody says which one it is.
 */

const CHART_SQL =
  'select a.id, a.code, a.name, a.name_ar, a.type::text as type, a.role::text as role, ' +
  'a.archived_at from account a where a.tenant_id = app.current_tenant_id() order by a.code';

const BALANCES_SQL =
  'select l.account_id, ' +
  'coalesce(sum(l.debit_fils), 0)::text as debit_fils, ' +
  'coalesce(sum(l.credit_fils), 0)::text as credit_fils ' +
  'from journal_line l where l.tenant_id = app.current_tenant_id() group by l.account_id';

const SETTING_SQL =
  'select s.books_start_on::text as books_start_on, s.year_end_month, s.year_end_day, ' +
  's.locked_through::text as locked_through, s.corporate_tax_rate_basis_points, ' +
  's.corporate_tax_threshold_fils::text as corporate_tax_threshold_fils, ' +
  's.small_business_relief_elected, ' +
  's.small_business_relief_threshold_fils::text as small_business_relief_threshold_fils, ' +
  '(select count(*) from journal_entry e where e.tenant_id = s.tenant_id)::text as entry_count ' +
  'from accounting_setting s where s.tenant_id = app.current_tenant_id()';

const YEARS_SQL =
  'select y.id, y.starts_on::text as starts_on, y.ends_on::text as ends_on, ' +
  'y.status::text as status, y.closed_at, y.close_reason, y.reopened_at, y.reopen_reason ' +
  'from fiscal_year y where y.tenant_id = app.current_tenant_id() order by y.starts_on';

const POSTED_LINES_SQL =
  'select l.entry_id, e.reference, e.entered_on::text as entered_on, e.kind::text as kind, e.memo, ' +
  'a.id as account_id, a.code, a.name, a.type::text as type, a.role::text as role, ' +
  'l.debit_fils::text as debit_fils, l.credit_fils::text as credit_fils ' +
  'from journal_line l ' +
  'join journal_entry e on e.tenant_id = l.tenant_id and e.id = l.entry_id ' +
  'join account a on a.tenant_id = l.tenant_id and a.id = l.account_id ' +
  'where l.tenant_id = app.current_tenant_id() ' +
  'order by e.entered_on, e.number, l.line_no';

/** One entry with its debit total, the entry that reverses it, and nothing that names anybody. */
const ENTRY_COLUMNS =
  'e.id, e.reference, e.entered_on::text as entered_on, e.occurred_on::text as occurred_on, ' +
  'e.kind::text as kind, e.memo, e.source_event, e.reverses_entry_id, ' +
  'r.id as reversed_by_entry_id, coalesce(t.debit_total, 0)::text as debit_total_fils ';

const ENTRY_JOINS =
  'from journal_entry e ' +
  'left join journal_entry r on r.tenant_id = e.tenant_id and r.reverses_entry_id = e.id ' +
  'left join lateral (select sum(l.debit_fils) as debit_total from journal_line l ' +
  'where l.tenant_id = e.tenant_id and l.entry_id = e.id) t on true ';

const LINES_SQL =
  'select l.line_no, l.account_id, a.code, a.name, l.debit_fils::text as debit_fils, ' +
  'l.credit_fils::text as credit_fils from journal_line l ' +
  'join account a on a.tenant_id = l.tenant_id and a.id = l.account_id ' +
  'where l.tenant_id = app.current_tenant_id() and l.entry_id = $1 order by l.line_no';

type ChartDbRow = {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  type: string;
  role: string | null;
  archived_at: Date | string | null;
};

type EntryDbRow = {
  id: string;
  reference: string;
  entered_on: string;
  occurred_on: string | null;
  kind: string;
  memo: string;
  source_event: string | null;
  reverses_entry_id: string | null;
  reversed_by_entry_id: string | null;
  debit_total_fils: string;
};

function asIsoOrNull(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toEntryRow(row: EntryDbRow): EntryRow {
  return {
    id: row.id,
    reference: row.reference,
    enteredOn: row.entered_on,
    occurredOn: row.occurred_on,
    kind: row.kind as EntryRow['kind'],
    memo: row.memo,
    sourceEvent: row.source_event,
    reversesEntryId: row.reverses_entry_id,
    reversedByEntryId: row.reversed_by_entry_id,
    debitTotalFils: Number(row.debit_total_fils),
  };
}

export async function readChart(db: Db): Promise<ChartAccount[]> {
  const { rows } = await db.query<ChartDbRow>(CHART_SQL);
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    nameAr: row.name_ar,
    type: row.type as ChartAccount['type'],
    role: row.role as ChartAccount['role'],
    archivedAt: asIsoOrNull(row.archived_at),
  }));
}

/** Every account's balance in its own natural direction is the statements' work; this is the two sides. */
export async function readAccountTotals(
  db: Db,
): Promise<Map<string, { debitFils: number; creditFils: number }>> {
  const { rows } = await db.query<{
    account_id: string;
    debit_fils: string;
    credit_fils: string;
  }>(BALANCES_SQL);
  return new Map(
    rows.map((row) => [
      row.account_id,
      { debitFils: Number(row.debit_fils), creditFils: Number(row.credit_fils) },
    ]),
  );
}

export async function readSetting(db: Db): Promise<BooksSetting & { entryCount: number }> {
  const { rows } = await db.query<{
    books_start_on: string;
    year_end_month: number;
    year_end_day: number;
    locked_through: string | null;
    corporate_tax_rate_basis_points: number;
    corporate_tax_threshold_fils: string;
    small_business_relief_elected: boolean;
    small_business_relief_threshold_fils: string;
    entry_count: string;
  }>(SETTING_SQL);
  const row = rows[0];
  if (!row) {
    // Every practice has this row by trigger and by data step (450); its
    // absence is a database that is not what the migrations say it is.
    throw new Error('The practice has no books settings row.');
  }
  return {
    booksStartOn: row.books_start_on,
    yearEndMonth: row.year_end_month,
    yearEndDay: row.year_end_day,
    lockedThrough: row.locked_through,
    corporateTaxRateBasisPoints: row.corporate_tax_rate_basis_points,
    corporateTaxThresholdFils: fils(Number(row.corporate_tax_threshold_fils)),
    smallBusinessReliefElected: row.small_business_relief_elected,
    smallBusinessReliefThresholdFils: fils(Number(row.small_business_relief_threshold_fils)),
    entryCount: Number(row.entry_count),
  };
}

export type YearWithHistory = FiscalYear &
  Pick<YearRow, 'closedAt' | 'closeReason' | 'reopenedAt' | 'reopenReason'>;

export async function readYears(db: Db): Promise<YearWithHistory[]> {
  const { rows } = await db.query<{
    id: string;
    starts_on: string;
    ends_on: string;
    status: string;
    closed_at: Date | string | null;
    close_reason: string | null;
    reopened_at: Date | string | null;
    reopen_reason: string | null;
  }>(YEARS_SQL);
  return rows.map((row) => ({
    id: row.id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status as FiscalYear['status'],
    closedAt: asIsoOrNull(row.closed_at),
    closeReason: row.close_reason,
    reopenedAt: asIsoOrNull(row.reopened_at),
    reopenReason: row.reopen_reason,
  }));
}

/**
 * The whole journal, as lines. A position "as of" a day needs every line ever
 * posted, so the statements read all of them and filter by date themselves;
 * a practice's journal is thousands of rows, not millions.
 */
export async function readPostedLines(db: Db): Promise<PostedLine[]> {
  const { rows } = await db.query<{
    entry_id: string;
    reference: string;
    entered_on: string;
    kind: string;
    memo: string;
    account_id: string;
    code: string;
    name: string;
    type: string;
    role: string | null;
    debit_fils: string;
    credit_fils: string;
  }>(POSTED_LINES_SQL);
  return rows.map((row) => ({
    entryId: row.entry_id,
    entryReference: row.reference,
    enteredOn: row.entered_on,
    kind: row.kind as PostedLine['kind'],
    memo: row.memo,
    accountId: row.account_id,
    accountCode: row.code,
    accountName: row.name,
    accountType: row.type as PostedLine['accountType'],
    accountRole: row.role as PostedLine['accountRole'],
    debitFils: fils(Number(row.debit_fils)),
    creditFils: fils(Number(row.credit_fils)),
  }));
}

export async function readEntries(
  db: Db,
  filter: { from?: string; to?: string; accountId?: string; kind?: JournalKind; limit: number },
): Promise<{ entries: EntryRow[]; truncated: boolean }> {
  const sql =
    `select ${ENTRY_COLUMNS}${ENTRY_JOINS}` +
    'where e.tenant_id = app.current_tenant_id() ' +
    'and ($1::date is null or e.entered_on >= $1) ' +
    'and ($2::date is null or e.entered_on <= $2) ' +
    'and ($3::uuid is null or exists (select 1 from journal_line l ' +
    'where l.tenant_id = e.tenant_id and l.entry_id = e.id and l.account_id = $3)) ' +
    'and ($4::journal_kind is null or e.kind = $4) ' +
    // One row past the page, so the route can say "there are more" without a
    // second count-only query (the invoice book's own shape).
    'order by e.entered_on desc, e.number desc limit $5';
  const { rows } = await db.query<EntryDbRow>(sql, [
    filter.from ?? null,
    filter.to ?? null,
    filter.accountId ?? null,
    filter.kind ?? null,
    filter.limit + 1,
  ]);
  const truncated = rows.length > filter.limit;
  return { entries: rows.slice(0, filter.limit).map(toEntryRow), truncated };
}

export async function readEntry(
  db: Db,
  id: string,
): Promise<{ entry: EntryRow; lines: LineRow[] } | null> {
  const header = await db.query<EntryDbRow>(
    `select ${ENTRY_COLUMNS}${ENTRY_JOINS}where e.tenant_id = app.current_tenant_id() and e.id = $1`,
    [id],
  );
  const row = header.rows[0];
  if (!row) {
    return null;
  }
  const lines = await db.query<{
    line_no: number;
    account_id: string;
    code: string;
    name: string;
    debit_fils: string;
    credit_fils: string;
  }>(LINES_SQL, [id]);
  return {
    entry: toEntryRow(row),
    lines: lines.rows.map((line) => ({
      lineNo: line.line_no,
      accountId: line.account_id,
      accountCode: line.code,
      accountName: line.name,
      debitFils: Number(line.debit_fils),
      creditFils: Number(line.credit_fils),
    })),
  };
}
