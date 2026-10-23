import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../button/Button';
import { TextArea } from '../text-area/TextArea';
import { Dialog } from './Dialog';

const meta = {
  title: 'UI/Dialog',
  component: Dialog,
  args: {
    open: true,
    title: 'Cerrar ticket',
    closeLabel: 'Cerrar',
    onClose: () => undefined,
    footer: (
      <>
        <Button>Cancelar</Button>
        <Button variant="brand">Cerrar ticket</Button>
      </>
    ),
    children: <TextArea label="Comentario (opcional)" />,
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

/** Room for a table: the rows of a TABLE field on the ticket. */
export const Wide: Story = {
  args: {
    size: 'wide',
    title: 'Gastos',
    footer: <Button>Cerrar</Button>,
    children: (
      <table>
        <thead>
          <tr>
            <th>Gasto</th>
            <th>Valor</th>
            <th>Fecha</th>
            <th>Soporte</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Taxi</td>
            <td>25.000,00</td>
            <td>1 de oct de 2026</td>
            <td>taxi.pdf</td>
          </tr>
        </tbody>
      </table>
    ),
  },
};
