import type { ReactNode } from 'react';
import { ControlledTable } from './table/ControlledTable';

/**
 * The ledger's table: sticky header, 44px rows, hairline rules, no zebra, no
 * cards (docs/DESIGN-BRIEF.md section 6.2). Numeric columns take tabular figures.
 *
 * `ledger--pinned` keeps the record and the name in place while the rest of a
 * wide row scrolls beside them (docs/SPEC/responsive-console.md section 8). It
 * is unconditional: a sticky column inside a container it already fits has
 * nothing to stick to and no visible effect.
 */
export type Column<Row> = {
  key: string;
  header: string;
  /** Tabular figures. */
  numeric?: boolean;
  /** Quantities align end; identifiers and text align start (the default). */
  align?: 'start' | 'end';
  /**
   * As wide as what it holds and no wider: a record number, an age, a status.
   * The room it gives up goes to the columns that did not ask, so leave at
   * least one column without it: when every column asks, none shrinks.
   */
  fit?: boolean;
  render: (row: Row) => ReactNode;
  /**
   * The value a column filter tests (text, a number, or an ISO date), for a
   * table with `controls`. Without it the column cannot be filtered.
   */
  value?: (row: Row) => string | number | null;
  /** The filter the column's menu offers: a checklist, contains, a range, dates. */
  filter?: 'values' | 'text' | 'number' | 'date';
  /** False for a column that must always show (the name that opens a record). */
  hideable?: boolean;
};

/**
 * Opts a table into the spreadsheet controls: columns resized by dragging a
 * header's edge, hidden and shown, reordered, and filtered (table/
 * ControlledTable.tsx). The id names where this table's layout is kept on
 * the device.
 */
export type TableControls = {
  id: string;
  /** What a row is, singular and plural, for "Showing 12 of 50 clients". */
  noun?: readonly [string, string];
};

export function Table<Row>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  controls,
}: {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  caption: string;
  empty?: ReactNode;
  controls?: TableControls;
}) {
  if (controls) {
    return (
      <ControlledTable
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        caption={caption}
        empty={empty}
        controls={controls}
      />
    );
  }
  return (
    <div className="ledger__scroll">
      <table className="ledger ledger--pinned">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cellClass(column)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty !== undefined ? (
            <tr className="ledger__empty">
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={cellClass(column)}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function cellClass<Row>(column: Column<Row>): string | undefined {
  const classes = [
    column.numeric ? 'numeric' : null,
    column.align === 'end' ? 'align-end' : null,
    column.fit ? 'fit' : null,
  ];
  return classes.filter(Boolean).join(' ') || undefined;
}

/**
 * The table while its rows are on their way (DESIGN.md, States: loading holds
 * the shape). The real headers and still placeholder rows, so the page does
 * not jump when the data lands; no shimmer. The sentence a screen used to show
 * is kept for assistive technology as a status line.
 */
export function TableSkeleton<Row>({
  columns,
  label,
  rows = 6,
}: {
  columns: readonly Column<Row>[];
  /** What is loading, as a sentence ("Loading the client list."). */
  label: string;
  rows?: number;
}) {
  return (
    <div className="ledger__scroll">
      {/* A status line, so the sentence is announced; the table beside it is
          decoration and hidden from assistive technology. */}
      <p className="visually-hidden" role="status">
        {label}
      </p>
      <table className="ledger ledger--pinned ledger--skeleton" aria-hidden="true">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cellClass(column)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column.key} className={cellClass(column)}>
                  <span className="ledger__placeholder" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
