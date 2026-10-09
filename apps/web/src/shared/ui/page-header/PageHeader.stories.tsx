import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../button/Button';
import { PlusIcon } from '../icons';
import { PageHeader } from './PageHeader';

const meta = {
  title: 'UI/PageHeader',
  component: PageHeader,
  args: { title: 'Tickets', subtitle: '8 tickets en la bandeja' },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithAction: Story = {
  args: { actions: <Button variant="primary" icon={<PlusIcon size={15} />}>Nuevo ticket</Button> },
};
