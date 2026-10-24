import type { Meta, StoryObj } from '@storybook/react-vite';
import { SignaturePad } from './SignaturePad';

const meta = {
  title: 'UI/SignaturePad',
  component: SignaturePad,
  args: { label: 'Recuadro para firmar' },
} satisfies Meta<typeof SignaturePad>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty, ready to sign with the mouse, a pen or a finger. */
export const Empty: Story = {};
