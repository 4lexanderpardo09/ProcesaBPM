import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextField } from './TextField';

const meta = {
  title: 'UI/TextField',
  component: TextField,
  args: { label: 'Asunto', placeholder: 'Resume la solicitud' },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithHint: Story = { args: { hint: 'Aparece en la bandeja y en los correos' } };
export const Required: Story = { args: { required: true } };
export const WithError: Story = { args: { error: 'Escribe el asunto de la solicitud' } };
