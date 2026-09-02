import type { ReactNode } from 'react';

/**
 * The ledger's table: sticky header, 44px rows, hairline rules, no zebra, no
 * cards (docs/DESIGN-BRIEF.md section 6.2). Numeric columns take tabular figures.
 */
export type Column<Row> = {
  key: string;
  header: string;
  /** Tabular figures. */
  numeric?: boolean;
  /** Quantities align end; identifiers and text align start (the default). */
  align?: 'start' | 'end';
  render: (row: Row) => ReactNode;
};

export function Table<Row>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
}: {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  caption: string;
  empty?: ReactNode;
}) {
  return (
    <div className="ledger__scroll">
      <table className="ledger">
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
  const classes = [column.numeric ? 'numeric' : null, column.align === 'end' ? 'align-end' : null];
  return classes.filter(Boolean).join(' ') || undefined;
}
