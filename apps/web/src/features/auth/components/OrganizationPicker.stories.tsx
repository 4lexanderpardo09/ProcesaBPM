import type { Meta, StoryObj } from '@storybook/react-vite';
import { AuthPanel } from './AuthPanel';
import { OrganizationPicker } from './OrganizationPicker';

const organizations = [
  { tenantId: '018f0000-0000-7000-8000-0000000000a1', slug: 'acme', name: 'Acme', membershipStatus: 'ACTIVE', mfaRequired: false, tenantStatus: 'ACTIVE', maintenance: null },
  { tenantId: '018f0000-0000-7000-8000-0000000000b2', slug: 'globex', name: 'Globex', membershipStatus: 'ACTIVE', mfaRequired: true, tenantStatus: 'ACTIVE', maintenance: { title: 'Actualización', endsAt: '2026-10-18T02:00:00Z' } },
  { tenantId: '018f0000-0000-7000-8000-0000000000c3', slug: 'initech', name: 'Initech', membershipStatus: 'INVITED', mfaRequired: false, tenantStatus: 'ACTIVE', maintenance: null },
] as const;

const meta = {
  title: 'Auth/OrganizationPicker',
  component: OrganizationPicker,
  decorators: [
    (Story) => (
      <AuthPanel>
        <Story />
      </AuthPanel>
    ),
  ],
  args: {
    choice: { organizations, selectionToken: 'x', expiresAt: 0, platformAdmin: false },
    rowErrors: {},
    error: undefined,
    onChoose: () => undefined,
    onRestart: () => undefined,
  },
} satisfies Meta<typeof OrganizationPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Several: Story = {};
export const RefusedRow: Story = { args: { rowErrors: { [organizations[0].tenantId]: 'auth:errors.tenantSuspended' } } };
export const PlatformAdminWithFewBackupCodes: Story = { args: { choice: { organizations, selectionToken: 'x', expiresAt: 0, platformAdmin: true }, backupCodesLeft: 1 } };
export const Empty: Story = { args: { choice: { organizations: [], selectionToken: 'x', expiresAt: 0, platformAdmin: false } } };
