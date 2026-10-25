import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '../badge/Badge';
import { Table, type TableColumn } from './Table';

interface Row {
  readonly number: string;
  readonly title: string;
  readonly status: string;
}

const columns: readonly TableColumn<Row>[] = [
  { key: 'number', header: 'Nº', cell: (row) => row.number, code: true, width: '96px' },
  { key: 'title', header: 'Título', cell: (row) => row.title },
  { key: 'status', header: 'Estado', cell: (row) => <Badge tone="accent">{row.status}</Badge>, width: '140px' },
];
const rows: readonly Row[] = [
  { number: 'T-1042', title: 'Confirmación de pago de crédito', status: 'Abierto' },
  { number: 'T-1041', title: 'Corrección de datos del asociado', status: 'Abierto' },
];

const meta = {
  title: 'UI/Table',
  component: Table<Row>,
  args: { label: 'Tickets', columns, rows, rowKey: (row: Row) => row.number, empty: 'No hay tickets en esta bandeja.', loadingLabel: 'Cargando tickets…' },
} satisfies Meta<typeof Table<Row>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithRows: Story = {};
export const Empty: Story = { args: { rows: [] } };
export const Loading: Story = { args: { loading: true } };
export const WithFooter: Story = { args: { footer: 'Mostrando 1–2 de 2' } };
/** Sortable headers: the column the rows are sorted by shows its direction; the others offer to sort. */
export const Sortable: Story = {
  args: {
    columns: columns.map((column) =>
      column.key === 'status' ? column : { ...column, sort: { direction: column.key === 'number' ? 'desc' : undefined, onSort: () => undefined } },
    ),
  },
};
