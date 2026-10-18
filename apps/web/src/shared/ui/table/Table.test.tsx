import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Table, type TableColumn } from './Table';

interface Row {
  readonly id: string;
  readonly name: string;
}

const columns: readonly TableColumn<Row>[] = [
  { key: 'id', header: 'Nº', cell: (row) => row.id, code: true },
  { key: 'name', header: 'Nombre', cell: (row) => row.name },
];
const rows: readonly Row[] = [
  { id: '1', name: 'Uno' },
  { id: '2', name: 'Dos' },
];

const renderTable = (props: Partial<Parameters<typeof Table<Row>>[0]> = {}) =>
  render(<Table label="Ejemplo" columns={columns} rows={rows} rowKey={(row) => row.id} empty="Nada por aquí" loadingLabel="Cargando" {...props} />);

describe('Table', () => {
  it('shows a header per column and a row per item', () => {
    renderTable();
    const table = screen.getByRole('table', { name: 'Ejemplo' });
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Nº', 'Nombre']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByRole('cell', { name: 'Dos' })).toBeInTheDocument();
  });

  it('says so when there are no rows', () => {
    renderTable({ rows: [] });
    expect(screen.getByRole('cell', { name: 'Nada por aquí' })).toBeInTheDocument();
  });

  it('marks itself busy while loading', () => {
    renderTable({ loading: true });
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('cell', { name: 'Cargando' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'Uno' })).toBeNull();
  });

  it('hands the clicked row over', async () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    await userEvent.click(screen.getByRole('cell', { name: 'Dos' }));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });
});
