import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccountsResponse, LedgerResponse, type AccountRow } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { formatDate, formatFils } from './money';
import { ACCOUNT_ROLE_WORDS, ACCOUNT_TYPE_WORDS } from './words';

/**
 * The chart as a table, and one account's ledger beneath it when a row is
 * opened (docs/SPEC/accounting.md section 5.3). The balance shown is the
 * account's own direction, computed on the server; nothing here adds up money.
 */

type State =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; accounts: readonly AccountRow[] };

const THIS_YEAR_START = () => `${new Date().getUTCFullYear()}-01-01`;
const THIS_YEAR_END = () => `${new Date().getUTCFullYear()}-12-31`;

export function AccountsSection({ reloadKey }: { reloadKey: number }) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [from, setFrom] = useState(THIS_YEAR_START);
  const [to, setTo] = useState(THIS_YEAR_END);
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);

  useEffect(() => {
    void apiFetch('/api/accounting/accounts')
      .then(async (res) => {
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        setState({ kind: 'ready', accounts: AccountsResponse.parse(await res.json()).accounts });
      })
      .catch(() => setState({ kind: 'error' }));
  }, [apiFetch, reloadKey]);

  const openLedger = useCallback(
    (account: AccountRow) => {
      void apiFetch(`/api/accounting/accounts/${account.id}/ledger?from=${from}&to=${to}`)
        .then(async (res) => {
          if (!res.ok) {
            return;
          }
          setLedger(LedgerResponse.parse(await res.json()));
        })
        .catch(() => undefined);
    },
    [apiFetch, from, to],
  );

  const columns = useMemo<Column<AccountRow>[]>(
    () => [
      { key: 'code', header: 'Code', render: (row) => row.code },
      { key: 'name', header: 'Name', render: (row) => row.name },
      { key: 'type', header: 'Kind', render: (row) => ACCOUNT_TYPE_WORDS[row.type] },
      {
        key: 'role',
        header: 'Used for',
        render: (row) => (row.role ? ACCOUNT_ROLE_WORDS[row.role] : ''),
      },
      {
        key: 'balance',
        header: 'Balance (AED)',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.balanceFils),
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (row) => (
          <Button variant="quiet" onClick={() => openLedger(row)}>
            {`Open ${row.code}`}
          </Button>
        ),
      },
    ],
    [openLedger],
  );

  return (
    <>
      {state.kind === 'loading' ? <Note>Reading the chart.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The chart could not be read just now. Try again.</Note>
      ) : null}
      {state.kind === 'ready' ? (
        <Table
          caption="The chart of accounts"
          columns={columns}
          rows={state.accounts.filter((account) => account.archivedAt === null)}
          rowKey={(row) => row.id}
          empty="The practice has no accounts yet."
        />
      ) : null}

      <div className="filters">
        <Field
          id="ledger-from"
          label="Ledger from"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Field
          id="ledger-to"
          label="Ledger to"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {ledger ? (
        <section className="entry-lines" aria-label={`Ledger of ${ledger.account.code}`}>
          <p className="small muted">
            {`Opening balance ${formatFils(ledger.openingBalanceFils)}, closing balance ${formatFils(
              ledger.closingBalanceFils,
            )}.`}
          </p>
          <Table
            caption={`${ledger.account.code} ${ledger.account.name}`}
            columns={[
              { key: 'entry', header: 'Entry', render: (row) => row.entryReference },
              { key: 'day', header: 'Day', render: (row) => formatDate(row.enteredOn) },
              { key: 'memo', header: 'What it is', render: (row) => row.memo },
              {
                key: 'debit',
                header: 'Debit (AED)',
                numeric: true,
                align: 'end',
                render: (row) => formatFils(row.debitFils),
              },
              {
                key: 'credit',
                header: 'Credit',
                numeric: true,
                align: 'end',
                render: (row) => formatFils(row.creditFils),
              },
              {
                key: 'running',
                header: 'Running balance (AED)',
                numeric: true,
                align: 'end',
                render: (row) => formatFils(row.runningBalanceFils),
              },
            ]}
            rows={ledger.rows}
            rowKey={(row) => `${row.entryReference}-${row.enteredOn}`}
            empty="Nothing was posted to this account in the period."
          />
        </section>
      ) : null}
    </>
  );
}
