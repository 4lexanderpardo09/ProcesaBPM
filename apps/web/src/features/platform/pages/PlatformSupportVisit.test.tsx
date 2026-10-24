import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import type { FakeHandler } from '@/test/fake-transport';
import { makeJwt } from '@/test/jwt';
import { at, id, openConsole, tenant } from './console-test-helpers';

const detail = () => ({
  ...tenant(1, 'Acme'),
  plan: { code: 'basic', name: 'Básico' },
  owner: null,
  companies: 1,
  activeUsers: 3,
  storage: { usedBytes: '0', reservedBytes: '0', extraBytes: '0', limitBytes: '1073741824', hardLimitBytes: '1181116006', state: 'OK' },
  ticketsLast30Days: 0,
  lastActivityAt: at,
  suspension: null,
  deletion: null,
  dataExport: null,
});

const sessions = `/platform/tenants/${id(1)}/support-sessions`;
const supportToken = makeJwt({ sub: id(9), tid: id(1), sid: id(101) });
const opened = { accessToken: supportToken, expiresIn: 900, sessionId: id(101), grantId: id(50), grantExpiresAt: '2026-10-25T15:00:00.000Z' };
/** What the support template grants: reading, never writing. */
const readOnly = { permissions: [{ action: 'read', subject: 'Ticket', conditional: false }, { action: 'read_all', subject: 'Ticket', conditional: false }, { action: 'read', subject: 'Workflow', conditional: false }] };

async function openTenant(handlers: Record<string, FakeHandler>) {
  const rendered = await openConsole(`/platform/tenants/${id(1)}`, { [`/platform/tenants/${id(1)}`]: () => detail(), '/auth/me/permissions': () => readOnly, ...handlers });
  await screen.findByRole('heading', { level: 1, name: 'Acme' });
  return rendered;
}

describe('support visit from the platform console', () => {
  it('opens the organization read-only over the support token, and ends back on its page', async () => {
    const { fake, router } = await openTenant({ [sessions]: () => opened, [`${sessions}/${id(101)}`]: () => undefined });

    await userEvent.click(screen.getByRole('button', { name: 'Entrar en modo soporte' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Hola, Soporte' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    const topbar = screen.getAllByRole('banner').find((header) => within(header).queryByText('Soporte · solo lectura') !== null)!;
    expect(within(topbar).getByText('Acme')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /cuenta/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Nuevo ticket/ })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(fake.callsTo('/dashboard/stats').at(-1)?.options.headers?.Authorization).toBe(`Bearer ${supportToken}`));
    expect(fake.callsTo('/auth/me')).toHaveLength(0);

    await userEvent.click(within(topbar).getByRole('button', { name: 'Terminar visita' }));
    expect(await screen.findByText('Terminaste la visita.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/platform/tenants/${id(1)}`);
    expect(fake.callsTo(`${sessions}/${id(101)}`)).toEqual([expect.objectContaining({ options: expect.objectContaining({ method: 'DELETE' }) })]);
    expect(screen.getByRole('button', { name: 'Entrar en modo soporte' })).toBeEnabled();
  });

  it('says so when the organization has not given support access', async () => {
    await openTenant({
      [sessions]: () => {
        throw new ApiError({ status: 403, code: 'SUPPORT_ACCESS_NOT_GRANTED', message: 'x' });
      },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Entrar en modo soporte' }));
    expect(await screen.findByText(/no ha dado acceso de soporte/)).toBeInTheDocument();
  });

  it('comes back to the console and says why when the organization withdraws the access', async () => {
    let refused = false;
    const { routes, router } = await openTenant({ [sessions]: () => opened });
    await userEvent.click(screen.getByRole('button', { name: 'Entrar en modo soporte' }));
    await screen.findByRole('heading', { level: 1, name: 'Hola, Soporte' });

    routes[sessions] = () => {
      throw new ApiError({ status: 403, code: 'SUPPORT_ACCESS_NOT_GRANTED', message: 'x' });
    };
    routes['/tickets'] = () => {
      refused = true;
      throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'x' });
    };
    await router.navigate('/tickets');
    expect(await screen.findByText(/el acceso de soporte de la organización venció o lo retiraron/)).toBeInTheDocument();
    expect(refused).toBe(true);
  });
});
