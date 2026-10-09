import type { Preview } from '@storybook/react-vite';
import '@/styles/global.css';
import '@/i18n';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
  },
};

export default preview;
