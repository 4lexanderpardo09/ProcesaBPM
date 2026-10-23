import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { FormattedTextArea } from './FormattedTextArea';

function Controlled({ initial }: { readonly initial: string }) {
  const [value, setValue] = useState(initial);
  return <FormattedTextArea label="Comentario" value={value} onValueChange={setValue} />;
}

const meta = {
  title: 'UI/FormattedTextArea',
  component: Controlled,
  args: { initial: '' },
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const WithFormatting: Story = { args: { initial: 'Pago **urgente**, ver _anexo_.\n\n- la cédula\n- el RUT' } };
