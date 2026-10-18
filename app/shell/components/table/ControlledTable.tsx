import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { Column, TableControls } from '../Table';
import { ColumnMenu } from './ColumnMenu';
import { ColumnsPanel } from './ColumnsPanel';
import {
  clampWidth,
  emptyLayout,
  filterRows,
  moveKey,
  readStoredLayout,
  reconcile,
  visibleColumns,
  writeStoredLayout,
  type ColumnFilter,
  type ColumnFilters,
  type ColumnLayout,
} from './layout';

/**
 * The ledger table with spreadsheet controls (the operator, 2026-10-18: "the
 * columns control to look and feel like an excel sheet"):
 *
 * - **Resize** by dragging the edge of a column's header, or with the arrow
 *   keys on that edge; double-click the edge to fit the column to what it
 *   holds. The first drag fixes every column at the width it had, so nothing
 *   else jumps; from then on the table is exactly as wide as its columns.
 * - **Reorder** by dragging a header onto another, from a column's menu
 *   (Move back, Move forward), or in the Columns list.
 * - **Show and hide** from a column's menu or the Columns list, with Show all.
 * - **Filter** from a column's menu: a checklist of the values, contains,
 *   a number range or a date range. Every filter applies at once, and the
 *   toolbar says how many rows remain, with one button to clear them all.
 *
 * Order, hidden columns and widths are kept on this device; filters are not
 * (layout.ts says why). The page decides what rows exist and which the server
 * returned; this only arranges and narrows what the page was given.
 */
