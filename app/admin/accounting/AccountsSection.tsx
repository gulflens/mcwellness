import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccountsResponse, LedgerResponse, type AccountRow } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { DateField } from '../../shell/components/DateField';
import { Table, type Column } from '../../shell/components/Table';
import { formatDate, formatFils } from './money';
import { ViewDrawer } from './ViewDrawer';
import { ACCOUNT_ROLE_WORDS, ACCOUNT_TYPE_WORDS } from './words';

/**
 * The chart as a table, and one account's ledger in a drawer beside it when a
 * row is opened (docs/SPEC/accounting.md section 5.3). The balance shown is the
 * account's own direction, computed on the server; nothing here adds up money.
 */

type State =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; accounts: readonly AccountRow[] };

const OPEN_REFUSED =
  'This ledger could not be opened. Try again, or sign in again if it keeps happening.';

/** The account opened in the drawer, and how far reading its ledger has got. */
type Opened = {
  account: AccountRow;
  read: { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; ledger: LedgerResponse };
};

const THIS_YEAR_START = () => `${new Date().getUTCFullYear()}-01-01`;
const THIS_YEAR_END = () => `${new Date().getUTCFullYear()}-12-31`;

export function AccountsSection({ reloadKey }: { reloadKey: number }) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [from, setFrom] = useState(THIS_YEAR_START);
  const [to, setTo] = useState(THIS_YEAR_END);
  const [opened, setOpened] = useState<Opened | null>(null);

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
      // The drawer opens at once; the read fills it, or says it failed. A
      // later answer for an account no longer open is dropped.
      setOpened({ account, read: { kind: 'loading' } });
      const settle = (read: Opened['read']) =>
        setOpened((current) => (current?.account.id === account.id ? { account, read } : current));
      void apiFetch(`/api/accounting/accounts/${account.id}/ledger?from=${from}&to=${to}`)
        .then(async (res) => {
          if (!res.ok) {
            settle({ kind: 'error' });
            return;
          }
          settle({ kind: 'ready', ledger: LedgerResponse.parse(await res.json()) });
        })
        .catch(() => settle({ kind: 'error' }));
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
        <DateField id="ledger-from" label="Ledger from" value={from} onChange={setFrom} />
        <DateField id="ledger-to" label="Ledger to" value={to} onChange={setTo} />
      </div>

      {opened ? (
        <ViewDrawer
          id="account-ledger"
          title={`${opened.account.code} ${opened.account.name}`}
          onClose={() => setOpened(null)}
        >
          {opened.read.kind === 'loading' ? <Note>Reading the ledger.</Note> : null}
          {opened.read.kind === 'error' ? <Note tone="critical">{OPEN_REFUSED}</Note> : null}
          {opened.read.kind === 'ready' ? <Ledger ledger={opened.read.ledger} /> : null}
        </ViewDrawer>
      ) : null}
    </>
  );
}

/** One account's ledger for the period, as the drawer shows it. */
function Ledger({ ledger }: { ledger: LedgerResponse }) {
  return (
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
            // AED is named once per table: 'Debit (AED)' above carries it
            // for the three money columns (docs/DESIGN-BRIEF.md).
            header: 'Running balance',
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
  );
}
