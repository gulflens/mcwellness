// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  BLANK,
  cleanFilter,
  distinctValues,
  filterRows,
  moveKey,
  readStoredLayout,
  reconcile,
  visibleColumns,
  writeStoredLayout,
  type ControlledColumn,
} from './layout';

type Row = { name: string; age: number | null; status: string; seen: string | null };

const COLUMNS: ControlledColumn<Row>[] = [
  { key: 'name', header: 'Name', value: (r) => r.name, filter: 'text', hideable: false },
  { key: 'age', header: 'Age', value: (r) => r.age, filter: 'number' },
  { key: 'status', header: 'Status', value: (r) => r.status, filter: 'values' },
  { key: 'seen', header: 'Last seen', value: (r) => r.seen, filter: 'date' },
];

const ROWS: Row[] = [
  { name: 'Amber Dune', age: 22, status: 'Lead', seen: null },
  { name: 'Basil Meadow', age: 27, status: 'Active', seen: '2026-09-01' },
  { name: 'Cedar Meadow', age: 31, status: 'Paused', seen: '2026-10-02' },
  { name: 'Dahlia Bay', age: null, status: 'Active', seen: '2026-10-15' },
];

afterEach(() => window.localStorage.clear());

describe('reconcile', () => {
  it('starts from the screen’s own order with nothing hidden and no widths', () => {
    expect(reconcile(null, COLUMNS)).toEqual({
      order: ['name', 'age', 'status', 'seen'],
      hidden: [],
      widths: {},
    });
  });

  it('keeps a stored order, drops columns that no longer exist, and appends new ones', () => {
    const layout = reconcile({ order: ['status', 'gone', 'name'], hidden: ['gone'] }, COLUMNS);
    expect(layout.order).toEqual(['status', 'name', 'age', 'seen']);
    expect(layout.hidden).toEqual([]);
  });

  it('never hides a column that must show, and never hides every column', () => {
    expect(reconcile({ hidden: ['name', 'age'] }, COLUMNS).hidden).toEqual(['age']);
    expect(
      reconcile({ hidden: ['age', 'status', 'seen'] }, [
        { key: 'age', header: 'Age' },
        { key: 'status', header: 'Status' },
      ]).hidden,
    ).toEqual([]);
  });

  it('clamps widths and ignores nonsense', () => {
    const layout = reconcile(
      { widths: { name: 9999, age: 10, status: 'wide', nope: 100 } },
      COLUMNS,
    );
    expect(layout.widths).toEqual({ name: 1200, age: 56 });
  });

  it('survives a stored value that is not a layout at all', () => {
    expect(reconcile('rubbish', COLUMNS).order).toHaveLength(4);
    expect(reconcile({ order: 'name' }, COLUMNS).order).toHaveLength(4);
  });
});

describe('visibleColumns and moveKey', () => {
  it('draws the columns in the layout’s order without the hidden ones', () => {
    const layout = { order: ['status', 'name', 'age', 'seen'], hidden: ['age'], widths: {} };
    expect(visibleColumns(COLUMNS, layout).map((c) => c.key)).toEqual(['status', 'name', 'seen']);
  });

  it('moves a column to a new place, within the bounds of the row', () => {
    expect(moveKey(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(moveKey(['a', 'b', 'c'], 'a', 9)).toEqual(['b', 'c', 'a']);
    expect(moveKey(['a', 'b'], 'z', 0)).toEqual(['a', 'b']);
  });
});

describe('filters', () => {
  const names = (rows: Row[]) => rows.map((r) => r.name);

  it('keeps the rows whose value is ticked in the checklist, blank included', () => {
    expect(
      names(filterRows(ROWS, COLUMNS, { status: { kind: 'values', values: ['Active'] } })),
    ).toEqual(['Basil Meadow', 'Dahlia Bay']);
    expect(names(filterRows(ROWS, COLUMNS, { seen: { kind: 'values', values: [BLANK] } }))).toEqual(
      ['Amber Dune'],
    );
  });

  it('matches text anywhere, ignoring case', () => {
    expect(
      names(filterRows(ROWS, COLUMNS, { name: { kind: 'text', contains: 'MEADOW' } })),
    ).toEqual(['Basil Meadow', 'Cedar Meadow']);
  });

  it('keeps numbers within a range, and leaves a blank number out', () => {
    expect(names(filterRows(ROWS, COLUMNS, { age: { kind: 'range', min: 25 } }))).toEqual([
      'Basil Meadow',
      'Cedar Meadow',
    ]);
  });

  it('keeps dates within a range', () => {
    expect(
      names(
        filterRows(ROWS, COLUMNS, {
          seen: { kind: 'dates', from: '2026-10-01', to: '2026-10-10' },
        }),
      ),
    ).toEqual(['Cedar Meadow']);
  });

  it('applies every filter at once', () => {
    expect(
      names(
        filterRows(ROWS, COLUMNS, {
          status: { kind: 'values', values: ['Active', 'Paused'] },
          name: { kind: 'text', contains: 'meadow' },
        }),
      ),
    ).toEqual(['Basil Meadow', 'Cedar Meadow']);
  });

  it('lists a column’s distinct values sorted, blank last', () => {
    expect(distinctValues(ROWS, COLUMNS[2]!)).toEqual(['Active', 'Lead', 'Paused']);
    expect(distinctValues(ROWS, COLUMNS[1]!)).toEqual(['22', '27', '31', BLANK]);
  });

  it('treats a filter that keeps everything as no filter', () => {
    expect(cleanFilter({ kind: 'text', contains: '  ' }, COLUMNS[0]!)).toBeNull();
    expect(cleanFilter({ kind: 'range' }, COLUMNS[1]!)).toBeNull();
    expect(cleanFilter({ kind: 'dates', from: 'yesterday' }, COLUMNS[3]!)).toBeNull();
    expect(cleanFilter({ kind: 'text', contains: 'x' }, { key: 'k', header: 'K' })).toBeNull();
  });
});

describe('storage', () => {
  it('saves the order, hidden columns and widths, and never a filter', () => {
    writeStoredLayout('clients', {
      order: ['age', 'name'],
      hidden: ['age'],
      widths: { name: 200 },
      // A caller passing more than the layout must not get it stored.
      ...({ filters: { name: { kind: 'text', contains: 'Dune' } } } as object),
    });
    const stored = readStoredLayout('clients') as Record<string, unknown>;
    expect(stored).toEqual({ order: ['age', 'name'], hidden: ['age'], widths: { name: 200 } });
    expect(JSON.stringify(stored)).not.toContain('Dune');
  });

  it('forgets a layout when asked, and reads nothing from broken storage', () => {
    writeStoredLayout('clients', { order: ['name'], hidden: [], widths: {} });
    writeStoredLayout('clients', null);
    expect(readStoredLayout('clients')).toBeNull();
    window.localStorage.setItem('mcwellness.table.broken', '{not json');
    expect(readStoredLayout('broken')).toBeNull();
  });
});
