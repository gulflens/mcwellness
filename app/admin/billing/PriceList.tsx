import { useMemo } from 'react';
import { termWords } from '@domain/billing';
import type { PriceRow } from '../../api/billing/schema';
import { Table, type Column } from '../../shell/components/Table';
import { formatDate } from './BillingPage';
import { formatDiscount, formatFils } from './money';
import { roomFor, useWidth } from './useWidth';

/**
 * The price list: one current price per service, so a handful of rows
 * (operator, 20 October 2026). With a desk's room it is the ledger's own
 * table, the reason for each price beneath the service it prices and a
 * "Change price" at the end of the row; below that it is one card per
 * service, the total beside the name and every other figure named beside its
 * value, because a card has no column header to name it.
 *
 * Eight columns need about 900px to sit on one line each, which a tablet
 * beside the rail does not have.
 */
const TABLE_NEEDS = 900;

export function PriceList({
  prices,
  canWrite,
  onChange,
}: {
  prices: readonly PriceRow[];
  canWrite: boolean;
  onChange: (row: PriceRow) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();

  const columns = useMemo<Column<PriceRow>[]>(() => {
    const base: Column<PriceRow>[] = [
      {
        key: 'service',
        header: 'Service',
        // Why the price is the price, as it was written when it was set.
        render: (row) => (
          <span className="name">
            <span>{row.serviceTypeName}</span>
            <span className="small muted cell-wrap">{row.amendmentReason}</span>
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
        render: (row) => <strong className="price-total">{formatFils(row.grossFils)}</strong>,
      },
      {
        // How long a credit sold at this price lasts, in the rule's own words,
        // and "No expiry" where the price sets no term. A term on a price is
        // carried forward through every amendment, so this list is where it is
        // seen — read exactly as the Packages tiles' own "Runs for" is.
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
    ];
    if (canWrite) {
      base.push({
        key: 'change',
        header: 'Change',
        fit: true,
        render: (row) => (
          <ChangeButton row={row} onChange={onChange} className="button button--quiet" />
        ),
      });
    }
    return base;
  }, [canWrite, onChange]);

  return (
    <div ref={ref} className="price-list">
      {roomFor(width, TABLE_NEEDS) ? (
        <Table
          caption="Current prices"
          columns={columns}
          rows={prices}
          rowKey={(row) => row.id}
          empty="No prices are set yet."
        />
      ) : prices.length === 0 ? (
        <p className="small muted">No prices are set yet.</p>
      ) : (
        <ul className="price-cards" aria-label="Current prices">
          {prices.map((row) => (
            <li key={row.id}>
              <PriceCard row={row} canWrite={canWrite} onChange={onChange} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PriceCard({
  row,
  canWrite,
  onChange,
}: {
  row: PriceRow;
  canWrite: boolean;
  onChange: (row: PriceRow) => void;
}) {
  return (
    <article className="price-card" aria-label={row.serviceTypeName}>
      <header className="price-card__head">
        <h3 className="price-card__name">{row.serviceTypeName}</h3>
        <p className="price-card__total">
          <span className="small muted">AED </span>
          <span className="numeric">{formatFils(row.grossFils)}</span>
        </p>
      </header>
      <p className="small muted price-card__reason">{row.amendmentReason}</p>
      <dl className="tile__figures">
        <div>
          <dt>List price (AED)</dt>
          <dd className="numeric">{formatFils(row.listPriceFils)}</dd>
        </div>
        <div>
          <dt>Discount</dt>
          <dd className="numeric">{formatDiscount(row)}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd className="numeric">{formatFils(row.unitPriceFils)}</dd>
        </div>
        <div>
          <dt>VAT</dt>
          <dd className="numeric">{formatFils(row.vatFils)}</dd>
        </div>
        <div>
          <dt>Runs for</dt>
          <dd>{termWords(row.term)?.en ?? 'No expiry'}</dd>
        </div>
        <div>
          <dt>Effective from</dt>
          <dd className="numeric">{formatDate(row.validFrom)}</dd>
        </div>
      </dl>
      {canWrite ? (
        <ChangeButton
          row={row}
          onChange={onChange}
          className="button button--tonal button--compact price-card__change"
        />
      ) : null}
    </article>
  );
}

/**
 * Opens the price drawer on this service. A change adds a new price that
 * supersedes this one; nothing is edited in place (docs/SPEC/billing.md
 * section 2.3).
 */
function ChangeButton({
  row,
  onChange,
  className,
}: {
  row: PriceRow;
  onChange: (row: PriceRow) => void;
  className: string;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-label={`Change the price of ${row.serviceTypeName}`}
      onClick={() => onChange(row)}
    >
      Change price
    </button>
  );
}
