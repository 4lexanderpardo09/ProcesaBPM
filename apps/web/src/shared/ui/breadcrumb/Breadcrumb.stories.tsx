import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router';
import { Breadcrumb } from './Breadcrumb';

const meta = {
  title: 'UI/Breadcrumb',
  component: Breadcrumb,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
  args: { label: 'Ruta de navegación', items: [{ label: 'Tickets', to: '/tickets' }, { label: 'Nuevo ticket' }] },
} satisfies Meta<typeof Breadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Page: Story = {};
export const TicketNumber: Story = { args: { items: [{ label: 'Tickets', to: '/tickets' }, { label: 'T-1042', code: true }] } };
