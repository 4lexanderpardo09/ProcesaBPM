import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router';
import { ApiError } from '@/shared/api';
import { AuthCard } from './AuthCard';
import { CredentialsForm } from './CredentialsForm';

const meta = {
  title: 'Auth/CredentialsForm',
  component: CredentialsForm,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <AuthCard>
          <Story />
        </AuthCard>
      </MemoryRouter>
    ),
  ],
  args: { busy: false, error: undefined, onSubmit: async () => undefined },
} satisfies Meta<typeof CredentialsForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const WrongCredentials: Story = { args: { error: new ApiError({ status: 401, code: 'INVALID_CREDENTIALS', message: 'x' }) } };
export const RateLimited: Story = { args: { error: new ApiError({ status: 429, code: 'RATE_LIMITED', message: 'x', retryAfterSeconds: 600 }) } };
