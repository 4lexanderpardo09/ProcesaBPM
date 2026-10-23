import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { at, id, openConsole, page, tenant } from './console-test-helpers';

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...tenant(1, 'Acme'),
  plan: { code: 'basic', name: 'Básico' },
  owner: null,
  companies: 1,
  activeUsers: 3,
  storage: { usedBytes: '0', reservedBytes: '0', extraBytes: '0', limitBytes: '1073741824', hardLimitBytes: '1181116006', state: 'OK' },
  ticketsLast30Days: 0,
  lastActivityAt: null,
  suspension: null,
  deletion: null,
  dataExport: null,
  ...overrides,
});

describe('platform console: countries, operations, audit and deletion', () => {
  it('lists a country’s holidays by year, adds one and draws the year again from the rules', async () => {
    const holidays = [{ date: '2026-12-25', name: 'Navidad' }];
    const { fake } = await openConsole('/platform/countries', {
      '/platform/catalog/countries/CO/holidays': (options) => (options.method === 'POST' ? { date: '2026-11-02', name: 'Todos los santos' } : holidays),
      '/platform/catalog/countries/CO/holidays/regenerate': () => ({ year: 2026, holidays: [...holidays, { date: '2026-01-01', name: 'Año nuevo' }] }),
    });

    const card = (await screen.findByRole('heading', { name: 'Festivos de Colombia' })).closest('section') ?? document.body;
    expect(await within(card as HTMLElement).findByText('25/12/2026')).toBeInTheDocument();
    await userEvent.type(within(card as HTMLElement).getByLabelText('Fecha'), '2026-11-02');
    await userEvent.type(within(card as HTMLElement).getByRole('textbox', { name: 'Nombre' }), 'Todos los santos');
    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Agregar festivo' }));
    await vi.waitFor(() => expect(fake.calls.find((call) => call.options.method === 'POST' && call.path.endsWith('/holidays'))?.options.body).toEqual({ date: '2026-11-02', name: 'Todos los santos' }));

    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Calcular de nuevo con las reglas del país' }));
    expect(await within(card as HTMLElement).findByText('Año nuevo')).toBeInTheDocument();
    expect(fake.callsTo('/platform/catalog/countries/CO/holidays/regenerate')[0]?.options.body).toEqual({ year: new Date().getFullYear() });
  });

  it('shows the metrics and sends a failed event of an organization again', async () => {
    const failed = { scope: 'TENANT', tenantId: id(1), id: id(90), type: 'document.generate', attempts: 5, lastError: 'timeout', createdAt: at };
    const { fake } = await openConsole('/platform/operations', {
      '/platform/operations/metrics': () => ({ tenantsByStatus: { ACTIVE: 3, SUSPENDED: 1 }, users: { total: 40, withActiveMembership: 35 }, storageUsedBytes: '2147483648', ticketsPerDay: [{ date: '2026-10-20', count: 12 }, { date: '2026-10-21', count: 8 }] }),
      '/platform/operations/outbox-events/failed': () => page([failed]),
      [`/platform/operations/outbox-events/tenants/${id(1)}/${id(90)}/retry`]: () => undefined,
    });

    expect(await screen.findByText('Organizaciones: Activa')).toBeInTheDocument();
    expect(screen.getByText('40 (35 con una organización activa)')).toBeInTheDocument();
    expect(screen.getByText('2 GB')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar el evento document.generate' }));
    await vi.waitFor(() => expect(fake.callsTo(`/platform/operations/outbox-events/tenants/${id(1)}/${id(90)}/retry`)).toHaveLength(1));
    expect(fake.callsTo('/platform/operations/outbox-events/failed')[0]?.path).toContain('scope=TENANT');
    await userEvent.click(screen.getByRole('tab', { name: 'De la plataforma' }));
    await vi.waitFor(() => expect(fake.callsTo('/platform/operations/outbox-events/failed').some((call) => call.path.includes('scope=PLATFORM'))).toBe(true));
  });

  it('filters the audit by action and dates', async () => {
    const { fake } = await openConsole('/platform/audit', {
      '/platform/audit-logs': () => page([{ id: '1', actorUserId: id(70), action: 'tenant.suspended', targetTenantId: id(1), data: {}, ipAddress: '10.0.0.1', createdAt: at }]),
    });
    expect(await screen.findByText('tenant.suspended')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /^Acción/ }), 'tenant');
    await userEvent.type(screen.getByLabelText('Desde'), '2026-10-01');
    await vi.waitFor(() => expect(fake.callsTo('/platform/audit-logs').some((call) => call.path.includes('action=tenant') && call.path.includes('from='))).toBe(true));
  });

  it('asks to delete an organization with its name typed again, and cancels it', async () => {
    let current = detail();
    const { fake } = await openConsole(`/platform/tenants/${id(1)}`, {
      [`/platform/tenants/${id(1)}`]: () => current,
      [`/platform/tenants/${id(1)}/deletion`]: (options) => {
        current = options.method === 'POST' ? detail({ status: 'PENDING_DELETION', deletion: { requestedAt: at, purgeAfter: '2026-10-31T15:00:00.000Z', purgedAt: null } }) : detail({ status: 'SUSPENDED' });
        return { tenantId: id(1), status: options.method === 'POST' ? 'PENDING_DELETION' : 'SUSPENDED', purgeAfter: null };
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eliminar «Acme»' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Escribe «Acme»/ }), 'acme');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Motivo/ }), 'Lo pidió el cliente');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }));
    expect(within(dialog).getByText('El nombre no coincide.')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByRole('textbox', { name: /Escribe «Acme»/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Escribe «Acme»/ }), 'Acme');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }));

    expect(await screen.findByText(/Se pidió eliminarla el/)).toBeInTheDocument();
    expect(fake.callsTo(`/platform/tenants/${id(1)}/deletion`)[0]?.options.body).toEqual({ confirmName: 'Acme', reason: 'Lo pidió el cliente' });
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar la eliminación' }));
    await vi.waitFor(() => expect(fake.callsTo(`/platform/tenants/${id(1)}/deletion`).at(-1)?.options.method).toBe('DELETE'));
  });
});
