import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from './Avatar';

const meta = {
  title: 'UI/Avatar',
  component: Avatar,
  args: { name: 'Laura Peña' },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Small: Story = {};
export const Medium: Story = { args: { size: 'md' } };
