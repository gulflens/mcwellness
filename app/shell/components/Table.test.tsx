// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Table } from './Table';

afterEach(cleanup);

type Row = { id: string; mrn: string; name: string };
const columns = [
  { key: 'mrn', header: 'Record', numeric: true, render: (r: Row) => r.mrn },
  { key: 'name', header: 'Name', render: (r: Row) => r.name },
];

describe('Table', () => {
  it('renders a header row, one row per record, and tabular figures on numeric cells', () => {
    render(
      <Table
        caption="Test"
        columns={columns}
        rows={[{ id: '1', mrn: 'MW-000001', name: 'Amber Harbour' }]}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Record' }).className).toBe('numeric');
    expect(screen.getByRole('cell', { name: 'MW-000001' }).className).toBe('numeric');
    expect(screen.getByRole('cell', { name: 'Amber Harbour' })).toBeTruthy();
  });

  it('shows the empty line when there are no rows', () => {
    render(
      <Table
        caption="Test"
        columns={columns}
        rows={[]}
        rowKey={(r: Row) => r.id}
        empty="Nothing here."
      />,
    );
    expect(screen.getByText('Nothing here.')).toBeTruthy();
  });
});
