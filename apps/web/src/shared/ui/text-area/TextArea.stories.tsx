import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextArea } from './TextArea';

const meta = {
  title: 'UI/TextArea',
  component: TextArea,
  args: { label: 'Agregar un comentario', placeholder: 'Escribe una nota para el equipo…' },
} satisfies Meta<typeof TextArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithHint: Story = { args: { hint: 'Lo verán todas las personas que pueden ver el ticket.' } };
export const WithError: Story = { args: { error: 'Escribe un comentario.' } };
