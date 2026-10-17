import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlusIcon } from '../icons';
import { Button } from './Button';

const meta = {
  title: 'UI/Button',
  component: Button,
  args: { children: 'Guardar borrador' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Secondary: Story = {};
export const Primary: Story = { args: { variant: 'primary', children: 'Nuevo ticket', icon: <PlusIcon size={15} /> } };
export const Brand: Story = { args: { variant: 'brand', children: 'Crear y enviar' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'Limpiar filtros' } };
export const Disabled: Story = { args: { disabled: true } };
