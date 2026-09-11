import { useCallback, useEffect, useMemo, useState } from 'react';
import { termWords } from '@domain/billing';
import { canActor } from '@domain/shared/actor';
import { PricesResponse, type PriceRow } from '../../api/billing/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import './billing.css';
import { BalancesSection } from './BalancesSection';
import { InvoicesSection } from './InvoicesSection';
import { formatDiscount, formatFils } from './money';
import { PackagesSection } from './PackagesSection';
import { PriceDrawer } from './PriceDrawer';
import { ReceiptsSection } from './ReceiptsSection';

/**
 * The admin console's money screen, in the shape ClientsPage.tsx set: a page
 * header, loading and error notes, tables, and a right-side drawer to write
 * something.
 *
 * Five sections, one at a time. Prices is what the practice charges for a
 * single visit; Packages is what it charges for a programme; Balances is what
 * one family has left and owes; Invoices is the book, with the month's three
 * figures above it; Receipts is the money received. Each fetches only when it
 * is opened — the screen asks for nothing it is not showing, so opening
 * Billing costs one request, as it always did.
 *
 * Every figure on this screen is formatted by `money.ts` and by nothing else,
 * and every figure it formats was computed on the server: no screen in this
 * codebase does arithmetic on money.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const SECTIONS = [
  { key: 'prices', label: 'Prices' },
  { key: 'packages', label: 'Packages' },
  { key: 'balances', label: 'Balances' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'receipts', label: 'Receipts' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

// A date like RecordTimeline's own (app/admin/audit/RecordTimeline.tsx):
// Intl, en-GB, the practice's own time zone, never the raw "YYYY-MM-DD" the
// API sends. `validFrom` is a calendar date, not a timestamp, so the format
// is the compact "2 Sept 2026" a table row wants.
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** A date-only value is read at the practice's midnight, not UTC's. */
export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00+04:00`));
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; response: PricesResponse };

/** The section named in the address bar, or the first one. */
function sectionFromHash(): SectionKey {
  const named = window.location.hash.replace(/^#/, '');
  return SECTIONS.some((entry) => entry.key === named) ? (named as SectionKey) : 'prices';
}

export function BillingPage() {
  const { apiFetch, session } = useAuth();
  // In the address bar, so a reload — or a link sent to a colleague — lands
  // on the section the person was looking at rather than back on Prices.
  const [section, setSectionState] = useState<SectionKey>(sectionFromHash);
  const setSection = useCallback((next: SectionKey) => {
    setSectionState(next);
    window.history.replaceState(null, '', `#${next}`);
  }, []);

  useEffect(() => {
    const onHashChange = () => setSectionState(sectionFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Names the service and the new price once a save succeeds (the design
  // review's ask: a calm confirmation, not silence). It dismisses itself on
  // the next action this page offers — opening the drawer again — rather
  // than lingering once it no longer describes what's about to happen.
  const [successNote, setSuccessNote] = useState<string | null>(null);

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
    if (section === 'prices') {
      load();
    }
  }, [load, section]);

  const columns = useMemo<Column<PriceRow>[]>(
    () => [
      {
        key: 'service',
        header: 'Service',
        render: (row) => (
          <span className="name">
            <span>{row.serviceTypeName}</span>
          </span>
        ),
      },
      {
        // The one column that names the currency (docs/DESIGN-BRIEF.md: say
        // it once); every other money column is obviously the same currency
        // and stays bare.
        key: 'listPrice',
        header: 'List price (AED)',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.listPriceFils),
      },
      {
        // The share when that is how the discount was set, the sum when it
        // was a sum, and an em dash when there is none: the column says what
        // was given, not how the row happens to store it.
        key: 'discount',
        header: 'Discount',
        numeric: true,
        align: 'end',
        render: (row) => formatDiscount(row),
      },
      {
        key: 'unitPrice',
        header: 'Price',
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
        // How long a credit sold at this price lasts, in the rule's own words,
        // and "No expiry" where the price sets no term. A term on a price is
        // carried forward through every amendment, so this list is where it is
        // seen — read exactly as the Packages list's own "Runs for" column is.
        key: 'term',
        header: 'Runs for',
        numeric: true,
        render: (row) => termWords(row.term)?.en ?? 'No expiry',
      },
      {
        key: 'validFrom',
        header: 'Effective from',
        numeric: true,
        render: (row) => formatDate(row.validFrom),
      },
    ],
    [],
  );

  const openDrawer = useCallback(() => {
    setSuccessNote(null);
    setDrawerOpen(true);
  }, []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const onCreated = useCallback(
    (price: PriceRow) => {
      setDrawerOpen(false);
      setSuccessNote(
        `${price.serviceTypeName}'s price is now AED ${formatFils(price.unitPriceFils)}.`,
      );
      load();
    },
    [load],
  );

  return (
    <section className="page">
      <PageHeader
        title="Billing"
        // Always an element, never null: the header's action space is the
        // same height whether or not it holds a button, so the tabs beneath
        // stay where they are as the reader moves between sections. They used
        // to shift by 6px on every change, which is exactly enough to make a
        // person doubt they clicked the thing they clicked.
        action={
          <span className="header-action">
            {section === 'prices' && canWrite ? (
              <Button variant="secondary" onClick={openDrawer}>
                Add price
              </Button>
            ) : null}
          </span>
        }
      />

      <nav className="sections" aria-label="Billing sections">
        {SECTIONS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`sections__tab${section === entry.key ? ' sections__tab--current' : ''}`}
            aria-current={section === entry.key ? 'page' : undefined}
            onClick={() => setSection(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {section === 'prices' ? (
        <>
          {successNote ? (
            <div role="status">
              <Note>{successNote}</Note>
            </div>
          ) : null}
          {state.kind === 'loading' ? <Note>Loading the price list.</Note> : null}
          {state.kind === 'error' ? <Note tone="critical">{state.message}</Note> : null}
          {/*
            One line, and only while it is true. The VAT column and the Total
            beside it read as a five per cent that is not charged unless
            something says the practice is outside the tax altogether
            (migration 406); the columns stay as they are, because they are
            right the day a registration is granted.
          */}
          {state.kind === 'ready' && !state.response.vatRegistered ? (
            <p className="small muted">
              The practice is not registered for VAT, so no VAT is charged and the total is the
              price.
            </p>
          ) : null}
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
              onClose={closeDrawer}
              onCreated={onCreated}
              // The rows already on screen, so the drawer can show the term
              // the price it supersedes carries without asking for it again.
              currentPrices={state.kind === 'ready' ? state.response.prices : []}
            />
          ) : null}
        </>
      ) : null}

      {section === 'packages' ? <PackagesSection canWrite={canWrite} /> : null}
      {section === 'balances' ? <BalancesSection canWrite={canWrite} /> : null}
      {section === 'invoices' ? <InvoicesSection /> : null}
      {section === 'receipts' ? <ReceiptsSection /> : null}
    </section>
  );
}