export function ControlledTable<Row>({
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
  controls: TableControls;
}) {
  const [layout, setLayout] = useState<ColumnLayout>(() =>
    reconcile(readStoredLayout(controls.id), columns),
  );
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const table = useRef<HTMLTableElement | null>(null);
  const changed = useRef(false);

  // A screen whose columns change (a VAT column appearing) keeps the layout
  // honest without losing what the person arranged.
  const columnKeys = columns.map((c) => c.key).join('|');
  const [knownKeys, setKnownKeys] = useState(columnKeys);
  if (knownKeys !== columnKeys) {
    setKnownKeys(columnKeys);
    setLayout((current) => reconcile(current, columns));
  }

  useEffect(() => {
    if (changed.current) writeStoredLayout(controls.id, layout);
  }, [controls.id, layout]);

  const update = useCallback((next: (current: ColumnLayout) => ColumnLayout) => {
    changed.current = true;
    setLayout(next);
  }, []);

  const visible = visibleColumns(columns, layout);
  const sized = visible.some((c) => layout.widths[c.key] !== undefined);
  const shownRows = useMemo(() => filterRows(rows, columns, filters), [rows, columns, filters]);
  const filterCount = Object.keys(filters).length;
  const [one, many] = controls.noun ?? ['row', 'rows'];

  /** The width every visible column is drawn at now, read from the page. */
  function measured(): Record<string, number> {
    const widths: Record<string, number> = { ...layout.widths };
    for (const th of table.current?.querySelectorAll<HTMLElement>('thead th[data-col]') ?? []) {
      const key = th.dataset.col;
      // The drawn width, or the widest thing in the column if that is wider:
      // freezing a column at its drawn width must never cut what it shows.
      if (key && widths[key] === undefined) {
        widths[key] = clampWidth(Math.max(th.getBoundingClientRect().width, widestCell(key)) + 2);
      }
    }
    return widths;
  }

  function setWidth(key: string, width: number) {
    update((current) => ({
      ...current,
      widths: { ...(sized ? current.widths : measured()), [key]: clampWidth(width) },
    }));
  }

  function startResize(event: ReactPointerEvent<HTMLElement>, key: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const th = handle.closest('th');
    if (!th) return;
    const rtl = getComputedStyle(th).direction === 'rtl';
    const startX = event.clientX;
    const startWidth = th.getBoundingClientRect().width;
    const base = sized ? layout.widths : measured();
    handle.setPointerCapture?.(event.pointerId);
    changed.current = true;
    const move = (e: PointerEvent) => {
      const delta = (e.clientX - startX) * (rtl ? -1 : 1);
      setLayout((current) => ({
        ...current,
        widths: { ...base, ...current.widths, [key]: clampWidth(startWidth + delta) },
      }));
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      document.body.classList.remove('is-resizing-column');
    };
    document.body.classList.add('is-resizing-column');
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** Double-click on an edge: as wide as the widest thing in the column. */
  function fitToContent(key: string) {
    const widest = widestCell(key);
    if (widest > 0) setWidth(key, widest + 2);
  }

  /** The widest thing in a column, header included, as the browser lays it out. */
  function widestCell(key: string): number {
    const cells = table.current?.querySelectorAll<HTMLElement>(`[data-col="${CSS.escape(key)}"]`);
    let widest = 0;
    for (const cell of cells ?? []) widest = Math.max(widest, cell.scrollWidth);
    return widest;
  }

  /** Narrower or wider by a step, from the column menu. */
  function nudge(key: string, by: number) {
    const th = table.current?.querySelector<HTMLElement>(`thead th[data-col="${CSS.escape(key)}"]`);
    const now = layout.widths[key] ?? th?.getBoundingClientRect().width ?? 120;
    setWidth(key, now + by);
  }

  function moveTo(key: string, toIndex: number) {
    update((current) => ({ ...current, order: moveKey(current.order, key, toIndex) }));
  }

  /** One step along the visible row, skipping hidden columns. */
  function step(key: string, by: -1 | 1) {
    const index = visible.findIndex((c) => c.key === key);
    const neighbour = visible[index + by];
    if (!neighbour) return;
    moveTo(key, layout.order.indexOf(neighbour.key));
  }

  function setHidden(key: string, hide: boolean) {
    update((current) => ({
      ...current,
      hidden: hide ? [...current.hidden, key] : current.hidden.filter((k) => k !== key),
    }));
  }

  function setFilter(key: string, filter: ColumnFilter | null) {
    setFilters((current) => {
      const next = { ...current };
      if (filter) next[key] = filter;
      else delete next[key];
      return next;
    });
  }

  const menuColumn = menu ? columns.find((c) => c.key === menu.key) : undefined;
  const menuRows = useMemo(() => {
    if (!menu) return rows;
    const others = { ...filters };
    delete others[menu.key];
    return filterRows(rows, columns, others);
  }, [menu, rows, columns, filters]);
  const hiddenCount = layout.hidden.length;
  const tableWidth = sized
    ? visible.reduce((sum, c) => sum + (layout.widths[c.key] ?? 120), 0)
    : undefined;

  return (
    <div className="ledger-controlled">
      <div className="table-controls">
        <button
          type="button"
          className="table-controls__columns"
          aria-haspopup="dialog"
          aria-expanded={panel !== null}
          onClick={(event) => setPanel(panel ? null : event.currentTarget)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              d="M3.5 4.5h13v11h-13zM8 4.5v11M12.5 4.5v11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span>Columns</span>
          {hiddenCount > 0 ? (
            <span className="table-controls__count small">{hiddenCount} hidden</span>
          ) : null}
        </button>
        {filterCount > 0 ? (
          <p className="table-controls__status small" aria-live="polite">
            Showing <span className="numeric">{shownRows.length}</span> of{' '}
            <span className="numeric">{rows.length}</span> {rows.length === 1 ? one : many}.
          </p>
        ) : (
          <p className="table-controls__status small" aria-live="polite" />
        )}
        {filterCount > 0 ? (
          <button type="button" className="link small" onClick={() => setFilters({})}>
            Clear all filters
          </button>
        ) : null}
      </div>
      <div className="ledger__scroll">
        <table
          ref={table}
          className={['ledger', 'ledger--pinned', sized ? 'ledger--sized' : null]
            .filter(Boolean)
            .join(' ')}
          style={tableWidth ? { inlineSize: tableWidth } : undefined}
        >
          <caption className="visually-hidden">{caption}</caption>
          <colgroup>
            {visible.map((column) => (
              <col
                key={column.key}
                style={
                  sized && layout.widths[column.key] !== undefined
                    ? { inlineSize: layout.widths[column.key] }
                    : undefined
                }
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {visible.map((column) => {
                const filtered = filters[column.key] !== undefined;
                const open = menu?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    data-col={column.key}
                    className={[
                      classFor(column, sized),
                      'ledger__th',
                      dropKey === column.key && dragKey !== column.key ? 'ledger__th--drop' : null,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-sort={undefined}
                    onDragOver={(event) => {
                      if (!dragKey) return;
                      event.preventDefault();
                      setDropKey(column.key);
                    }}
                    onDragLeave={() => setDropKey((k) => (k === column.key ? null : k))}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragKey && dragKey !== column.key) {
                        moveTo(dragKey, layout.order.indexOf(column.key));
                      }
                      setDragKey(null);
                      setDropKey(null);
                    }}
                  >
                    {column.header === '' ? null : (
                      <button
                        type="button"
                        className={['ledger__col', filtered ? 'ledger__col--filtered' : null]
                          .filter(Boolean)
                          .join(' ')}
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        draggable
                        onDragStart={(event) => {
                          setDragKey(column.key);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', column.key);
                        }}
                        onDragEnd={() => {
                          setDragKey(null);
                          setDropKey(null);
                        }}
                        onClick={(event) =>
                          setMenu(open ? null : { key: column.key, anchor: event.currentTarget })
                        }
                      >
                        <span className="ledger__col-label">{column.header}</span>
                        {filtered ? (
                          <svg
                            className="ledger__col-filter"
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path d="M2 3h10L8.25 7.5V11L5.75 12V7.5z" fill="currentColor" />
                          </svg>
                        ) : null}
                        <svg
                          className="ledger__col-chevron"
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path
                            d="M4 5.5l3 3 3-3"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        {filtered ? <span className="visually-hidden">, filtered</span> : null}
                      </button>
                    )}
                    {/* The edge to drag. A pointer's way to resize; the keyboard's
                        is the column menu (Narrower, Wider, Fit to contents), so
                        the edge is hidden from assistive technology and adds
                        nothing to the column's name. */}
                    <span
                      aria-hidden="true"
                      className="ledger__resize"
                      onPointerDown={(event) => startResize(event, column.key)}
                      onDoubleClick={() => fitToContent(column.key)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shownRows.length === 0 ? (
              <tr className="ledger__empty">
                <td colSpan={visible.length}>
                  {rows.length > 0 && filterCount > 0 ? (
                    <>
                      No {many} match the filters.{' '}
                      <button type="button" className="link" onClick={() => setFilters({})}>
                        Clear all filters
                      </button>
                    </>
                  ) : (
                    empty
                  )}
                </td>
              </tr>
            ) : (
              shownRows.map((row) => (
                <tr key={rowKey(row)}>
                  {visible.map((column) => (
                    <td key={column.key} data-col={column.key} className={classFor(column, sized)}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {panel ? (
        <ColumnsPanel
          anchor={panel}
          columns={columns}
          layout={layout}
          onToggle={(key, show) => setHidden(key, !show)}
          onShowAll={() => update((current) => ({ ...current, hidden: [] }))}
          onMove={moveTo}
          onReset={() => {
            changed.current = false;
            writeStoredLayout(controls.id, null);
            setLayout(emptyLayout(columns.map((c) => c.key)));
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {menu && menuColumn ? (
        <ColumnMenu
          anchor={menu.anchor}
          column={menuColumn}
          rows={menuRows}
          filter={filters[menuColumn.key]}
          onApply={(filter) => setFilter(menuColumn.key, filter)}
          canHide={
            menuColumn.hideable !== false &&
            visible.filter((c) => c.key !== menuColumn.key).length > 0
          }
          onHide={() => setHidden(menuColumn.key, true)}
          canMoveBack={visible[0]?.key !== menuColumn.key}
          canMoveForward={visible[visible.length - 1]?.key !== menuColumn.key}
          onMove={(by) => step(menuColumn.key, by)}
          onResize={(by) => (by === 0 ? fitToContent(menuColumn.key) : nudge(menuColumn.key, by))}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

function classFor<Row>(column: Column<Row>, sized: boolean): string | undefined {
  const classes = [
    column.numeric ? 'numeric' : null,
    column.align === 'end' ? 'align-end' : null,
    // A dragged width replaces the content-fitted one.
    column.fit && !sized ? 'fit' : null,
  ];
  return classes.filter(Boolean).join(' ') || undefined;
}
