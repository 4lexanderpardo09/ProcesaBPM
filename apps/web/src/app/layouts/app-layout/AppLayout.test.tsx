import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/render-route';

describe('AppLayout', () => {
  it('shows the navigation grouped by section', () => {
    renderRoute('/tickets');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    const operation = within(nav).getByRole('region', { name: 'Operación' });
    const configuration = within(nav).getByRole('region', { name: 'Configuración' });
    expect(within(operation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Bandejas', 'Flujos', 'Reportes']);
    expect(within(configuration).getAllByRole('link').map((link) => link.textContent)).toEqual(['Catálogo', 'Personas']);
  });

  it('marks the current section and shows its page', () => {
    renderRoute('/workflows');
    expect(screen.getByRole('link', { name: 'Flujos' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Bandejas' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 1, name: 'Flujos' })).toBeInTheDocument();
  });

  it('navigates when a link is clicked', async () => {
    const { router } = renderRoute('/tickets');
    await userEvent.click(screen.getByRole('link', { name: 'Personas' }));
    expect(router.state.location.pathname).toBe('/people');
    expect(screen.getByRole('heading', { level: 1, name: 'Personas' })).toBeInTheDocument();
  });

  it('shows the product logo', () => {
    renderRoute('/tickets');
    expect(screen.getByRole('complementary')).toHaveTextContent('ProcesaBPM');
  });
});
