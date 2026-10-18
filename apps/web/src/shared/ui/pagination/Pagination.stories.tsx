import type { Meta, StoryObj } from '@storybook/react-vite';
import { Pagination } from './Pagination';

const meta = { title: 'UI/Pagination', component: Pagination, args: { page: 2, pageSize: 25, total: 80, onChange: () => undefined } } satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MiddlePage: Story = {};
export const SinglePage: Story = { args: { page: 1, total: 8 } };
