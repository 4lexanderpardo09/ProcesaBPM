import type { Meta, StoryObj } from '@storybook/react-vite';
import { BrandPanel } from './BrandPanel';

const meta = { title: 'Layout/BrandPanel', component: BrandPanel, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof BrandPanel>;

export default meta;

export const Default: StoryObj<typeof meta> = {
  decorators: [(Story) => <div style={{ display: 'grid', height: '100vh', maxWidth: 560 }}><Story /></div>],
};
