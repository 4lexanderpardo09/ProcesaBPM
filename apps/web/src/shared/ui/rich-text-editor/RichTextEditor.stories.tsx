import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { RichText } from '../rich-text/RichText';
import { RichTextEditor } from './RichTextEditor';

/** The editor and, below it, the HTML it writes drawn as the activity shows it. */
function Controlled({ initial, error, disabled }: { readonly initial: string; readonly error?: string; readonly disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <RichTextEditor label="Comentario" placeholder="Escribe la respuesta…" value={value} error={error} disabled={disabled} onValueChange={setValue} />
      <RichText html={value} />
    </div>
  );
}

const TABLE =
  '<p>Valores del <strong>extracto</strong>:</p><table><tbody><tr><th><p>Fecha</p></th><th><p>Valor</p></th></tr><tr><td><p>1 oct</p></td><td><p>$ 1.250.000</p></td></tr></tbody></table>';

const meta = {
  title: 'UI/RichTextEditor',
  component: Controlled,
  args: { initial: '' },
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const WithFormatting: Story = {
  args: { initial: '<h2>Revisión</h2><p>Pago <strong>urgente</strong>, ver <em>anexo</em> en <a href="https://example.com">el portal</a>.</p><ul><li><p>la cédula</p></li><li><p>el RUT</p></li></ul><p style="text-align: center"><span style="color: #c62828">Sin soporte no se aprueba</span></p>' },
};
export const WithTable: Story = { args: { initial: TABLE } };
export const Invalid: Story = { args: { error: 'Escribe un comentario.' } };
export const Disabled: Story = { args: { initial: '<p>Enviado</p>', disabled: true } };
