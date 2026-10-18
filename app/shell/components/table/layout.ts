/**
 * A table's column layout, the way a spreadsheet keeps one: the order the
 * columns stand in, which are hidden, how wide each has been dragged, and the
 * filter on each. Pure functions only; `useColumnLayout` holds the state and
 * this file decides what it means (the operator's request of 2026-10-18:
 * "the columns control to look and feel like an excel sheet").
 *
 * Saved on this device only, under `mcwellness.table.<id>`, like the rail and
 * the drawer width: a different laptop starts from the default layout.
 * **Filters are never saved.** A filter can hold a client's name ("contains
 * Hazel", a checklist of names), and nothing about a client is kept in the
 * browser's storage; filters last for the visit. A
 * stored layout is never trusted: it is reconciled against the columns the
 * screen has today, so a renamed or removed column drops out and a new one
 * appears at the end, visible.
 */

/** What a filter on one column keeps. */
export type ColumnFilter =
  /** Excel's checklist: keep a row whose value is one of these. */
  | { kind: 'values'; values: readonly string[] }
  /** Keep a row whose text contains this, ignoring case. */
  | { kind: 'text'; contains: string }
  /** Keep a row whose number is within the bounds given (either may be absent). */
  | { kind: 'range'; min?: number; max?: number }
  /** Keep a row whose ISO date (yyyy-mm-dd) is within the bounds given. */
  | { kind: 'dates'; from?: string; to?: string };

export type ColumnLayout = {
  order: readonly string[];
  hidden: readonly string[];
  /** Pixels, for a column someone has dragged. Absent means "as wide as it needs". */
  widths: Readonly<Record<string, number>>;
};

/** The filters on a table, by column key: held for the visit, never stored. */
export type ColumnFilters = Readonly<Record<string, ColumnFilter>>;

/** The narrowest a column may be dragged: a header word and the menu control. */
export const MIN_COLUMN_WIDTH = 56;
export const MAX_COLUMN_WIDTH = 1200;

/** How a column takes part in the controls. */
export type ControlledColumn<Row> = {
  key: string;
  header: string;
  /** The value a filter tests: text, a number, or an ISO date. Null is "blank". */
  value?: (row: Row) => string | number | null;
  /** Which kind of filter the column offers; none without `value`. */
  filter?: 'values' | 'text' | 'number' | 'date';
  /** False for a column that must always show (the name that opens a record). */
  hideable?: boolean;
};

export function emptyLayout(keys: readonly string[]): ColumnLayout {
  return { order: [...keys], hidden: [], widths: {} };
}

/**
 * A stored layout made safe for today's columns. Unknown keys are dropped,
 * new columns are appended in their own order, widths are clamped, and a
 * column that may not be hidden is shown.
 */
