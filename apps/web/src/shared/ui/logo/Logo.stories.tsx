import type { Meta, StoryObj } from '@storybook/react-vite';
import { Logo } from './Logo';

const meta = { title: 'UI/Logo', component: Logo } satisfies Meta<typeof Logo>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
