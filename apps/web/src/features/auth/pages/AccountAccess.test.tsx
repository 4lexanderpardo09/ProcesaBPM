import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import { decodeIdentity } from '@/shared/session/access-token';
import { fakeProfile } from '@/test/fake-profile';
import { renderRoute } from '@/test/render-route';

const TOKEN = 'a-one-time-token-of-the-email-link';
const ACME = '018f0000-0000-7000-8000-000000000002';
const GLOBEX = '018f0000-0000-7000-8000-000000000009';

describe('recovering access', () => {
  it('asks for a reset link and says to check the inbox, whatever the e-mail', async () => {
    const { fake } = renderRoute('/forgot-password', { signedIn: false, handlers: { '/auth/password-reset/request': () => undefined } });

    await userEvent.click(await screen.findByRole('button', { name: 'Enviar el enlace' }));
    expect(screen.getByText('Escribe tu correo.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /Correo/ }), 'ana@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar el enlace' }));

    expect(await screen.findByRole('heading', { name: 'Revisa tu correo' })).toBeInTheDocument();
    expect(fake.callsTo('/auth/password-reset/request')[0]?.options.body).toEqual({ email: 'ana@example.com' });
  });

  it('sets a new password typed twice from the e-mail link, takes the token out of the address bar and signs in again', async () => {
    const { fake, router } = renderRoute(`/reset-password#token=${TOKEN}`, { signedIn: false, handlers: { '/auth/password-reset/confirm': () => undefined } });

    expect(await screen.findByRole('heading', { name: 'Elige una contraseña nueva' })).toBeInTheDocument();
    await vi.waitFor(() => expect(router.state.location.hash).toBe(''));
    await userEvent.type(screen.getByLabelText(/^Contraseña nueva/), 'una clave larga');
    await userEvent.type(screen.getByLabelText(/^Repite la contraseña/), 'otra clave larga');
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar la contraseña' }));
    expect(screen.getByText('Las dos contraseñas no coinciden.')).toBeInTheDocument();
    expect(fake.callsTo('/auth/password-reset/confirm')).toHaveLength(0);

    await userEvent.clear(screen.getByLabelText(/^Repite la contraseña/));
    await userEvent.type(screen.getByLabelText(/^Repite la contraseña/), 'una clave larga');
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar la contraseña' }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(fake.callsTo('/auth/password-reset/confirm')[0]?.options.body).toEqual({ token: TOKEN, newPassword: 'una clave larga' });
    expect(await screen.findByText('Tu contraseña quedó cambiada. Inicia sesión con la nueva.')).toBeInTheDocument();
  });

  it('says when the reset link expired, and offers a new one', async () => {
    renderRoute(`/reset-password#token=${TOKEN}`, {
      signedIn: false,
      handlers: {
        '/auth/password-reset/confirm': () => {
          throw new ApiError({ status: 400, code: 'INVALID_TOKEN', message: 'x' });
        },
      },
    });

    await userEvent.type(await screen.findByLabelText(/^Contraseña nueva/), 'una clave larga');
    await userEvent.type(screen.getByLabelText(/^Repite la contraseña/), 'una clave larga');
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar la contraseña' }));

    expect(await screen.findByRole('heading', { name: 'El enlace ya no sirve' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pedir un enlace nuevo' })).toHaveAttribute('href', '/forgot-password');
  });
});

describe('accepting an invitation', () => {
  it('joins someone who already has an account at once', async () => {
    const { fake, router } = renderRoute(`/accept-invitation#token=${TOKEN}`, { signedIn: false, handlers: { '/auth/invitations/accept': () => ({ tenantId: ACME }) } });

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(fake.callsTo('/auth/invitations/accept')[0]?.options.body).toEqual({ token: TOKEN });
    expect(await screen.findByText('Ya eres parte de la organización. Inicia sesión para entrar.')).toBeInTheDocument();
  });

  it('asks someone new to choose a password, and sends it with the same link', async () => {
    const { fake, router } = renderRoute(`/accept-invitation#token=${TOKEN}`, {
      signedIn: false,
      handlers: {
        '/auth/invitations/accept': (options) => {
          if ((options.body as { password?: string }).password === undefined) throw new ApiError({ status: 422, code: 'INVALID_STATE', message: 'x' });
          return { tenantId: ACME };
        },
      },
    });

    expect(await screen.findByText(/elige la contraseña con la que vas a entrar/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Contraseña nueva/), 'una clave larga');
    await userEvent.type(screen.getByLabelText(/^Repite la contraseña/), 'una clave larga');
    await userEvent.click(screen.getByRole('button', { name: 'Crear mi cuenta y unirme' }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(fake.callsTo('/auth/invitations/accept').map((call) => call.options.body)).toEqual([{ token: TOKEN }, { token: TOKEN, password: 'una clave larga' }]);
  });

  it('says when the invitation no longer works', async () => {
    renderRoute(`/accept-invitation#token=${TOKEN}`, {
      signedIn: false,
      handlers: {
        '/auth/invitations/accept': () => {
          throw new ApiError({ status: 400, code: 'INVALID_TOKEN', message: 'x' });
        },
      },
    });

    expect(await screen.findByRole('heading', { name: 'La invitación ya no sirve' })).toBeInTheDocument();
  });
});

describe('moving between organizations', () => {
  /** `/auth/me` names the organization of the token: tenant-1 is Acme, globex is Globex. */
  const profileOf = (authorization: string | undefined) => {
    const base = fakeProfile(authorization);
    const tenant = decodeIdentity(authorization?.replace('Bearer ', '') ?? '')?.tenantId;
    return tenant === GLOBEX ? { ...base, membership: { ...base.membership, tenantId: GLOBEX }, organization: { id: GLOBEX, slug: 'globex', name: 'Globex' } } : base;
  };
  const organizations = {
    organizations: [
      { tenantId: ACME, slug: 'acme', name: 'Acme', membershipStatus: 'ACTIVE', mfaRequired: false, tenantStatus: 'ACTIVE', maintenance: null },
      { tenantId: GLOBEX, slug: 'globex', name: 'Globex', membershipStatus: 'ACTIVE', mfaRequired: false, tenantStatus: 'ACTIVE', maintenance: null },
      { tenantId: '018f0000-0000-7000-8000-00000000000a', slug: 'initech', name: 'Initech', membershipStatus: 'INVITED', mfaRequired: false, tenantStatus: 'ACTIVE', maintenance: null },
    ],
  };

  it('switches to another organization from the top bar, without signing in again', async () => {
    const { fake } = renderRoute('/tickets', { handlers: { '/auth/me': (options) => profileOf(options.headers?.Authorization), '/auth/me/organizations': () => organizations } });

    const switcher = await screen.findByRole('combobox', { name: 'Organización' });
    expect(within(switcher).getAllByRole('option').map((option) => option.textContent)).toEqual(['Acme', 'Globex']);
    await userEvent.selectOptions(switcher, 'Globex');

    await vi.waitFor(() => expect(fake.callsTo('/auth/switch-tenant')[0]?.options.body).toEqual({ tenantId: GLOBEX }));
    await vi.waitFor(() => expect(screen.getByRole('combobox', { name: 'Organización' })).toHaveDisplayValue('Globex'));
  });

  it('opens an e-mail link of another organization in that organization, without the parameter', async () => {
    const { fake, router } = renderRoute(`/tickets?tenant=${GLOBEX}`, { handlers: { '/auth/me': (options) => profileOf(options.headers?.Authorization), '/auth/me/organizations': () => organizations } });

    await vi.waitFor(() => expect(fake.callsTo('/auth/switch-tenant')[0]?.options.body).toEqual({ tenantId: GLOBEX }));
    await vi.waitFor(() => expect(`${router.state.location.pathname}${router.state.location.search}`).toBe('/tickets'));
    expect(fake.callsTo('/auth/switch-tenant')).toHaveLength(1);
  });

  it('only shows the name when there is no other organization to open', async () => {
    renderRoute('/tickets');

    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Organización' })).toBeNull();
  });
});