export function reconcile<Row>(
  stored: unknown,
  columns: readonly ControlledColumn<Row>[],
): ColumnLayout {
  const keys = columns.map((c) => c.key);
  const known = new Set(keys);
  const base = emptyLayout(keys);
  if (!stored || typeof stored !== 'object') return base;
  const raw = stored as Partial<Record<keyof ColumnLayout, unknown>>;

  const order = Array.isArray(raw.order)
    ? raw.order.filter((k): k is string => typeof k === 'string' && known.has(k))
    : [];
  const seen = new Set(order);
  const fullOrder = [...new Set(order), ...keys.filter((k) => !seen.has(k))];

  const mustShow = new Set(columns.filter((c) => c.hideable === false).map((c) => c.key));
  const hidden = Array.isArray(raw.hidden)
    ? [
        ...new Set(
          raw.hidden.filter(
            (k): k is string => typeof k === 'string' && known.has(k) && !mustShow.has(k),
          ),
        ),
      ]
    : [];

  const widths: Record<string, number> = {};
  if (raw.widths && typeof raw.widths === 'object') {
    for (const [k, w] of Object.entries(raw.widths as Record<string, unknown>)) {
      if (known.has(k) && typeof w === 'number' && Number.isFinite(w)) widths[k] = clampWidth(w);
    }
  }

  // Never every column hidden: a table with no columns is not a table.
  const allHidden = fullOrder.every((k) => hidden.includes(k));
  return { order: fullOrder, hidden: allHidden ? [] : hidden, widths };
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

/** A filter as the menu built it, or null when it would keep everything. */
export function cleanFilter<Row>(raw: unknown, column: ControlledColumn<Row>): ColumnFilter | null {
  if (!column.filter || !column.value || !raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (f.kind === 'values' && Array.isArray(f.values)) {
    return { kind: 'values', values: f.values.filter((v): v is string => typeof v === 'string') };
  }
  if (f.kind === 'text' && typeof f.contains === 'string' && f.contains.trim() !== '') {
    return { kind: 'text', contains: f.contains };
  }
  if (f.kind === 'range') {
    const min = typeof f.min === 'number' && Number.isFinite(f.min) ? f.min : undefined;
    const max = typeof f.max === 'number' && Number.isFinite(f.max) ? f.max : undefined;
    return min === undefined && max === undefined ? null : { kind: 'range', min, max };
  }
  if (f.kind === 'dates') {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const from = typeof f.from === 'string' && iso.test(f.from) ? f.from : undefined;
    const to = typeof f.to === 'string' && iso.test(f.to) ? f.to : undefined;
    return from === undefined && to === undefined ? null : { kind: 'dates', from, to };
  }
  return null;
}

/** The columns to draw, in the layout's order, without the hidden ones. */
export function visibleColumns<C extends { key: string }>(
  columns: readonly C[],
  layout: ColumnLayout,
): C[] {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  return layout.order
    .filter((k) => !layout.hidden.includes(k))
    .map((k) => byKey.get(k))
    .filter((c): c is C => c !== undefined);
}

/** Moves one key to a new position in the order. */
export function moveKey(order: readonly string[], key: string, toIndex: number): string[] {
  const from = order.indexOf(key);
  if (from === -1) return [...order];
  const next = order.filter((k) => k !== key);
  const at = Math.max(0, Math.min(next.length, toIndex));
  next.splice(at, 0, key);
  return next;
}

/** How a value reads in a values checklist; blank values gather under one entry. */
export const BLANK = '(Blank)';

export function valueLabel(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return BLANK;
  return String(value);
}

/** Does this row survive one column's filter? */
export function passes(value: string | number | null | undefined, filter: ColumnFilter): boolean {
  switch (filter.kind) {
    case 'values':
      return filter.values.includes(valueLabel(value));
    case 'text':
      return (
        value !== null &&
        value !== undefined &&
        String(value).toLowerCase().includes(filter.contains.trim().toLowerCase())
      );
    case 'range': {
      if (typeof value !== 'number') return false;
      if (filter.min !== undefined && value < filter.min) return false;
      if (filter.max !== undefined && value > filter.max) return false;
      return true;
    }
    case 'dates': {
      if (typeof value !== 'string' || value === '') return false;
      const day = value.slice(0, 10);
      if (filter.from !== undefined && day < filter.from) return false;
      if (filter.to !== undefined && day > filter.to) return false;
      return true;
    }
  }
}

/** The rows every active filter keeps. A filter on a hidden column still applies. */
export function filterRows<Row>(
  rows: readonly Row[],
  columns: readonly ControlledColumn<Row>[],
  filters: ColumnFilters,
): Row[] {
  const active = columns.filter((c) => c.value && filters[c.key]);
  if (active.length === 0) return [...rows];
  return rows.filter((row) =>
    active.every((c) => passes(c.value!(row), filters[c.key] as ColumnFilter)),
  );
}

/** The distinct values a column holds, for its checklist, sorted, blank last. */
export function distinctValues<Row>(rows: readonly Row[], column: ControlledColumn<Row>): string[] {
  if (!column.value) return [];
  const labels = new Set(rows.map((row) => valueLabel(column.value!(row))));
  const sorted = [...labels]
    .filter((l) => l !== BLANK)
    .sort((a, b) => a.localeCompare(b, 'en-GB', { numeric: true, sensitivity: 'base' }));
  return labels.has(BLANK) ? [...sorted, BLANK] : sorted;
}

const STORAGE_PREFIX = 'mcwellness.table.';

/** The stored layout, or null when there is none or storage refuses to read. */
export function readStoredLayout(id: string): unknown {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** Saves the order, the hidden columns and the widths; never the filters. */
export function writeStoredLayout(id: string, layout: ColumnLayout | null): void {
  try {
    if (layout === null) {
      window.localStorage.removeItem(STORAGE_PREFIX + id);
      return;
    }
    const { order, hidden, widths } = layout;
    window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify({ order, hidden, widths }));
  } catch {
    // A browser that refuses storage keeps the layout for this visit only.
  }
}
