import { useCallback, useEffect, useState } from 'react';
import { OverviewResponse } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { formatDate, formatFils } from './money';
import { eventWords, RELIEF_WORDS } from './words';

/**
 * What the practice's books say today (docs/SPEC/accounting.md section 5.1).
 *
 * **Cash first.** The practice suggested money be counted only when a receipt
 * is issued, not on an invoice. The operator kept the books on accruals — the
 * statements, the tax estimate and the year-end close all need them — and
 * decided on 2026-10-06 that the overview leads with cash instead. So the
 * first, larger row is what arrived: received this month and this year, both
 * receipts, and what is in the bank. The second row, quieter and under its
 * own heading, is what the accruals say: revenue recognised, sessions owed,
 * what households owe and the year's result, each with one plain line saying
 * what it is, because "recognised" is an accountant's word. Nothing about the
 * postings changed; only the order and the words did.
 *
 * Then the corporate-tax set-aside, with the word *estimate* beside it,
 * because the platform files nothing and the adviser decides the election.
 *
 * Every figure was computed on the server and is formatted by `money.ts`; no
 * screen in this codebase does arithmetic on money.
 */

type BillingSummary = {
  cashCollectedFils: number;
  revenueRecognisedFils: number;
  deferredNetFils: number;
};

type State =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'error' }
  | { kind: 'ready'; overview: OverviewResponse };

function Figure({
  label,
  valueFils,
  explains,
}: {
  label: string;
  valueFils: number;
  /** One plain line under the figure saying what it is, where the label alone does not. */
  explains?: string;
}) {
  return (
    <div className="figures__figure">
      <p className="figures__label small muted">{label}</p>
      <p className="figures__value numeric">{formatFils(valueFils)}</p>
      {explains ? <p className="figures__explains small muted">{explains}</p> : null}
    </div>
  );
}

const ENTRY_COLUMNS: Column<OverviewResponse['recentEntries'][number]>[] = [
  { key: 'reference', header: 'Entry', render: (row) => row.reference },
  { key: 'day', header: 'Day', render: (row) => formatDate(row.enteredOn) },
  { key: 'memo', header: 'What it is', render: (row) => row.memo },
  { key: 'event', header: 'From', render: (row) => eventWords(row.sourceEvent) },
  {
    key: 'debit',
    header: 'Total (AED)',
    numeric: true,
    align: 'end',
    render: (row) => formatFils(row.debitTotalFils),
  },
];

export function OverviewSection({
  canWrite,
  ready,
  onPost,
}: {
  canWrite: boolean;
  /** False until the page's own posting call has answered: reads follow writes. */
  ready: boolean;
  onPost: () => Promise<void>;
}) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void apiFetch('/api/accounting/overview')
      .then(async (res) => {
        if (res.status === 403) {
          setState({ kind: 'forbidden' });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        setState({ kind: 'ready', overview: OverviewResponse.parse(await res.json()) });
      })
      .catch(() => setState({ kind: 'error' }));
  }, [apiFetch]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    load();
  }, [load, ready]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    void apiFetch('/api/billing/summary')
      .then(async (res) => {
        if (!res.ok) {
          return;
        }
        setSummary((await res.json()) as BillingSummary);
      })
      .catch(() => undefined);
  }, [apiFetch, ready]);

  const bringUpToDate = useCallback(() => {
    setBusy(true);
    void onPost()
      .then(() => load())
      .finally(() => setBusy(false));
  }, [load, onPost]);

  if (state.kind === 'forbidden') {
    return <Note tone="critical">You don&apos;t have permission to see the books.</Note>;
  }
  if (state.kind === 'error') {
    return <Note tone="critical">The books could not be read just now. Try again.</Note>;
  }
  if (state.kind === 'loading') {
    return <Note>Reading the books.</Note>;
  }

  const { overview } = state;
  return (
    <>
      {/* The month's figures come from billing and arrive a moment after the
          books'; until they do, the two tiles that need them are simply not
          there yet, as the whole row used to be. */}
      <section className="figures figures--lead" aria-label="Money received">
        {summary ? (
          <Figure label="Received this month (receipts)" valueFils={summary.cashCollectedFils} />
        ) : null}
        <Figure label="Received this year (receipts)" valueFils={overview.receivedYearToDateFils} />
        <Figure label="In the bank" valueFils={overview.cashPositionFils} />
      </section>

      <h2 id="books-earned-heading" className="books__figures-heading">
        Earned and owed (from invoices and sessions)
      </h2>
      <section className="figures figures--secondary" aria-labelledby="books-earned-heading">
        {summary ? (
          <>
            <Figure
              label="Revenue recognised this month"
              valueFils={summary.revenueRecognisedFils}
              explains="Earned when a session is delivered, whether or not it has been paid."
            />
            <Figure
              label="Sessions owed"
              valueFils={summary.deferredNetFils}
              explains="Paid for in advance, not yet delivered."
            />
          </>
        ) : null}
        <Figure
          label="Owed by households"
          valueFils={overview.receivableFils}
          explains="Invoiced and not yet paid."
        />
        <Figure
          label="Result, year to date"
          valueFils={overview.resultYearToDateFils}
          explains="What was earned this year, less what it cost to earn it."
        />
      </section>

      <section className="figures figures--secondary" aria-label="Tax">
        <Figure
          label="Corporate tax to set aside (estimate)"
          valueFils={overview.corporateTaxEstimateFils}
        />
      </section>

      <Note tone={overview.reliefWatch === 'clear' ? 'muted' : 'attention'}>
        {`${RELIEF_WORDS[overview.reliefWatch]} Revenue this year AED ${formatFils(
          overview.revenueYearToDateFils,
        )} against the relief line of AED ${formatFils(overview.reliefThresholdFils)}.`}
      </Note>

      {overview.unpostedCount === 0 ? (
        <Note>Everything is in the books.</Note>
      ) : (
        <>
          <Note tone="attention">
            {overview.unpostedCount === 1
              ? '1 event is not yet in the books.'
              : `${overview.unpostedCount} events are not yet in the books.`}
          </Note>
          {canWrite ? (
            <Button variant="secondary" onClick={bringUpToDate} disabled={busy}>
              {busy ? 'Posting…' : 'Bring the books up to date'}
            </Button>
          ) : null}
        </>
      )}

      <Table
        caption="This month's automatic entries"
        columns={ENTRY_COLUMNS}
        rows={overview.recentEntries}
        rowKey={(row) => row.id}
        empty="The platform has posted nothing this month."
      />
    </>
  );
}
