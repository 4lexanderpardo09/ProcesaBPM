import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Tabs, type TabItem } from './Tabs';

type Inbox = 'all' | 'assigned' | 'created';

const items: readonly TabItem<Inbox>[] = [
  { value: 'all', label: 'Todos', count: 8 },
  { value: 'assigned', label: 'Asignados a mí', count: 4 },
  { value: 'created', label: 'Creados por mí' },
];

function InboxTabs() {
  const [value, setValue] = useState<Inbox>('all');
  return <Tabs label="Bandejas" items={items} value={value} onChange={setValue} />;
}

describe('Tabs', () => {
  it('marks the selected tab and shows the counters', () => {
    render(<InboxTabs />);
    expect(screen.getByRole('tab', { name: /^Todos/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^Asignados a mí/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('selects a tab on click', async () => {
    render(<InboxTabs />);
    await userEvent.click(screen.getByRole('tab', { name: 'Creados por mí' }));
    expect(screen.getByRole('tab', { name: 'Creados por mí' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves with the arrow keys and wraps around', async () => {
    render(<InboxTabs />);
    await userEvent.click(screen.getByRole('tab', { name: /^Todos/ }));
    await userEvent.keyboard('{ArrowLeft}');
    const last = screen.getByRole('tab', { name: 'Creados por mí' });
    expect(last).toHaveAttribute('aria-selected', 'true');
    expect(last).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /^Todos/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps only the selected tab in the tab order', () => {
    render(<InboxTabs />);
    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });
});
