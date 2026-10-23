import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import { at, id, openConsole, page, tenant } from './console-test-helpers';

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...tenant(1, 'Acme'),
  plan: { code: 'basic', name: 'Básico' },
  owner: { email: 'owner@acme.test', firstName: 'Olga', lastName: 'Ruiz', membershipStatus: 'ACTIVE' },
  companies: 2,
  activeUsers: 14,
  storage: { usedBytes: '524288000', reservedBytes: '0', extraBytes: '0', limitBytes: '1073741824', hardLimitBytes: '1181116006', state: 'OK' },
  ticketsLast30Days: 120,
  lastActivityAt: at,
  suspension: null,
  deletion: null,
  dataExport: null,
  ...overrides,
});

describe('platform console', () => {
  it('lists the organizations with filters and opens one', async () => {
    const { fake, router } = await openConsole('/platform', { '/platform/tenants': () => page([tenant(1, 'Acme'), tenant(2, 'Globex', { status: 'SUSPENDED', planCode: 'pro' })]), [`/platform/tenants/${id(1)}`]: () => detail() });

    const table = await screen.findByRole('table', { name: 'Organizaciones' });
    expect(await within(table).findByRole('cell', { name: 'Pro' })).toBeInTheDocument();
    expect(within(table).getByText('Suspendida')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'Suspendida');
    await vi.waitFor(() => expect(fake.callsTo('/platform/tenants').some((call) => call.path.includes('status=SUSPENDED'))).toBe(true));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar por nombre o identificador' }), 'acm');
    await vi.waitFor(() => expect(fake.callsTo('/platform/tenants').some((call) => call.path.includes('search=acm'))).toBe(true));

    await userEvent.click(within(table).getByText('Acme'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/platform/tenants/${id(1)}`);
    expect(screen.getByText('Olga Ruiz · owner@acme.test')).toBeInTheDocument();
    expect(screen.getByText(/500 MB de 1 GB · Dentro del límite/)).toBeInTheDocument();
  });

  it('creates an organization with a slug from its name and opens it', async () => {
    const { fake, router } = await openConsole('/platform', {
      '/platform/tenants': (options) => (options.method === 'POST' ? { tenantId: id(3), slug: 'nueva-sas', ownerUserId: id(4) } : page([])),
      [`/platform/tenants/${id(3)}`]: () => detail({ tenantId: id(3), name: 'Nueva SAS', slug: 'nueva-sas' }),
    });

    await userEvent.click(screen.getByRole('button', { name: 'Nueva organización' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva organización' });
    await userEvent.type(within(dialog).getAllByRole('textbox', { name: /^Nombre/ })[0]!, 'Nueva SAS Ñandú');
    expect(within(dialog).getByRole('textbox', { name: /^Identificador/ })).toHaveValue('nueva-sas-nandu');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear' }));
    expect(within(dialog).getAllByText('Completa este dato.')).toHaveLength(3);

    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Correo/ }), 'owner@nueva.test');
    const names = within(dialog).getAllByRole('textbox', { name: /^Nombre/ });
    await userEvent.type(names[1]!, 'Olga');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Apellido/ }), 'Ruiz');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /^Plan/ }), 'Pro');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear' }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/platform/tenants/${id(3)}`));
    expect(fake.calls.find((call) => call.path === '/platform/tenants' && call.options.method === 'POST')?.options.body).toEqual({
      name: 'Nueva SAS Ñandú',
      slug: 'nueva-sas-nandu',
      planCode: 'pro',
      countryCode: 'CO',
      owner: { email: 'owner@nueva.test', firstName: 'Olga', lastName: 'Ruiz' },
    });
  });

  it('suspends an organization with a reason, and changes its plan', async () => {
    let current = detail();
    const { fake } = await openConsole(`/platform/tenants/${id(1)}`, {
      [`/platform/tenants/${id(1)}`]: () => current,
      [`/platform/tenants/${id(1)}/suspend`]: () => {
        current = detail({ status: 'SUSPENDED', suspension: { reason: 'Falta de pago', at } });
        return { tenantId: id(1), status: 'SUSPENDED' };
      },
      [`/platform/tenants/${id(1)}/plan`]: () => detail({ planCode: 'pro', plan: { code: 'pro', name: 'Pro' } }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Suspender' }));
    const dialog = await screen.findByRole('dialog', { name: 'Suspender «Acme»' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Motivo/ }), 'no');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspender' }));
    expect(within(dialog).getByText('Escribe al menos 3 caracteres.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Motivo/ }), ' pagó');
    await userEvent.clear(within(dialog).getByRole('textbox', { name: /^Motivo/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Motivo/ }), 'Falta de pago');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspender' }));
    expect(await screen.findByText(/Suspendida el .*: Falta de pago/)).toBeInTheDocument();
    expect(fake.callsTo(`/platform/tenants/${id(1)}/suspend`)[0]?.options.body).toEqual({ reason: 'Falta de pago' });
    expect(screen.getByRole('button', { name: 'Reactivar' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cambiar de plan' }), 'Pro');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Plan cambiado.')).toBeInTheDocument();
    expect(fake.callsTo(`/platform/tenants/${id(1)}/plan`)[0]?.options.body).toEqual({ planCode: 'pro' });
  });

  it('a 401 of the console ends it and sends the person back to sign in', async () => {
    const { router } = await openConsole(`/platform/tenants/${id(9)}`, {
      [`/platform/tenants/${id(9)}`]: () => {
        throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'expired' });
      },
    });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toContain('notice=expired');
  });

  it('makes an announcement for some organizations and removes another', async () => {
    const existing = { id: id(50), type: 'MAINTENANCE', title: 'Ventana del sábado', body: 'Sin servicio de 1 a 3.', startsAt: at, endsAt: '2026-10-01T18:00:00.000Z', blocksLogin: true, audience: 'ALL', tenantIds: [] };
    const { fake } = await openConsole('/platform/announcements', {
      '/platform/announcements': (options) => (options.method === 'POST' ? { ...existing, id: id(51), ...(options.body as object) } : [existing]),
      [`/platform/announcements/${id(50)}`]: () => undefined,
      '/platform/tenants': () => page([tenant(1, 'Acme'), tenant(2, 'Globex')]),
    });

    const table = await screen.findByRole('table', { name: 'Avisos' });
    expect(await within(table).findByText('Ventana del sábado')).toBeInTheDocument();
    expect(within(table).getByText('Bloquea')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo aviso' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo aviso' });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Tipo' }), 'Notas de cambios');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Título/ }), 'Versión 2.4');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Texto/ }), 'Llegó la bandeja de lote.');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Para' }), 'Algunas organizaciones');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(within(dialog).getByText('Elige al menos una organización.')).toBeInTheDocument();
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Globex (globex)' }));
    expect(within(dialog).getByRole('checkbox', { name: 'Globex' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.calls.some((call) => call.path === '/platform/announcements' && call.options.method === 'POST')).toBe(true));
    expect(fake.calls.find((call) => call.path === '/platform/announcements' && call.options.method === 'POST')?.options.body).toMatchObject({ type: 'RELEASE_NOTES', title: 'Versión 2.4', audience: 'TENANTS', tenantIds: [id(2)], endsAt: null, blocksLogin: false });

    await userEvent.click(within(table).getByRole('button', { name: 'Quitar «Ventana del sábado»' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Quitar' })).getByRole('button', { name: 'Quitar' }));
    await vi.waitFor(() => expect(fake.callsTo(`/platform/announcements/${id(50)}`)[0]?.options.method).toBe('DELETE'));
  });
});
