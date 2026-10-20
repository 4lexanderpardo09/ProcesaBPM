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
