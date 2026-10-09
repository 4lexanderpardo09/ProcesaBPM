import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from './Badge';

const meta = {
  title: 'UI/Badge',
  component: Badge,
  args: { children: 'Cerrado' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};
export const Ok: Story = { args: { tone: 'ok', children: 'A tiempo' } };
export const Warn: Story = { args: { tone: 'warn', children: 'Pausado' } };
export const Danger: Story = { args: { tone: 'danger', children: 'Vencido 3h' } };
export const Accent: Story = { args: { tone: 'accent', children: 'En proceso' } };
export const Violet: Story = { args: { tone: 'violet', children: 'En espera' } };
