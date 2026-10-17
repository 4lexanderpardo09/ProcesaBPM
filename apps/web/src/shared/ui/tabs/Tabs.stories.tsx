import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Tabs } from './Tabs';

const items = [
  { value: 'all', label: 'Todos', count: 8 },
  { value: 'assigned', label: 'Asignados a mí', count: 4 },
  { value: 'created', label: 'Creados por mí', count: 2 },
  { value: 'history', label: 'Historial' },
] as const;

function InboxTabs() {
  const [value, setValue] = useState<(typeof items)[number]['value']>('all');
  return <Tabs label="Bandejas" items={items} value={value} onChange={setValue} />;
}

const meta = {
  title: 'UI/Tabs',
  component: InboxTabs,
} satisfies Meta<typeof InboxTabs>;

export default meta;

export const Inboxes: StoryObj<typeof meta> = {};
