import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  BalanceSheetResponse,
  CashFlowResponse,
  ProfitAndLossResponse,
  TrialBalanceResponse,
} from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { Table } from '../../shell/components/Table';
import { DOWNLOAD_REFUSED, downloadCsv } from './download';
import { formatFils } from './money';
import { ACCOUNT_TYPE_WORDS } from './words';

/**
 * The four statements, each with the same rows as a file (docs/SPEC/accounting.md
 * sections 4.5, 4.6 and 5.4). Every file is fetched and never linked to: the
 * API admits nothing without the bearer token and the token lives only inside
 * `apiFetch`, so a plain `<a href="/api/...">` would be a link to a 401
 * (./download.ts).
 *
 * The balance sheet's two computed lines say so in their own labels: there are
 * no closing entries in these books, so retained earnings and the year's result
 * are arithmetic and not accounts.
 */

type Statements = {
  trialBalance: TrialBalanceResponse;
  profitAndLoss: ProfitAndLossResponse;
  balanceSheet: BalanceSheetResponse;
  cashFlow: CashFlowResponse;
};

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; statements: Statements };

const YEAR_START = () => `${new Date().getUTCFullYear()}-01-01`;
const YEAR_END = () => `${new Date().getUTCFullYear()}-12-31`;

const MONEY_COLUMNS = [
  { key: 'code', header: 'Code', render: (row: { accountCode: string }) => row.accountCode },
  { key: 'name', header: 'Account', render: (row: { accountName: string }) => row.accountName },
  {
    key: 'kind',
    header: 'Kind',
    render: (row: { accountType: keyof typeof ACCOUNT_TYPE_WORDS }) =>
      ACCOUNT_TYPE_WORDS[row.accountType],
  },
  {
    key: 'balance',
    header: 'Balance (AED)',
    numeric: true,
    align: 'end' as const,
    render: (row: { balanceFils: number }) => formatFils(row.balanceFils),
  },
];

/**
 * One file, one press. The sentence a refusal shows is fixed and lives beside
 * the button that asked for it, so a person who pressed low on a long page is
 * told there and not at the top of it.
 */
function DownloadCsv({ path, children }: { path: string; children: ReactNode }) {
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  function press(): void {
    setBusy(true);
    setRefused(false);
    void downloadCsv(apiFetch, path)
      .then((arrived) => setRefused(!arrived))
      .finally(() => setBusy(false));
  }

  return (
    <>
      <Button variant="quiet" disabled={busy} onClick={press}>
        {children}
      </Button>
      {refused ? <Note tone="critical">{DOWNLOAD_REFUSED}</Note> : null}
    </>
  );
}

