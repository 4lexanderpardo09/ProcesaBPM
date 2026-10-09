import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/render-route';

describe('appRoutes', () => {
  it('sends the root to the inboxes', () => {
    const { router } = renderRoute('/');
    expect(router.state.location.pathname).toBe('/tickets');
    expect(screen.getByRole('heading', { level: 1, name: 'Bandejas' })).toBeInTheDocument();
  });

  it('shows the not found page inside the layout for an unknown address', () => {
    renderRoute('/does-not-exist');
    expect(screen.getByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeInTheDocument();
  });
});
