import { useCallback, useEffect, useMemo, useState } from 'react';
import { EntriesResponse, EntryResponse, type EntryRow } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { ReasonDrawer } from './ReasonDrawer';
import { formatDate, formatFils } from './money';
import { eventWords, JOURNAL_KIND_WORDS } from './words';

/**
 * The journal, newest first (docs/SPEC/accounting.md section 5.2). Opening an
 * entry shows its lines beneath it; an entry that has not already been reversed
 * can be, with a reason. Nothing here edits anything: the journal is written
 * once, and a correction is a new entry.
 */

const REVERSAL_REFUSALS: Record<string, string> = {
  already_reversed: 'This entry has already been reversed.',
  period_locked: 'The books are closed or locked on every day the reversal could land.',
  reason_required: 'Say why this entry is being reversed.',
  not_found: 'This entry is no longer in the journal. Reload and try again.',
};

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; response: EntriesResponse };

export function JournalSection({
  canWrite,
  reloadKey,
  onReloaded,
}: {
  canWrite: boolean;
  /** Bumped by the page when an entry has been posted, so the list refreshes. */
  reloadKey: number;
  onReloaded: () => void;
}) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openEntry, setOpenEntry] = useState<EntryResponse | null>(null);
  const [reversing, setReversing] = useState<EntryRow | null>(null);

  const load = useCallback(() => {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    void apiFetch(`/api/accounting/entries${suffix}`)
      .then(async (res) => {
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        setState({ kind: 'ready', response: EntriesResponse.parse(await res.json()) });
      })
      .catch(() => setState({ kind: 'error' }));
  }, [apiFetch, from, to]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const openOne = useCallback(
    (row: EntryRow) => {
      void apiFetch(`/api/accounting/entries/${row.id}`)
        .then(async (res) => {
          if (!res.ok) {
            return;
          }
          setOpenEntry(EntryResponse.parse(await res.json()));
        })
        .catch(() => undefined);
    },
    [apiFetch],
  );

  const columns = useMemo<Column<EntryRow>[]>(
    () => [
      { key: 'reference', header: 'Entry', render: (row) => row.reference },
      { key: 'day', header: 'Day', render: (row) => formatDate(row.enteredOn) },
      { key: 'kind', header: 'Kind', render: (row) => JOURNAL_KIND_WORDS[row.kind] },
      { key: 'memo', header: 'What it is', render: (row) => row.memo },
      { key: 'event', header: 'From', render: (row) => eventWords(row.sourceEvent) },
      {
        key: 'debit',
        header: 'Total (AED)',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.debitTotalFils),
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (row) => (
          <span className="row-actions">
            <Button variant="quiet" onClick={() => openOne(row)}>
              {`Open ${row.reference}`}
            </Button>
            {canWrite && row.reversedByEntryId === null ? (
              <Button variant="quiet" onClick={() => setReversing(row)}>
                {`Reverse ${row.reference}`}
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [canWrite, openOne],
  );

  return (
    <>
      <div className="filters">
        <Field
          id="journal-from"
          label="From"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Field
          id="journal-to"
          label="To"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {state.kind === 'loading' ? <Note>Reading the journal.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The journal could not be read just now. Try again.</Note>
      ) : null}
      {state.kind === 'ready' ? (
        <>
          {state.response.truncated ? (
            <Note tone="attention">
              Only the most recent entries are shown. Narrow the period to see the rest.
            </Note>
          ) : null}
          <Table
            caption="The journal"
            columns={columns}
            rows={state.response.entries}
            rowKey={(row) => row.id}
            empty="Nothing has been posted yet."
          />
        </>
      ) : null}

      {openEntry ? (
        <section className="entry-lines" aria-label={`Lines of ${openEntry.entry.reference}`}>
          <Table
            caption={`${openEntry.entry.reference}: ${openEntry.entry.memo}`}
            columns={[
              { key: 'code', header: 'Account', render: (line) => line.accountCode },
              { key: 'name', header: 'Name', render: (line) => line.accountName },
              {
                key: 'debit',
                header: 'Debit (AED)',
                numeric: true,
                align: 'end',
                render: (line) => formatFils(line.debitFils),
              },
              {
                key: 'credit',
                header: 'Credit',
                numeric: true,
                align: 'end',
                render: (line) => formatFils(line.creditFils),
              },
            ]}
            rows={openEntry.lines}
            rowKey={(line) => `${openEntry.entry.id}-${line.lineNo}`}
            empty="This entry has no lines."
          />
        </section>
      ) : null}

      {reversing ? (
        <ReasonDrawer
          title="Reverse an entry"
          what={`${reversing.reference}, ${reversing.memo}, will be reversed by a new entry. Both stay in the journal.`}
          reasonLabel="Why this entry is reversed"
          submitLabel="Post the reversal"
          path={`/api/accounting/entries/${reversing.id}/reversal`}
          refusals={REVERSAL_REFUSALS}
          onClose={() => setReversing(null)}
          onDone={() => {
            setReversing(null);
            setOpenEntry(null);
            onReloaded();
          }}
        />
      ) : null}
    </>
  );
}
