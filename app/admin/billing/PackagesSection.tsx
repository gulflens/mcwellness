import { useCallback, useEffect, useMemo, useState } from 'react';
import { termWords } from '@domain/billing';
import { PackagesResponse, type PackageRow } from '../../api/billing/ledger-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { ArrowDownIcon, ArrowUpIcon, ChevronIcon } from '../../shell/components/Icons';
import { Table, type Column } from '../../shell/components/Table';
import { formatDate } from './BillingPage';
import { formatDiscount, formatFils } from './money';
import { PackageDrawer } from './PackageDrawer';
import { SellPackageDrawer } from './SellPackageDrawer';
import { SellSessionDrawer } from './SellSessionDrawer';
import { WithdrawPackageDrawer } from './WithdrawPackageDrawer';

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
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; packages: readonly PackageRow[]; vatRegistered: boolean };

/**
 * The reason a reinstatement carries: fixed, because there is no drawer to
 * ask a person for one, and this act needs the audit trail's own words, not
 * silence (round 62). Withdrawing asks; bringing a bundle back does not.
 */
const REINSTATE_REASON = 'Reinstated from the packages list';
const REINSTATE_FAILED_MESSAGE = 'This package could not be reinstated. Try again.';

/**
 * The practice orders its packages by hand, one place at a time (operator,
 * 20 October 2026). Like Reinstate, a move asks nothing, so its reason for the
 * audit trail is fixed.
 */
const MOVE_REASON = {
  up: 'Moved up in the packages list',
  down: 'Moved down in the packages list',
} as const;
const MOVE_FAILED_MESSAGE = 'The order could not be changed. Try again.';

/**
 * A bundle's contents, one service to a line (operator, 20 October 2026): a
 * comma-joined sentence made "2 × Brain map (QEEG)" hard to pick out of the row.
 */
function Contents({ row }: { row: PackageRow }) {
  return (
    <ul className="cell-wrap cell-lines" aria-label={`${row.name} contents`}>
      {row.components.map((component) => (
        <li key={component.serviceTypeId}>
          {`${component.quantity} × ${component.serviceTypeName}`}
        </li>
      ))}
    </ul>
  );
}

