import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/render-route';

const mainNavigation = () => screen.findByRole('navigation', { name: 'Navegación principal' });

describe('AppLayout', () => {
  it('shows the navigation grouped by section', async () => {
    renderRoute('/tickets');
    const nav = await mainNavigation();
    const operation = within(nav).getByRole('region', { name: 'Operación' });
    const configuration = within(nav).getByRole('region', { name: 'Configuración' });
    expect(within(operation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Bandejas', 'Flujos', 'Reportes']);
    expect(within(configuration).getAllByRole('link').map((link) => link.textContent)).toEqual(['Catálogo', 'Personas']);
  });

  it('marks the current section and shows its page', async () => {
    renderRoute('/workflows');
    expect(await screen.findByRole('heading', { level: 1, name: 'Flujos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Flujos' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Bandejas' })).not.toHaveAttribute('aria-current');
  });

  it('navigates when a link is clicked', async () => {
    const { router } = renderRoute('/tickets');
    await userEvent.click(await screen.findByRole('link', { name: 'Personas' }));
    expect(router.state.location.pathname).toBe('/people');
    expect(screen.getByRole('heading', { level: 1, name: 'Personas' })).toBeInTheDocument();
  });

  it('shows the product logo', async () => {
    renderRoute('/tickets');
    expect(await screen.findByRole('complementary')).toHaveTextContent('ProcesaBPM');
  });

  it('shows the signed-in person and role in the top bar, and signs out from there', async () => {
    const { router, server } = renderRoute('/tickets');
    const account = await screen.findByRole('group', { name: 'Cuenta' });
    expect(account).toHaveTextContent('Ana Torres');
    expect(account).toHaveTextContent('Rol tenant-1');

    await userEvent.click(within(account).getByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Inicia sesión' })).toBeInTheDocument();
    expect(server.logout).toHaveBeenCalledOnce();
    expect(router.state.location.search).toBe('');
  });
});
