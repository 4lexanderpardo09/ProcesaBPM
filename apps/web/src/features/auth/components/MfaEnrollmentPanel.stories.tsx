import type { Meta, StoryObj } from '@storybook/react-vite';
import { AuthPanel } from './AuthPanel';
import { MfaEnrollmentPanel } from './MfaEnrollmentPanel';

const meta = {
  title: 'Auth/MfaEnrollmentPanel',
  component: MfaEnrollmentPanel,
  decorators: [
    (Story) => (
      <AuthPanel>
        <Story />
      </AuthPanel>
    ),
  ],
  args: {
    reason: 'TENANT_POLICY',
    enrollment: {
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/ProcesaBPM:ana@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ProcesaBPM',
      issuer: 'ProcesaBPM',
      accountName: 'ana@example.com',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    },
    busy: false,
    error: undefined,
    onSubmit: async () => undefined,
    onRestart: () => undefined,
  },
} satisfies Meta<typeof MfaEnrollmentPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TenantPolicy: Story = {};
export const PlatformAdmin: Story = { args: { reason: 'PLATFORM_ADMIN' } };
