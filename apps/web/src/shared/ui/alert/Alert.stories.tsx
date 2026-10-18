import type { Meta, StoryObj } from '@storybook/react-vite';
import { Alert } from './Alert';

const meta = {
  title: 'UI/Alert',
  component: Alert,
  args: { tone: 'danger', title: 'No pudimos iniciar sesión', children: 'El correo o la contraseña no son correctos.' },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Danger: Story = {};
export const Warn: Story = { args: { tone: 'warn', title: 'En mantenimiento', children: 'Termina el 17 de octubre a las 3:30 p. m.' } };
export const Info: Story = { args: { tone: 'info', title: undefined, children: 'La consola de plataforma todavía no está disponible en la web.' } };
export const Ok: Story = { args: { tone: 'ok', title: undefined, children: 'Códigos copiados' } };