export function PackagesSection({ canWrite }: { canWrite: boolean }) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [addOpen, setAddOpen] = useState(false);
  const [selling, setSelling] = useState<PackageRow | null>(null);
  const [sellingSession, setSellingSession] = useState(false);
  const [withdrawing, setWithdrawing] = useState<PackageRow | null>(null);
  const [reinstatingId, setReinstatingId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [note, setNote] = useState<{ text: string; tone?: 'critical' } | null>(null);

  const load = useCallback(() => {
    void apiFetch('/api/billing/packages')
      .then(async (res) => {
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        const body = PackagesResponse.parse(await res.json());
        setState({ kind: 'ready', packages: body.packages, vatRegistered: body.vatRegistered });
      })
      .catch(() => setState({ kind: 'error' }));
  }, [apiFetch]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Bringing a withdrawn bundle back, from the folded list itself — no
   * drawer, because there is nothing to ask: the fixed reason above is the
   * whole of it (round 62). The list refetches on success, exactly as
   * Withdraw's own drawer does, so the row leaves the fold the moment it is
   * active again.
   */
  const reinstate = useCallback(
    async (row: PackageRow) => {
      setNote(null);
      setReinstatingId(row.id);
      try {
        const res = await apiFetch(`/api/billing/packages/${row.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-reason': REINSTATE_REASON },
          body: JSON.stringify({ status: 'active' }),
        });
        if (res.ok) {
          load();
          return;
        }
        setNote({ text: REINSTATE_FAILED_MESSAGE, tone: 'critical' });
      } catch {
        setNote({ text: REINSTATE_FAILED_MESSAGE, tone: 'critical' });
      } finally {
        setReinstatingId(null);
      }
    },
    [apiFetch, load],
  );

  /**
   * One place up or down. The server answers with the whole list in its new
   * order, so the table redraws from that rather than guessing it here. One
   * move at a time: every Move button waits while one is in flight.
   */
  const move = useCallback(
    async (row: PackageRow, direction: 'up' | 'down') => {
      setNote(null);
      setMoving(true);
      try {
        const res = await apiFetch(`/api/billing/packages/${row.id}/move`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-reason': MOVE_REASON[direction] },
          body: JSON.stringify({ direction }),
        });
        if (res.ok) {
          const body = PackagesResponse.parse(await res.json());
          setState({ kind: 'ready', packages: body.packages, vatRegistered: body.vatRegistered });
          return;
        }
        setNote({ text: MOVE_FAILED_MESSAGE, tone: 'critical' });
      } catch {
        setNote({ text: MOVE_FAILED_MESSAGE, tone: 'critical' });
      } finally {
        setMoving(false);
      }
    },
    [apiFetch],
  );

  // The main table's own rows: active bundles only, unchanged otherwise. A
  // withdrawn bundle moves to the folded group below rather than leaving the
  // table altogether (round 62).
  const activePackages = useMemo(
    () => (state.kind === 'ready' ? state.packages.filter((row) => row.status === 'active') : []),
    [state],
  );
  const withdrawnPackages =
    state.kind === 'ready' ? state.packages.filter((row) => row.status === 'inactive') : [];

  const columns = useMemo<Column<PackageRow>[]>(() => {
    const firstId = activePackages[0]?.id;
    const lastId = activePackages.at(-1)?.id;
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
              <span className="row-actions row-actions--buttons cell-action">
                {row.sellable ? (
                  <button
                    type="button"
                    className="button button--tonal button--compact"
                    onClick={() => {
                      setNote(null);
                      setSelling(row);
                    }}
                  >
                    Sell to a client
                  </button>
                ) : (
                  <span className="small muted">Needs a price for every service</span>
                )}
                <button
                  type="button"
                  className="button button--neutral button--compact"
                  onClick={() => {
                    setNote(null);
                    setWithdrawing(row);
                  }}
                >
                  Withdraw
                </button>
                <button
                  type="button"
                  className="button button--quiet button--icon"
                  aria-label={`Move ${row.name} up`}
                  title="Move up"
                  disabled={moving || row.id === firstId}
                  onClick={() => void move(row, 'up')}
                >
                  <ArrowUpIcon />
                </button>
                <button
                  type="button"
                  className="button button--quiet button--icon"
                  aria-label={`Move ${row.name} down`}
                  title="Move down"
                  disabled={moving || row.id === lastId}
                  onClick={() => void move(row, 'down')}
                >
                  <ArrowDownIcon />
                </button>
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'contents',
        header: 'Contents',
        render: (row) => <Contents row={row} />,
      },
      {
        key: 'list',
        header: 'List (AED)',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.listPriceFils),
      },
      {
        // What came off the list: the share when that is how it was set, the
        // sum when it was a sum (docs/SPEC/billing.md section 2.4).
        key: 'discount',
        header: 'Discount',
        numeric: true,
        align: 'end',
        render: (row) => (row.currentPrice ? formatDiscount(row.currentPrice) : '—'),
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
        // The term in the rule's own words, and "No expiry" where there is
        // none — a fact said plainly rather than a cell left blank for a
        // reader to guess at (the operator's ruling of 12 September 2026).
        render: (row) => termWords(row.term)?.en ?? 'No expiry',
      },
      {
        key: 'from',
        header: 'Priced from',
        numeric: true,
        render: (row) => (row.currentPrice ? formatDate(row.currentPrice.validFrom) : '—'),
      },
    ];
    return base;
  }, [canWrite, activePackages, moving, move]);

  // The folded group's own two columns: a name with Reinstate beside it, and
  // the contents — nothing else, because nothing else is sellable or priced
  // once a bundle is withdrawn (docs/SPEC/billing.md).
  const withdrawnColumns = useMemo<Column<PackageRow>[]>(() => {
    const name: Column<PackageRow> = {
      key: 'name',
      header: 'Package',
      render: (row) => (
        <span className="name">
          <span>{row.name}</span>
          {canWrite ? (
            <button
              type="button"
              className="button button--quiet cell-action"
              disabled={reinstatingId === row.id}
              onClick={() => void reinstate(row)}
            >
              Reinstate
            </button>
          ) : null}
        </span>
      ),
    };
    const contents: Column<PackageRow> = {
      key: 'contents',
      header: 'Contents',
      render: (row) => <Contents row={row} />,
    };
    return [name, contents];
  }, [canWrite, reinstatingId, reinstate]);

  // Drift is a fact about what the practice is still selling, so a withdrawn
  // bundle — priced or not, on sale or not — never raises it (round 62).
  const drifted = activePackages.filter(
    (row) => row.componentsTotalFils !== null && row.componentsTotalFils !== row.listPriceFils,
  );

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
        {canWrite ? (
          <Button
            variant="secondary"
            onClick={() => {
              setNote(null);
              setSellingSession(true);
            }}
          >
            Sell a session
          </Button>
        ) : null}
      </div>

      {note ? (
        <div role="status">
          <Note tone={note.tone}>{note.text}</Note>
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
      {/*
        One line, and only while it is true. The VAT column and the Total
        beside it read as a five per cent that is not charged unless something
        says the practice is outside the tax altogether (migration 406); the
        columns stay as they are, because they are right the day a
        registration is granted.
      */}
      {state.kind === 'ready' && !state.vatRegistered ? (
        <p className="small muted">
          The practice is not registered for VAT, so no VAT is charged and the total is the price.
        </p>
      ) : null}
      {state.kind === 'ready' ? (
        <Table
          caption="Packages"
          columns={columns}
          rows={activePackages}
          rowKey={(row) => row.id}
          empty={
            withdrawnPackages.length > 0
              ? 'Every package is withdrawn.'
              : 'No packages are set up yet.'
          }
        />
      ) : null}

      {withdrawnPackages.length > 0 ? (
        <details className="fold">
          <summary className="fold__summary">
            <span>{`Withdrawn (${withdrawnPackages.length})`}</span>
            <ChevronIcon className="fold__chevron" />
          </summary>
          <Table
            caption="Withdrawn packages"
            columns={withdrawnColumns}
            rows={withdrawnPackages}
            rowKey={(row) => row.id}
          />
        </details>
      ) : null}

      {addOpen ? (
        <PackageDrawer
          onClose={() => setAddOpen(false)}
          onCreated={(created) => {
            setAddOpen(false);
            setNote({
              text: `${created.name} is on sale at AED ${formatFils(created.currentPrice?.amountFils ?? 0)}.`,
            });
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
            setNote({ text: summary });
            load();
          }}
        />
      ) : null}

      {sellingSession ? (
        <SellSessionDrawer
          onClose={() => setSellingSession(false)}
          onSold={(summary) => {
            setSellingSession(false);
            setNote({ text: summary });
          }}
        />
      ) : null}

      {withdrawing ? (
        <WithdrawPackageDrawer
          bundle={withdrawing}
          onClose={() => setWithdrawing(null)}
          onWithdrawn={(updated) => {
            setWithdrawing(null);
            setNote({ text: `${updated.name} withdrawn.` });
            load();
          }}
        />
      ) : null}
    </>
  );
}
