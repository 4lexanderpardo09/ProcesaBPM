import type { Meta, StoryObj } from '@storybook/react-vite';
import { Logo } from './Logo';

const meta = { title: 'UI/Logo', component: Logo } satisfies Meta<typeof Logo>;

export default meta;

export const Default: StoryObj<typeof meta> = {};

export const OnDark: StoryObj<typeof meta> = {
  args: { tone: 'dark' },
  decorators: [(Story) => <div style={{ background: 'var(--navy)', padding: 'var(--space-4)' }}><Story /></div>],
};
