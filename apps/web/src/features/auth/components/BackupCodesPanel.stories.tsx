import type { Meta, StoryObj } from '@storybook/react-vite';
import { AuthCard } from './AuthCard';
import { BackupCodesPanel } from './BackupCodesPanel';

const meta = {
  title: 'Auth/BackupCodesPanel',
  component: BackupCodesPanel,
  decorators: [
    (Story) => (
      <AuthCard>
        <Story />
      </AuthCard>
    ),
  ],
  args: { codes: Array.from({ length: 10 }, (_, index) => `K7QM-2XPA-9RTD-4F${index}Z`), onContinue: () => undefined },
} satisfies Meta<typeof BackupCodesPanel>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
