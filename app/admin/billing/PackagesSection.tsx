import { useCallback, useEffect, useMemo, useState } from 'react';
import { PackagesResponse, type PackageRow } from '../../api/billing/ledger-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { ChevronIcon } from '../../shell/components/Icons';
import { formatFils } from './money';
import { PackageDrawer } from './PackageDrawer';
import { PackageGrid, PackageTile, WithdrawnTile } from './PackageGrid';
import { PackageReorder } from './PackageReorder';
import { SellPackageDrawer } from './SellPackageDrawer';
import { SellSessionDrawer } from './SellSessionDrawer';
import { WithdrawPackageDrawer } from './WithdrawPackageDrawer';

/**
 * What the practice sells as a programme, beside what it sells as a single
 * visit.
 *
 * "List" is what the contents come to bought one at a time; the Discount,
 * VAT and Total figures say what it actually sells for, and the note why (the
 * operator dropped a Price now column on 20 October 2026: while the practice
 * is not registered for VAT it only repeated Total). A bundle whose contents
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
 * The practice orders its packages by hand, by carrying one to its place on
 * the Reorder board (operator, 20 October 2026). Like Reinstate, a reorder
 * asks nothing, so its reason for the audit trail is fixed.
 */
const REORDER_REASON = 'Reordered in the packages list';
const REORDER_FAILED_MESSAGE = 'The order could not be changed. Try again.';

export function PackagesSection({ canWrite }: { canWrite: boolean }) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [addOpen, setAddOpen] = useState(false);
  const [selling, setSelling] = useState<PackageRow | null>(null);
  const [sellingSession, setSellingSession] = useState(false);
  const [withdrawing, setWithdrawing] = useState<PackageRow | null>(null);
  const [editingRow, setEditingRow] = useState<PackageRow | null>(null);
  const [reinstatingId, setReinstatingId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
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
   * The whole order at once, shown the moment the package is let go and then
   * replaced by the server's answer. A failed save puts the list back as the
   * server has it and says so. One save at a time: the board waits.
   */
  const saveOrder = useCallback(
    async (order: string[]) => {
      setNote(null);
      setSavingOrder(true);
      setState((current) => {
        if (current.kind !== 'ready') return current;
        const place = new Map(order.map((id, index) => [id, index]));
        const packages = [...current.packages].sort(
          (a, b) => (place.get(a.id) ?? Infinity) - (place.get(b.id) ?? Infinity),
        );
        return { ...current, packages };
      });
      try {
        const res = await apiFetch('/api/billing/packages/reorder', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-reason': REORDER_REASON },
          body: JSON.stringify({ order }),
        });
        if (res.ok) {
          const body = PackagesResponse.parse(await res.json());
          setState({ kind: 'ready', packages: body.packages, vatRegistered: body.vatRegistered });
          return;
        }
        setNote({ text: REORDER_FAILED_MESSAGE, tone: 'critical' });
        load();
      } catch {
        setNote({ text: REORDER_FAILED_MESSAGE, tone: 'critical' });
        load();
      } finally {
        setSavingOrder(false);
      }
    },
    [apiFetch, load],
  );

  // The main grid's own tiles: active bundles only, unchanged otherwise. A
  // withdrawn bundle moves to the folded group below rather than leaving the
  // page altogether (round 62).
  const activePackages = useMemo(
    () => (state.kind === 'ready' ? state.packages.filter((row) => row.status === 'active') : []),
    [state],
  );
  const withdrawnPackages =
    state.kind === 'ready' ? state.packages.filter((row) => row.status === 'inactive') : [];

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
        {/* Two packages or more: one alone has no order to set. */}
        {canWrite && (reordering || activePackages.length > 1) ? (
          <Button
            variant="secondary"
            aria-pressed={reordering}
            onClick={() => {
              setNote(null);
              setReordering((on) => !on);
            }}
          >
            {reordering ? 'Done' : 'Reorder'}
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
        One line, and only while it is true. The VAT figure and the Total
        beside it read as a five per cent that is not charged unless something
        says the practice is outside the tax altogether (migration 406); the
        figures stay as they are, because they are right the day a
        registration is granted.
      */}
      {state.kind === 'ready' && !state.vatRegistered ? (
        <p className="small muted">
          The practice is not registered for VAT, so no VAT is charged and the total is the price.
        </p>
      ) : null}
      {state.kind === 'ready' && reordering ? (
        <PackageReorder rows={activePackages} saving={savingOrder} onReorder={saveOrder} />
      ) : null}
      {state.kind === 'ready' && !reordering ? (
        <PackageGrid
          label="Packages"
          rows={activePackages}
          empty={
            withdrawnPackages.length > 0
              ? 'Every package is withdrawn.'
              : 'No packages are set up yet.'
          }
        >
          {(row) => (
            <PackageTile
              row={row}
              canWrite={canWrite}
              onSell={() => {
                setNote(null);
                setSelling(row);
              }}
              onEdit={() => {
                setNote(null);
                setEditingRow(row);
              }}
              onWithdraw={() => {
                setNote(null);
                setWithdrawing(row);
              }}
            />
          )}
        </PackageGrid>
      ) : null}

      {withdrawnPackages.length > 0 ? (
        <details className="fold">
          <summary className="fold__summary">
            <span>{`Withdrawn (${withdrawnPackages.length})`}</span>
            <ChevronIcon className="fold__chevron" />
          </summary>
          <PackageGrid label="Withdrawn packages" rows={withdrawnPackages}>
            {(row) => (
              <WithdrawnTile
                row={row}
                canWrite={canWrite}
                reinstating={reinstatingId === row.id}
                onReinstate={() => void reinstate(row)}
              />
            )}
          </PackageGrid>
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

      {editingRow ? (
        <PackageDrawer
          editing={editingRow}
          onClose={() => setEditingRow(null)}
          onCreated={(saved) => {
            setEditingRow(null);
            setNote({ text: `${saved.name} updated.` });
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
