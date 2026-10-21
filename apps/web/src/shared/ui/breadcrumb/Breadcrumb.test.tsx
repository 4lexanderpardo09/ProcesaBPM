import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Breadcrumb } from './Breadcrumb';

describe('Breadcrumb', () => {
  it('links back and marks the last item as the current page', () => {
    render(
      <MemoryRouter>
        <Breadcrumb label="Ruta de navegación" items={[{ label: 'Tickets', to: '/tickets' }, { label: 'Nuevo ticket' }]} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Ruta de navegación' });
    expect(within(nav).getByRole('link', { name: 'Tickets' })).toHaveAttribute('href', '/tickets');
    expect(within(nav).getByText('Nuevo ticket')).toHaveAttribute('aria-current', 'page');
  });
});
