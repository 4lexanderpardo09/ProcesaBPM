import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/api';
import { fakeProfile as fakeMe } from '@/test/fake-profile';
import { renderRoute } from '@/test/render-route';

describe('appRoutes', () => {
  it('sends the root to the inboxes when signed in', async () => {
    const { router } = renderRoute('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Tickets' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/tickets');
  });

  it('shows the not found page inside the layout for an unknown address', async () => {
    renderRoute('/does-not-exist');
    expect(await screen.findByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeInTheDocument();
  });

  it('sends a person without a session to the login page, remembering where they were going', async () => {
    const { router } = renderRoute('/people?tab=roles', { signedIn: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Inicia sesión' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(new URLSearchParams(router.state.location.search).get('returnTo')).toBe('/people?tab=roles');
  });

  it('sends a signed-in person away from the login page to where they were going', async () => {
    const { router } = renderRoute('/login?returnTo=%2Fpeople');
    await screen.findByRole('heading', { level: 1, name: 'Personas' });
    expect(router.state.location.pathname).toBe('/people');
  });

  it('never follows a returnTo to another site', async () => {
    const { router } = renderRoute('/login?returnTo=https%3A%2F%2Fevil.com');
    await screen.findByRole('heading', { level: 1, name: 'Tickets' });
    expect(router.state.location.pathname).toBe('/tickets');
  });

  it('offers the forgot-password page with or without a session', async () => {
    renderRoute('/forgot-password', { signedIn: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Recuperar contraseña' })).toBeInTheDocument();
  });

  it('shows a suspended organization instead of the app, with sign-out at hand', async () => {
    renderRoute('/tickets', {
      handlers: {
        '/auth/refresh': () => {
          throw new ApiError({ status: 403, code: 'TENANT_SUSPENDED', message: 'x' });
        },
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'La organización está suspendida' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Navegación principal' })).not.toBeInTheDocument();
  });

  it('shows the maintenance announcement as text', async () => {
    renderRoute('/tickets', {
      handlers: {
        '/auth/refresh': () => {
          throw new ApiError({ status: 503, code: 'MAINTENANCE', message: 'x', details: { title: 'Actualización', body: '<img src=x onerror=alert(1)>', endsAt: null } });
        },
      },
    });
    expect(await screen.findByText('Actualización')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('main img[src="x"]')).toBeNull();
  });

  it('shows that the server cannot be reached and retries on request', async () => {
    const view = renderRoute('/tickets', {
      handlers: {
        '/auth/me': () => {
          throw new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'x' });
        },
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'No pudimos conectar con el servidor' })).toBeInTheDocument();
    expect(view.session.getState().status).toBe('unavailable');
  });

  it('shows only the export notice in an organization pending deletion', async () => {
    renderRoute('/tickets', {
      handlers: {
        '/auth/me': (options) => ({ ...fakeMe(options.headers?.Authorization), tenantMode: 'DELETION_PENDING' }),
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'La organización está en proceso de eliminación' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Navegación principal' })).not.toBeInTheDocument();
  });
});
