import { fils } from '../../../domain/shared';
import {
  landingDayFor,
  postingsFor,
  type ChartAccount,
  type MoneyEvent,
} from '../../../domain/accounting';
import type { Db } from '../_middleware/request-context';
import { readChart, readSetting, readYears, type YearWithHistory } from './rows';

/**
 * The poster: every money event the platform has recorded and the journal has
 * not, turned into balanced entries (docs/SPEC/accounting.md section 4.3).
 *
 * It reads through `app.unposted_money_events()` (454), which is security
 * definer and steps past the erasure gate on purpose, so what the books say
 * never depends on who ran it. It writes through the journal's own unique key,
 * with `on conflict do nothing` on the header and lines written only when the
 * header was, so running it twice writes nothing the second time; and it takes
 * a per-practice advisory lock first, so two runs at once queue rather than
 * overlap (`LOCK_SQL` below).
 *
 * Every rule it applies is a pure function: `postingsFor` decides the lines,
 * `landingDayFor` decides the day. This file is the plumbing between them and
 * the database, and holds no rule of its own.
 */

/**
 * One posting run per practice at a time.
 *
 * Two runs at once — the page's opening `POST` beside the nightly job, or two
 * tabs — each read the same event list, because neither can see the other's
 * uncommitted entries. The unique key stops the second writing anything, but
 * not before its insert has fired the BEFORE trigger of migration 453, which
 * takes a journal number from the counter *before* the key refuses the
 * duplicate: `on conflict do nothing` is not an error, so the number stands
 * consumed and the next entry written leaves it missing behind it. The journal
 * is gapless by intent (450, and an auditor's first question), so the second
 * run waits here instead, and finds nothing left to do.
 *
 * Transaction-scoped: the lock is released by the commit or the rollback the
 * fence performs, whichever happens, and never by this file. A
 * `select ... for update` on `accounting_setting` would not do the same job —
 * `books_owner_settings` filters that row to nothing for finance.
 */
const LOCK_SQL =
  "select pg_advisory_xact_lock(hashtext('post-books'), hashtext(app.current_tenant_id()::text))";

const EVENTS_SQL = 'select * from app.unposted_money_events()';
const YEAR_SQL = 'select app.fiscal_year_for($1) as id';
const ENTRY_SQL =
  'insert into journal_entry (tenant_id, entered_on, occurred_on, fiscal_year_id, kind, memo, ' +
  'source_table, source_id, source_event, created_by) ' +
  "values (app.current_tenant_id(), $1, $2, $3, 'automatic', $4, $5, $6, $7, app.current_actor_id()) " +
  'on conflict (tenant_id, source_table, source_id, source_event) do nothing returning id';
const LINE_SQL =
  'insert into journal_line (tenant_id, entry_id, line_no, account_id, debit_fils, credit_fils, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, app.current_actor_id())';

export type EventRow = {
  source_table: 'invoice' | 'payment' | 'entitlement';
  source_id: string;
  source_event: string;
  occurred_on: string;
  invoice_kind: string | null;
  net_fils: string | null;
  vat_fils: string | null;
  gross_fils: string | null;
  amount_fils: string | null;
  method: string | null;
  service_code: string | null;
  has_replacement: boolean | null;
};

export type PostingReport = { posted: number; unknown: number };

const INVOICE_KINDS = ['session', 'package', 'call_out_fee', 'statement'] as const;
const METHODS = ['cash', 'transfer', 'link'] as const;

function amount(value: string | null): number {
  return Number(value ?? 0);
}

/**
 * One row of `app.unposted_money_events()` as the domain's own event, or null
 * when this build does not know the event — a row from a later piece's rule,
 * which the overview counts rather than guesses at.
 */
