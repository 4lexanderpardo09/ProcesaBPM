import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderRoute } from '@/test/render-route';

const mainNavigation = () => screen.findByRole('navigation', { name: 'Navegación principal' });

describe('AppLayout', () => {
  it('shows the navigation grouped by section', async () => {
    renderRoute('/tickets');
    const nav = await mainNavigation();
    await within(nav).findByRole('link', { name: 'Catálogo' });
    const operation = within(nav).getByRole('region', { name: 'Operación' });
    const configuration = within(nav).getByRole('region', { name: 'Configuración' });
    expect(within(operation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Bandejas', 'Flujos', 'Reportes']);
    expect(within(configuration).getAllByRole('link').map((link) => link.textContent)).toEqual(['Catálogo', 'Organización', 'Personas']);
  });

  it('shows only the sections the role can use', async () => {
    const requester = { permissions: [{ action: 'create', subject: 'Ticket', conditional: false }, { action: 'read', subject: 'Category', conditional: false }] };
    const { fake } = renderRoute('/tickets', { handlers: { '/auth/me/permissions': () => requester } });
    const nav = await mainNavigation();
    await vi.waitFor(() => expect(fake.callsTo('/auth/me/permissions')).toHaveLength(1));
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Bandejas']);
    expect(within(nav).queryByRole('region', { name: 'Configuración' })).toBeNull();
  });

  it('marks the current section and shows its page', async () => {
    renderRoute('/workflows');
    expect(await screen.findByRole('heading', { level: 1, name: 'Flujos' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Flujos' })).toHaveAttribute('aria-current', 'page');
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
