import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const at = '2026-10-21T15:00:00.000Z';
const MAIN = id(10);
const BRANCH = id(11);
const NORTH = id(20);
const NORTH_STORE = id(21);
const SOUTH = id(22);

const page = <T,>(items: readonly T[]) => ({ items, page: 1, pageSize: 25, total: items.length });
const company = (companyId: string, name: string, isDefault: boolean) => ({ id: companyId, name, taxId: null, countryCode: 'CO', currencyCode: 'COP', timeZone: 'America/Bogota', calendarId: null, isDefault, isActive: true, createdAt: at });
const site = (siteId: string, name: string, parentId: string | null, level: number, children: unknown[] = []) => ({ id: siteId, parentId, level, name, isCentral: false, isActive: true, createdAt: at, children });
const grant = (action: string, subject: string) => ({ action, subject, conditional: false });

function handlers(extra: Record<string, FakeHandler> = {}): Record<string, FakeHandler> {
  return {
    '/companies': () => page([company(MAIN, 'Electrocréditos', true), company(BRANCH, 'Finansueños', false)]),
    '/countries': () => [{ code: 'CO', name: 'Colombia', currencyCode: 'COP', timeZone: 'America/Bogota' }],
    '/calendars': () => page([{ id: id(40), name: 'Colombia', countryCode: 'CO', isDefault: true, createdAt: at }]),
    '/sites/tree': () => [site(SOUTH, 'Sede Sur', null, 1), site(NORTH, 'Sede Norte', null, 1, [site(NORTH_STORE, 'Bodega Norte', NORTH, 2)])],
    '/site-levels': () => [{ level: 1, name: 'Regional' }],
    '/departments': () => page([{ id: id(30), name: 'Cartera', isActive: true, createdAt: at }]),
    '/positions': () => page([]),
    ...extra,
  };
}

describe('OrganizationPage', () => {
  it('lists the companies with the default one marked, and makes another the default', async () => {
    const { fake } = renderRoute('/organization', { handlers: handlers({ [`/companies/${BRANCH}/make-default`]: () => company(BRANCH, 'Finansueños', true) }) });

    const table = await screen.findByRole('table', { name: 'Empresas' });
    expect(within(await within(table).findByText('Electrocréditos')).getByText('Predeterminada')).toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: 'Hacer predeterminada Electrocréditos' })).toBeNull();
    expect(within(table).getAllByText('Colombia')).toHaveLength(2);
    await userEvent.click(within(table).getByRole('button', { name: 'Hacer predeterminada Finansueños' }));

    await vi.waitFor(() => expect(fake.callsTo(`/companies/${BRANCH}/make-default`)[0]?.options.method).toBe('POST'));
  });

  it('creates a company of a known country, leaving currency and time zone to the country', async () => {
    const { fake } = renderRoute('/organization', { handlers: handlers({ '/companies': (options) => (options.method === 'POST' ? company(id(12), 'Nueva', false) : page([])) }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Nueva empresa' }));
    const dialog = screen.getByRole('dialog', { name: 'Nueva empresa' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Nueva');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(within(dialog).getByRole('combobox', { name: /País/ })).toHaveAccessibleDescription('Elige el país de la empresa.');

    const country = within(dialog).getByRole('combobox', { name: /País/ });
    await userEvent.selectOptions(country, await within(country).findByRole('option', { name: 'Colombia' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'NIT' }), '900123456-7');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === '/companies' && call.options.method === 'POST')?.options.body).toEqual({ name: 'Nueva', countryCode: 'CO', taxId: '900123456-7' }));
  });

  it('refuses a currency or a time zone that is not one', async () => {
    renderRoute('/organization', { handlers: handlers() });

    await userEvent.click(await screen.findByRole('button', { name: 'Editar Finansueños' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar empresa' });
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Moneda' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Moneda' }), 'CO');
    await userEvent.clear(within(dialog).getByRole('combobox', { name: 'Zona horaria' }));
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Zona horaria' }), 'Bogotá');

    expect(within(dialog).getByRole('textbox', { name: 'Moneda' })).toHaveAccessibleDescription('Usa el código de tres letras, p. ej. COP.');
    expect(within(dialog).getByRole('combobox', { name: 'Zona horaria' })).toHaveAccessibleDescription('Elige una zona de la lista, p. ej. America/Bogota.');
  });

  it('shows the sites as a tree with the names of their levels, and adds a site inside another', async () => {
    const { fake } = renderRoute('/organization?tab=sites', { handlers: handlers({ '/sites': () => site(id(23), 'Punto Norte', NORTH, 2) }) });

    const table = await screen.findByRole('table', { name: 'Sedes' });
    await within(table).findByText('Bodega Norte');
    expect(within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual(['Sede Norte', '└Bodega Norte', 'Sede Sur']);
    expect(within(table).getAllByText('Regional')).toHaveLength(2);
    expect(within(table).getByText('Nivel 2')).toBeInTheDocument();

    await userEvent.click(within(table).getByRole('button', { name: 'Agregar una sede dentro de Sede Norte' }));
    const dialog = screen.getByRole('dialog', { name: 'Nueva sede dentro de «Sede Norte»' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Punto Norte');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.callsTo('/sites')[0]?.options.body).toEqual({ name: 'Punto Norte', isCentral: false, parentId: NORTH }));
  });

  it('moves a site, never inside its own branch', async () => {
    const { fake } = renderRoute('/organization?tab=sites', { handlers: handlers({ [`/sites/${NORTH}/move`]: () => site(NORTH, 'Sede Norte', SOUTH, 2) }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Mover Sede Norte' }));
    const dialog = screen.getByRole('dialog', { name: 'Mover «Sede Norte»' });
    const options = within(within(dialog).getByRole('combobox', { name: 'Dentro de' })).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['En el primer nivel', 'Sede Sur']);
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Dentro de' }), 'Sede Sur');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mover' }));

    await vi.waitFor(() => expect(fake.callsTo(`/sites/${NORTH}/move`)[0]?.options.body).toEqual({ parentId: SOUTH }));
  });

  it('names the levels in order: only the next unnamed one can be named', async () => {
    renderRoute('/organization?tab=sites', { handlers: handlers({ '/site-levels': () => [] }) });

    expect(await screen.findByRole('button', { name: 'Nombre del nivel 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nombre del nivel 2' })).toBeNull();
  });

  it('lists departments and shows only the tabs the role can read', async () => {
    renderRoute('/organization', { handlers: handlers({ '/auth/me/permissions': () => ({ permissions: [grant('read', 'Department'), grant('create', 'Department')] }) }) });

    expect(await screen.findByRole('table', { name: 'Departamentos' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Departamentos']);
    expect(screen.getByRole('button', { name: 'Nuevo departamento' })).toBeInTheDocument();
  });
});
