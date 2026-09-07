import { useCallback, useEffect, useState } from 'react';
import { OverviewResponse } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { formatDate, formatFils } from './money';
import { eventWords, RELIEF_WORDS } from './words';

/**
 * What the practice's books say today (docs/SPEC/accounting.md section 5.1):
 * the month's three billing figures, then the books' own — the result for the
 * year, what is in the bank, what households owe, and the corporate-tax
 * set-aside with the word *estimate* beside it, because the platform files
 * nothing and the adviser decides the election.
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

function Figure({ label, valueFils }: { label: string; valueFils: number }) {
  return (
    <div className="figures__figure">
      <p className="figures__label small muted">{label}</p>
      <p className="figures__value numeric">{formatFils(valueFils)}</p>
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
      {summary ? (
        <section className="figures" aria-label="This month">
          <Figure label="Cash collected this month" valueFils={summary.cashCollectedFils} />
          <Figure label="Revenue recognised this month" valueFils={summary.revenueRecognisedFils} />
          <Figure label="Sessions owed" valueFils={summary.deferredNetFils} />
        </section>
      ) : null}

      <section className="figures" aria-label="The books">
        <Figure label="Result, year to date" valueFils={overview.resultYearToDateFils} />
        <Figure label="In the bank" valueFils={overview.cashPositionFils} />
        <Figure label="Owed by households" valueFils={overview.receivableFils} />
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
