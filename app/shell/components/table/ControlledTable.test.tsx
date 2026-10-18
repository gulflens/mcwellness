// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Table, type Column } from '../Table';

/** The spreadsheet controls on a ledger table. Synthetic rows throughout. */

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

type Row = { id: string; name: string; status: string; age: number };

const ROWS: Row[] = [
  { id: '1', name: 'Amber Dune', status: 'Lead', age: 22 },
  { id: '2', name: 'Basil Meadow', status: 'Active', age: 27 },
  { id: '3', name: 'Cedar Meadow', status: 'Paused', age: 31 },
];

const COLUMNS: Column<Row>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (r) => r.name,
    value: (r) => r.name,
    filter: 'text',
    hideable: false,
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) => r.status,
    value: (r) => r.status,
    filter: 'values',
  },
  {
    key: 'age',
    header: 'Age',
    numeric: true,
    render: (r) => String(r.age),
    value: (r) => r.age,
    filter: 'number',
  },
];

function mount() {
  return render(
    <Table
      caption="Clients"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(r) => r.id}
      empty="Nobody yet."
      controls={{ id: 'test', noun: ['client', 'clients'] }}
    />,
  );
}

const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
const names = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

function openMenu(header: string) {
  fireEvent.click(within(screen.getByRole('columnheader', { name: header })).getByRole('button'));
  return screen.getByRole('dialog', { name: `${header} column` });
}

describe('a table with column controls', () => {
  it('keeps the plain header names, so the column is still read as itself', () => {
    mount();
    expect(headers()).toEqual(['Name', 'Status', 'Age']);
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy();
  });

  it('hides a column from its menu and brings every column back with Show all', () => {
    mount();
    fireEvent.click(within(openMenu('Age')).getByRole('button', { name: 'Hide column' }));
    expect(headers()).toEqual(['Name', 'Status']);
    expect(screen.getByRole('button', { name: /Columns/ }).textContent).toContain('1 hidden');

    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    const panel = screen.getByRole('dialog', { name: 'Columns' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Show all' }));
    expect(headers()).toEqual(['Name', 'Status', 'Age']);
  });

  it('never offers to hide a column that must show', () => {
    mount();
    expect(within(openMenu('Name')).queryByRole('button', { name: 'Hide column' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    const panel = screen.getByRole('dialog', { name: 'Columns' });
    expect(
      (within(panel).getByRole('checkbox', { name: 'Name' }) as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it('filters by the values ticked, says how many remain, and clears every filter at once', () => {
    mount();
    const menu = openMenu('Status');
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Active' }));
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply' }));
    expect(names()).toEqual(['Basil Meadow']);
    expect(screen.getByText(/Showing/).textContent).toBe('Showing 1 of 3 clients.');
    expect(screen.getByRole('columnheader', { name: /Status/ }).textContent).toContain('filtered');

    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(names()).toHaveLength(3);
  });

  it('filters numbers by a range and text by what it contains, together', () => {
    mount();
    let menu = openMenu('Age');
    fireEvent.change(within(menu).getByLabelText('At least'), { target: { value: '25' } });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply' }));
    menu = openMenu('Name');
    fireEvent.change(within(menu).getByLabelText('Contains'), { target: { value: 'cedar' } });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply' }));
    expect(names()).toEqual(['Cedar Meadow']);
  });

  it('says when no row matches, with a way out', () => {
    mount();
    const menu = openMenu('Name');
    fireEvent.change(within(menu).getByLabelText('Contains'), { target: { value: 'zzz' } });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply' }));
    expect(screen.getByText(/No clients match the filters/)).toBeTruthy();
  });

  it('moves a column along the row from its menu, and remembers the order on this device', () => {
    mount();
    fireEvent.click(within(openMenu('Age')).getByRole('button', { name: 'Move back' }));
    expect(headers()).toEqual(['Name', 'Age', 'Status']);
    cleanup();
    mount();
    expect(headers()).toEqual(['Name', 'Age', 'Status']);
  });

  it('reorders from the Columns list, and Reset layout returns the screen’s own order', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    const panel = screen.getByRole('dialog', { name: 'Columns' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Move Age up' }));
    expect(headers()).toEqual(['Name', 'Age', 'Status']);
    fireEvent.click(within(panel).getByRole('button', { name: 'Reset layout' }));
    expect(headers()).toEqual(['Name', 'Status', 'Age']);
    expect(window.localStorage.getItem('mcwellness.table.test')).toBeNull();
  });

  it('widens a column from its menu, fixing the table to its columns’ widths', () => {
    mount();
    fireEvent.click(within(openMenu('Status')).getByRole('button', { name: 'Wider' }));
    const table = screen.getByRole('table');
    expect(table.className).toContain('ledger--sized');
    const stored = JSON.parse(window.localStorage.getItem('mcwellness.table.test') ?? '{}') as {
      widths?: Record<string, number>;
    };
    expect(stored.widths?.status).toBeGreaterThan(0);
  });

  it('never stores a filter, which can hold a name', () => {
    mount();
    fireEvent.click(within(openMenu('Age')).getByRole('button', { name: 'Hide column' }));
    const menu = openMenu('Name');
    fireEvent.change(within(menu).getByLabelText('Contains'), { target: { value: 'Amber' } });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply' }));
    expect(window.localStorage.getItem('mcwellness.table.test')).not.toContain('Amber');
  });

  it('closes a menu on Escape and leaves the table as it was', () => {
    mount();
    openMenu('Status');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(names()).toHaveLength(3);
  });
});
