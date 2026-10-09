import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../button/Button';
import { Card } from './Card';

const meta = {
  title: 'UI/Card',
  component: Card,
  args: { title: 'Datos de la solicitud', children: 'Contenido de la tarjeta' },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTitle: Story = {};
export const WithActions: Story = { args: { actions: <Button variant="ghost">Editar</Button> } };
export const WithoutTitle: Story = { args: { title: undefined } };
