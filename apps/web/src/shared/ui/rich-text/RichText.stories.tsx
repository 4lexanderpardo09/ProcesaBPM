import type { Meta, StoryObj } from '@storybook/react-vite';
import { RichText } from './RichText';

const meta = {
  title: 'UI/RichText',
  component: RichText,
  args: { html: '<p>Adjunto el comprobante del pago realizado el <strong>1 de octubre</strong>.</p><ul><li>Valor: $ 1.250.000</li><li>Banco: Bancolombia</li></ul><p>Más detalle en <a href="https://example.com">el portal</a>.</p>' },
} satisfies Meta<typeof RichText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Quote: Story = { args: { html: '<blockquote>El cliente confirma el abono.</blockquote><p>Validado contra el extracto.</p>' } };
