import { useCallback, useEffect, useMemo, useState } from 'react';
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
        render: (row) => (
          <span className="name">
            <span>{row.name}</span>
            {row.nameAr ? (
              <span className="name__ar small muted" lang="ar" dir="rtl">
                {row.nameAr}
              </span>
            ) : null}
          </span>
        ),
      },
      { key: 'contents', header: 'Contents', render: (row) => contentsOf(row) },
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
        render: (row) =>
          row.currentPrice ? formatFils(row.currentPrice.amountFils) : 'Not on sale',
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
    if (!canWrite) {
      return base;
    }
    return [
      ...base,
      {
        key: 'sell',
        header: 'Sell',
        render: (row) =>
          row.sellable ? (
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setNote(null);
                setSelling(row);
              }}
            >
              Sell to a client
            </button>
          ) : (
            <span className="small muted">
              {row.status === 'inactive' ? 'Withdrawn' : 'Needs a price for every service'}
            </span>
          ),
      },
    ];
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
