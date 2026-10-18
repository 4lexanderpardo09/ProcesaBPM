import type { Meta, StoryObj } from '@storybook/react-vite';
import { QrCode } from './QrCode';

const meta = {
  title: 'UI/QrCode',
  component: QrCode,
  args: { value: 'otpauth://totp/ProcesaBPM:ana@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ProcesaBPM', label: 'Código QR de ejemplo' },
} satisfies Meta<typeof QrCode>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