export function toEvent(row: EventRow): MoneyEvent | null {
  const common = { sourceId: row.source_id, occurredOn: row.occurred_on };
  switch (row.source_event) {
    case 'invoice.issued': {
      const kind = INVOICE_KINDS.find((k) => k === row.invoice_kind);
      if (!kind) {
        return null;
      }
      return {
        event: 'invoice.issued',
        ...common,
        invoiceKind: kind,
        netFils: fils(amount(row.net_fils)),
        vatFils: fils(amount(row.vat_fils)),
        grossFils: fils(amount(row.gross_fils)),
      };
    }
    case 'fee.waived':
      return {
        event: 'fee.waived',
        ...common,
        netFils: fils(amount(row.net_fils)),
        vatFils: fils(amount(row.vat_fils)),
        grossFils: fils(amount(row.gross_fils)),
      };
    case 'payment.received': {
      const method = METHODS.find((m) => m === row.method);
      if (!method) {
        return null;
      }
      return {
        event: 'payment.received',
        ...common,
        method,
        amountFils: fils(amount(row.amount_fils)),
      };
    }
    case 'credit.consumed':
      return {
        event: 'credit.consumed',
        ...common,
        allocatedNetFils: fils(amount(row.net_fils)),
        serviceCode: row.service_code ?? '',
      };
    case 'credit.waived':
      return {
        event: 'credit.waived',
        ...common,
        allocatedNetFils: fils(amount(row.net_fils)),
        serviceCode: row.service_code ?? '',
        hasReplacement: row.has_replacement === true,
      };
    case 'credit.expired':
      return {
        event: 'credit.expired',
        ...common,
        allocatedNetFils: fils(amount(row.net_fils)),
      };
    case 'credit.refunded':
      return {
        event: 'credit.refunded',
        ...common,
        allocatedNetFils: fils(amount(row.net_fils)),
      };
    default:
      return null;
  }
}

/**
 * An event this build has no rule for, and the one kind the spec names as
 * unknown on purpose: a statement invoice re-presents charges already
 * invoiced, so it posts nothing and is counted rather than guessed at
 * (section 7).
 */
function isUnknown(event: MoneyEvent | null): boolean {
  if (event === null) {
    return true;
  }
  return event.event === 'invoice.issued' && event.invoiceKind === 'statement';
}

/** What the poster would do, without doing any of it: the overview's two counts. */
export async function classifyPending(db: Db): Promise<{ pending: number; unknown: number }> {
  const chart = await readChart(db);
  const { rows } = await db.query<EventRow>(EVENTS_SQL);
  let pending = 0;
  let unknown = 0;
  for (const row of rows) {
    const event = toEvent(row);
    if (isUnknown(event)) {
      unknown += 1;
      continue;
    }
    if (postingsFor(event as MoneyEvent, chart) !== null) {
      pending += 1;
    }
  }
  return { pending, unknown };
}

async function yearIdFor(
  db: Db,
  day: string,
  years: YearWithHistory[],
): Promise<{ id: string; years: YearWithHistory[] }> {
  const found = await db.query<{ id: string }>(YEAR_SQL, [day]);
  const id = found.rows[0]?.id;
  if (!id) {
    throw new Error('No financial year could be found or made for a posting day.');
  }
  // A year the function has just made is not in the list the landing rule was
  // judged against; reading them again keeps the two in step.
  return years.some((year) => year.id === id) ? { id, years } : { id, years: await readYears(db) };
}

/**
 * Posts everything outstanding and answers how much.
 *
 * It takes no clock, and that is the point: every day it writes comes from the
 * event itself, moved only by `landingDayFor` against the years and the lock
 * (rule 4). The plan's signature carried a `now` alongside the database; there
 * is nothing here for it to decide, and a parameter that is never read is a
 * promise this function does not keep.
 */
export async function postPendingEvents(db: Db): Promise<PostingReport> {
  await db.query(LOCK_SQL);
  const chart: ChartAccount[] = await readChart(db);
  const setting = await readSetting(db);
  let years = await readYears(db);
  const { rows } = await db.query<EventRow>(EVENTS_SQL);
  let posted = 0;
  let unknown = 0;
  for (const row of rows) {
    const event = toEvent(row);
    if (isUnknown(event)) {
      unknown += 1;
      continue;
    }
    const draft = postingsFor(event as MoneyEvent, chart);
    if (!draft || !draft.source) {
      // A known event that posts nothing: a waived credit with no replacement,
      // whose consumption stands. Neither posted nor unknown.
      continue;
    }
    const enteredOn = landingDayFor(draft.enteredOn, years, setting.lockedThrough);
    const occurredOn = enteredOn === draft.enteredOn ? null : draft.enteredOn;
    const memo = occurredOn ? `${draft.memo} (occurred ${occurredOn})` : draft.memo;
    const year = await yearIdFor(db, enteredOn, years);
    years = year.years;
    const header = await db.query<{ id: string }>(ENTRY_SQL, [
      enteredOn,
      occurredOn,
      year.id,
      memo,
      draft.source.table,
      draft.source.id,
      draft.source.event,
    ]);
    const entryId = header.rows[0]?.id;
    if (!entryId) {
      // Already posted by a concurrent run: the unique key is the idempotency.
      continue;
    }
    let lineNo = 1;
    for (const line of draft.lines) {
      await db.query(LINE_SQL, [entryId, lineNo, line.accountId, line.debitFils, line.creditFils]);
      lineNo += 1;
    }
    posted += 1;
  }
  return { posted, unknown };
}
