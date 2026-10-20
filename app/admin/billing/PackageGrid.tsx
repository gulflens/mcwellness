import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { termWords } from '@domain/billing';
import type { PackageRow } from '../../api/billing/ledger-schema';
import { ChevronIcon } from '../../shell/components/Icons';
import { formatDate } from './BillingPage';
import { formatDiscount, formatFils } from './money';

/**
 * The packages as one row of tiles rather than a table (operator, 20 October
 * 2026). On a wide screen every tile sits side by side; as the screen
 * narrows the row runs past its edge and slides sideways, a tile at a time,
 * like a shelf of films. It never wraps into a second row (billing.css,
 * `.package-grid`).
 *
 * The order is the practice's own, read from the start of the row, and is
 * set on its own board (PackageReorder.tsx), not from the tiles.
 */
export function PackageGrid<Row extends { id: string }>({
  label,
  rows,
  empty,
  children,
}: {
  label: string;
  rows: readonly Row[];
  empty?: ReactNode;
  children: (row: Row) => ReactNode;
}) {
  const rowRef = useRef<HTMLUListElement>(null);
  // Which ends of the row are out of sight. Both false while everything fits,
  // which is what hides the buttons on a wide screen.
  const [hidden, setHidden] = useState({ before: false, after: false });

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const overflow = row.scrollWidth - row.clientWidth;
    // Right-to-left scrolls into negative numbers; the distance is the same.
    const offset = Math.abs(row.scrollLeft);
    setHidden({ before: offset > 1, after: overflow - offset > 1 });
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    measure();
    row.addEventListener('scroll', measure, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resize?.observe(row);
    return () => {
      row.removeEventListener('scroll', measure);
      resize?.disconnect();
    };
  }, [measure, rows.length]);

  /** Most of a screen at a time, so the tile at the edge stays in view. */
  const slide = (towards: 'before' | 'after') => {
    const row = rowRef.current;
    if (!row) return;
    const rtl = getComputedStyle(row).direction === 'rtl';
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const step = Math.round(row.clientWidth * 0.9);
    row.scrollBy({
      left: (towards === 'after' ? step : -step) * (rtl ? -1 : 1),
      behavior: reduce ? 'auto' : 'smooth',
    });
  };

  if (rows.length === 0 && empty !== undefined) {
    return <p className="small muted package-grid__empty">{empty}</p>;
  }
  return (
    <div className="package-carousel">
      {hidden.before ? (
        <button
          type="button"
          className="package-carousel__nav package-carousel__nav--before"
          aria-label={`Previous ${label.toLowerCase()}`}
          onClick={() => slide('before')}
        >
          <ChevronIcon />
        </button>
      ) : null}
      <ul ref={rowRef} className="package-grid" aria-label={label}>
        {rows.map((row) => (
          <li key={row.id}>{children(row)}</li>
        ))}
      </ul>
      {hidden.after ? (
        <button
          type="button"
          className="package-carousel__nav package-carousel__nav--after"
          aria-label={`Next ${label.toLowerCase()}`}
          onClick={() => slide('after')}
        >
          <ChevronIcon />
        </button>
      ) : null}
    </div>
  );
}

/**
 * A bundle's contents, one service to a line (operator, 20 October 2026): a
 * comma-joined sentence made "2 × Brain map (QEEG)" hard to pick out.
 */
function Contents({ row }: { row: PackageRow }) {
  return (
    <ul className="cell-lines tile__contents" aria-label={`${row.name} contents`}>
      {row.components.map((component) => (
        <li key={component.serviceTypeId}>
          {`${component.quantity} × ${component.serviceTypeName}`}
        </li>
      ))}
    </ul>
  );
}

/** The tile's frame: the name heading it, and the article named by it. */
function Tile({
  row,
  aside,
  children,
}: {
  row: PackageRow;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const nameId = useId();
  return (
    <article className="tile" aria-labelledby={nameId}>
      <header className="tile__head">
        <h3 id={nameId} className="tile__name">
          {row.name}
        </h3>
        {aside}
      </header>
      {children}
    </article>
  );
}

export function PackageTile({
  row,
  canWrite,
  onSell,
  onEdit,
  onWithdraw,
}: {
  row: PackageRow;
  canWrite: boolean;
  onSell: () => void;
  onEdit: () => void;
  onWithdraw: () => void;
}) {
  const price = row.currentPrice;

  return (
    <Tile
      row={row}
      aside={
        // What it sells for, the figure a person looks for first.
        <p className="tile__total">
          {price ? (
            <>
              <span className="small muted">AED </span>
              <span className="numeric">{formatFils(price.grossFils)}</span>
            </>
          ) : (
            <span className="small muted">Not on sale</span>
          )}
        </p>
      }
    >
      <Contents row={row} />

      <dl className="tile__figures">
        <div>
          <dt>List (AED)</dt>
          <dd className="numeric">{formatFils(row.listPriceFils)}</dd>
        </div>
        <div>
          {/* What came off the list: the share when that is how it was set,
              the sum when it was a sum (docs/SPEC/billing.md section 2.4). */}
          <dt>Discount</dt>
          <dd className="numeric">{price ? formatDiscount(price) : '—'}</dd>
        </div>
        <div>
          <dt>VAT</dt>
          <dd className="numeric">{price ? formatFils(price.vatFils) : '—'}</dd>
        </div>
        <div>
          {/* "No expiry" said plainly rather than left blank (the operator's
              ruling of 12 September 2026). */}
          <dt>Runs for</dt>
          <dd>{termWords(row.term)?.en ?? 'No expiry'}</dd>
        </div>
        <div>
          <dt>Priced from</dt>
          <dd className="numeric">{price ? formatDate(price.validFrom) : '—'}</dd>
        </div>
      </dl>

      {/* Why the price is the price, as the founder wrote it when setting it. */}
      {price ? <p className="small tile__notes">{price.amendmentReason}</p> : null}

      {canWrite ? (
        <div className="tile__actions tile__actions--grid">
          {row.sellable ? (
            <button type="button" className="button button--tonal button--compact" onClick={onSell}>
              Sell to a client
            </button>
          ) : (
            <span className="small muted">Needs a price for every service</span>
          )}
          <button
            type="button"
            className="button button--neutral button--compact"
            aria-label={`Edit ${row.name}`}
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            type="button"
            className="button button--neutral button--compact"
            onClick={onWithdraw}
          >
            Withdraw
          </button>
        </div>
      ) : null}
    </Tile>
  );
}

/**
 * A withdrawn bundle: its name, its contents and the way back. Nothing else,
 * because nothing else is sellable or priced once it is withdrawn
 * (docs/SPEC/billing.md).
 */
export function WithdrawnTile({
  row,
  canWrite,
  reinstating,
  onReinstate,
}: {
  row: PackageRow;
  canWrite: boolean;
  reinstating: boolean;
  onReinstate: () => void;
}) {
  return (
    <Tile row={row}>
      <Contents row={row} />
      {canWrite ? (
        <div className="row-actions tile__actions">
          <button
            type="button"
            className="button button--quiet button--compact"
            disabled={reinstating}
            onClick={onReinstate}
          >
            Reinstate
          </button>
        </div>
      ) : null}
    </Tile>
  );
}
