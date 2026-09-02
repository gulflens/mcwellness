import { useCallback, useEffect, useMemo, useState } from 'react';
import { canActor } from '@domain/shared/actor';
import { PricesResponse, type PriceRow } from '../../api/billing/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import './billing.css';
import { formatFils } from './money';
import { PriceDrawer } from './PriceDrawer';

/**
 * The admin console's price list (docs/SPEC/billing.md: what the practice
 * sells and for how much), in the shape ClientsPage.tsx set: a page header,
 * loading and error notes, a table, and a right-side drawer to add a row.
 * Only the price in force today is shown, one row per active service — the
 * same rule `app/api/billing/prices.ts` enforces server-side.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; response: PricesResponse };

export function BillingPage() {
  const { apiFetch, session } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const actor = session.status === 'signed-in' ? session.actor : null;
  // Reads the same rule the API enforces (domain/shared/actor.ts,
  // 'billing.price.write'): owner, admin and finance may set a price; a
  // lead practitioner may only read the list. The rule lives once, in
  // domain/shared; this only asks it, never restates it.
  const canWrite =
    actor !== null && canActor(actor, { type: 'billing.price.write' }, {}, new Date());

  // No synchronous setState at the top (react-hooks/set-state-in-effect):
  // the initial "loading" note comes from useState's own default, exactly
  // as ClientsPage.tsx's own load effect does; a reload after adding a
  // price simply swaps stale rows for fresh ones once the fetch resolves.
  const load = useCallback(() => {
    void apiFetch('/api/billing/prices')
      .then(async (res) => {
        if (!res.ok) {
          setState({ kind: 'error', message: 'The price list could not be loaded. Try again.' });
          return;
        }
        setState({ kind: 'ready', response: PricesResponse.parse(await res.json()) });
      })
      .catch(() => {
        setState({ kind: 'error', message: 'The price list could not be loaded. Try again.' });
      });
  }, [apiFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo<Column<PriceRow>[]>(
    () => [
      {
        key: 'service',
        header: 'Service',
        render: (row) => (
          <span className="name">
            <span>{row.serviceTypeName}</span>
            {row.serviceTypeNameAr ? (
              <span className="name__ar small muted" lang="ar" dir="rtl">
                {row.serviceTypeNameAr}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'unitPrice',
        header: 'Unit price',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.unitPriceFils),
      },
      {
        key: 'vat',
        header: 'VAT',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.vatFils),
      },
      {
        key: 'total',
        header: 'Total',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.grossFils),
      },
      {
        key: 'validFrom',
        header: 'Effective from',
        numeric: true,
        render: (row) => row.validFrom,
      },
    ],
    [],
  );

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const onCreated = useCallback(() => {
    setDrawerOpen(false);
    load();
  }, [load]);

  return (
    <section className="page">
      <PageHeader
        title="Billing"
        aside={
          canWrite ? (
            <Button variant="primary" onClick={() => setDrawerOpen(true)}>
              Add price
            </Button>
          ) : null
        }
      />
      {state.kind === 'loading' ? <Note>Loading the price list.</Note> : null}
      {state.kind === 'error' ? <Note tone="critical">{state.message}</Note> : null}
      {state.kind === 'ready' ? (
        <Table
          caption="Current prices"
          columns={columns}
          rows={state.response.prices}
          rowKey={(row) => row.id}
          empty="No prices are set yet."
        />
      ) : null}
      {drawerOpen ? (
        <PriceDrawer
          currentPrices={state.kind === 'ready' ? state.response.prices : []}
          onClose={closeDrawer}
          onCreated={onCreated}
        />
      ) : null}
    </section>
  );
}
