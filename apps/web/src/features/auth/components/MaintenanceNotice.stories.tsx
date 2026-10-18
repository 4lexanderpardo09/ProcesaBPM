import type { Meta, StoryObj } from '@storybook/react-vite';
import { MaintenanceNotice } from './MaintenanceNotice';

const meta = {
  title: 'Auth/MaintenanceNotice',
  component: MaintenanceNotice,
  args: { details: { title: 'Actualización programada', body: 'Estamos mejorando la plataforma.\nVolvemos en una hora.', endsAt: '2026-10-18T02:00:00Z' } },
} satisfies Meta<typeof MaintenanceNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithEnd: Story = {};
export const WithoutEnd: Story = { args: { details: { title: 'Mantenimiento', endsAt: null } } };