export function StatementsSection() {
  const { apiFetch } = useAuth();
  const [from, setFrom] = useState(YEAR_START);
  const [to, setTo] = useState(YEAR_END);
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(() => {
    const period = `from=${from}&to=${to}`;
    void Promise.all([
      apiFetch(`/api/accounting/statements/trial-balance?asOf=${to}`),
      apiFetch(`/api/accounting/statements/profit-and-loss?${period}`),
      apiFetch(`/api/accounting/statements/balance-sheet?asOf=${to}`),
      apiFetch(`/api/accounting/statements/cash-flow?${period}`),
    ])
      .then(async ([tb, pl, bs, cf]) => {
        if (!tb.ok || !pl.ok || !bs.ok || !cf.ok) {
          setState({ kind: 'error' });
          return;
        }
        setState({
          kind: 'ready',
          statements: {
            trialBalance: TrialBalanceResponse.parse(await tb.json()),
            profitAndLoss: ProfitAndLossResponse.parse(await pl.json()),
            balanceSheet: BalanceSheetResponse.parse(await bs.json()),
            cashFlow: CashFlowResponse.parse(await cf.json()),
          },
        });
      })
      .catch(() => setState({ kind: 'error' }));
  }, [apiFetch, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const period = `from=${from}&to=${to}`;

  return (
    <>
      <div className="filters">
        <Field
          id="statements-from"
          label="From"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Field
          id="statements-to"
          label="To"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {state.kind === 'loading' ? <Note>Reading the books.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The statements could not be read just now. Try again.</Note>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <section aria-label="Trial balance">
            <h3>Trial balance</h3>
            <Table
              caption={`As at ${state.statements.trialBalance.asOf}`}
              columns={[
                ...MONEY_COLUMNS.slice(0, 3),
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
              ]}
              rows={state.statements.trialBalance.rows}
              rowKey={(row) => row.accountCode}
              empty="Nothing has been posted yet."
            />
            <DownloadCsv path={`/api/accounting/statements/trial-balance.csv?asOf=${to}`}>
              Download the trial balance
            </DownloadCsv>
          </section>

          <section aria-label="Profit and loss">
            <h3>Profit and loss</h3>
            <Table
              caption={`${from} to ${to}`}
              columns={MONEY_COLUMNS}
              rows={[
                ...state.statements.profitAndLoss.income,
                ...state.statements.profitAndLoss.expenses,
              ]}
              rowKey={(row) => row.accountCode}
              empty="Nothing was earned or spent in this period."
            />
            <p className="small muted">
              {`Income ${formatFils(state.statements.profitAndLoss.incomeFils)}, expenses ${formatFils(
                state.statements.profitAndLoss.expenseFils,
              )}, result ${formatFils(state.statements.profitAndLoss.resultFils)}.`}
            </p>
            <DownloadCsv path={`/api/accounting/statements/profit-and-loss.csv?${period}`}>
              Download the profit and loss
            </DownloadCsv>
          </section>

          <section aria-label="Balance sheet">
            <h3>Balance sheet</h3>
            <Table
              caption={`As at ${state.statements.balanceSheet.asOf}`}
              columns={MONEY_COLUMNS}
              rows={[
                ...state.statements.balanceSheet.assets,
                ...state.statements.balanceSheet.liabilities,
                ...state.statements.balanceSheet.equity,
                {
                  accountCode: '',
                  accountName: 'Result for the year to date, computed',
                  accountType: 'equity' as const,
                  balanceFils: state.statements.balanceSheet.resultYearToDateFils,
                },
                {
                  accountCode: '',
                  accountName: 'Retained earnings, computed',
                  accountType: 'equity' as const,
                  balanceFils: state.statements.balanceSheet.retainedEarningsFils,
                },
              ]}
              rowKey={(row) => `${row.accountCode}-${row.accountName}`}
              empty="Nothing has been posted yet."
            />
            <p className="small muted">
              {`Assets ${formatFils(
                state.statements.balanceSheet.totalAssetsFils,
              )} against liabilities and equity ${formatFils(
                state.statements.balanceSheet.totalLiabilitiesAndEquityFils,
              )}.`}
            </p>
            <DownloadCsv path={`/api/accounting/statements/balance-sheet.csv?asOf=${to}`}>
              Download the balance sheet
            </DownloadCsv>
          </section>

          <section aria-label="Cash flow">
            <h3>Cash flow</h3>
            <Table
              caption={`${from} to ${to}`}
              columns={[
                { key: 'heading', header: 'Heading', render: (row) => row.heading },
                {
                  key: 'amount',
                  header: 'Amount (AED)',
                  numeric: true,
                  align: 'end',
                  render: (row) => formatFils(row.amountFils),
                },
              ]}
              rows={[
                {
                  heading: 'From households',
                  amountFils: state.statements.cashFlow.byCategory.fromHouseholds,
                },
                {
                  heading: 'For expenses and suppliers',
                  amountFils: state.statements.cashFlow.byCategory.forExpenses,
                },
                {
                  heading: 'To owners and shareholders',
                  amountFils: state.statements.cashFlow.byCategory.toOwners,
                },
                { heading: 'Tax', amountFils: state.statements.cashFlow.byCategory.tax },
                { heading: 'Other', amountFils: state.statements.cashFlow.byCategory.other },
                {
                  heading: 'Transfers between cash accounts',
                  amountFils: state.statements.cashFlow.byCategory.transfers,
                },
                { heading: 'Opening cash', amountFils: state.statements.cashFlow.openingCashFils },
                { heading: 'Net change', amountFils: state.statements.cashFlow.netChangeFils },
                { heading: 'Closing cash', amountFils: state.statements.cashFlow.closingCashFils },
              ]}
              rowKey={(row) => row.heading}
              empty="No money moved in this period."
            />
            <DownloadCsv path={`/api/accounting/statements/cash-flow.csv?${period}`}>
              Download the cash flow
            </DownloadCsv>
          </section>

          <section aria-label="Exports" className="exports">
            <DownloadCsv path={`/api/accounting/exports/zoho-journal.csv?${period}`}>
              Download the journal for Zoho Books
            </DownloadCsv>
            <DownloadCsv path="/api/accounting/exports/zoho-accounts.csv">
              Download the chart for Zoho Books
            </DownloadCsv>
          </section>
        </>
      ) : null}
    </>
  );
}
