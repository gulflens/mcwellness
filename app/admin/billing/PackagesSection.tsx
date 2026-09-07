import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PackagesResponse, type PackageRow } from '../../api/billing/ledger-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { formatDate } from './BillingPage';
import { formatFils } from './money';
import { PackageDrawer } from './PackageDrawer';
import { SellPackageDrawer } from './SellPackageDrawer';

/**
 * What the practice sells as a programme, beside what it sells as a single
 * visit.
 *
 * Two money columns, because there are two figures and neither is derived
 * from the other: "List" is what the contents come to bought one at a time,
 * and "Price now" is what it is actually selling for. A bundle whose contents
 * have drifted away from its published list price says so quietly rather than
 * silently correcting one of the two — that is the founder's decision to
 * take, not the screen's.
 */

type State =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; packages: readonly PackageRow[] };

function contentsOf(row: PackageRow): string {
  return row.components
    .map((component) => `${component.quantity} × ${component.serviceTypeName}`)
    .join(', ');
}

/**
 * Text in a table cell that is allowed to take a second line.
 *
 * The shell's `.ledger td` is `nowrap`, which is right for a figure and wrong
 * for a sentence: the contents of a programme and the reason behind its price
 * are both sentences, and holding them on one line pushed this table past
 * 1,600px — so at 1024 and even at 1440 the action at the end of the row was
 * off-screen entirely. White space inherits, so a block child sets it back.
 */
function Wrapped({ children }: { children: ReactNode }) {
  return <span className="cell-wrap">{children}</span>;
}

export function PackagesSection({ canWrite }: { canWrite: boolean }) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [addOpen, setAddOpen] = useState(false);
  const [selling, setSelling] = useState<PackageRow | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    void apiFetch('/api/billing/packages')
      .then(async (res) => {
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        const body = PackagesResponse.parse(await res.json());
        setState({ kind: 'ready', packages: body.packages });
      })
      .catch(() => setState({ kind: 'error' }));
  }, [apiFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo<Column<PackageRow>[]>(() => {
    const base: Column<PackageRow>[] = [
      {
        key: 'name',
        header: 'Package',
        // The row's own action lives here, in the first column, rather than
        // in one of its own at the far end: the first column is the one the
        // shell pins when the table scrolls sideways, so "Sell to a client"
        // is reachable at every width instead of only on a wide screen.
        render: (row) => (
          <span className="name">
            <span>{row.name}</span>
            {canWrite ? (
              row.sellable ? (
                <button
                  type="button"
                  className="button button--quiet cell-action"
                  onClick={() => {
                    setNote(null);
                    setSelling(row);
                  }}
                >
                  Sell to a client
                </button>
              ) : (
                <span className="small muted cell-action">
                  {row.status === 'inactive' ? 'Withdrawn' : 'Needs a price for every service'}
                </span>
              )
            ) : null}
          </span>
        ),
      },
      {
        key: 'contents',
        header: 'Contents',
        render: (row) => <Wrapped>{contentsOf(row)}</Wrapped>,
      },
      {
        key: 'list',
        header: 'List (AED)',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.listPriceFils),
      },
      {
        key: 'price',
        header: 'Price now',
        numeric: true,
        align: 'end',
        // The figure and why it is the figure. A price list where "AED
        // 10,325" sits alone invites the question this column already holds
        // the answer to — the reason is written on the row when the founder
        // sets it, and reading it should not need a second screen.
        render: (row) =>
          row.currentPrice ? (
            <span className="name">
              <span className="numeric">{formatFils(row.currentPrice.amountFils)}</span>
              <span className="small muted cell-wrap">{row.currentPrice.amendmentReason}</span>
            </span>
          ) : (
            'Not on sale'
          ),
      },
      {
        key: 'vat',
        header: 'VAT',
        numeric: true,
        align: 'end',
        render: (row) => (row.currentPrice ? formatFils(row.currentPrice.vatFils) : '—'),
      },
      {
        key: 'total',
        header: 'Total',
        numeric: true,
        align: 'end',
        render: (row) => (row.currentPrice ? formatFils(row.currentPrice.grossFils) : '—'),
      },
      {
        key: 'expiry',
        header: 'Runs for',
        numeric: true,
        render: (row) => `${row.expiryMonths} months`,
      },
      {
        key: 'from',
        header: 'Priced from',
        numeric: true,
        render: (row) => (row.currentPrice ? formatDate(row.currentPrice.validFrom) : '—'),
      },
    ];
    return base;
  }, [canWrite]);

  const drifted =
    state.kind === 'ready'
      ? state.packages.filter(
          (row) =>
            row.componentsTotalFils !== null && row.componentsTotalFils !== row.listPriceFils,
        )
      : [];

  return (
    <>
      <div className="section__actions">
        {canWrite ? (
          <Button
            variant="secondary"
            onClick={() => {
              setNote(null);
              setAddOpen(true);
            }}
          >
            Add package
          </Button>
        ) : null}
      </div>

      {note ? (
        <div role="status">
          <Note>{note}</Note>
        </div>
      ) : null}
      {state.kind === 'loading' ? <Note>Loading the packages.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The packages could not be loaded. Try again.</Note>
      ) : null}
      {drifted.length > 0 ? (
        <Note>
          {drifted.length === 1
            ? `${drifted[0]?.name}'s list price no longer matches what its contents cost one at a time.`
            : `${drifted.length} packages have a list price that no longer matches what their contents cost one at a time.`}
        </Note>
      ) : null}
      {state.kind === 'ready' ? (
        <Table
          caption="Packages"
          columns={columns}
          rows={state.packages}
          rowKey={(row) => row.id}
          empty="No packages are set up yet."
        />
      ) : null}

      {addOpen ? (
        <PackageDrawer
          onClose={() => setAddOpen(false)}
          onCreated={(created) => {
            setAddOpen(false);
            setNote(
              `${created.name} is on sale at AED ${formatFils(created.currentPrice?.amountFils ?? 0)}.`,
            );
            load();
          }}
        />
      ) : null}

      {selling ? (
        <SellPackageDrawer
          bundle={selling}
          onClose={() => setSelling(null)}
          onSold={(summary) => {
            setSelling(null);
            setNote(summary);
            load();
          }}
        />
      ) : null}
    </>
  );
}
