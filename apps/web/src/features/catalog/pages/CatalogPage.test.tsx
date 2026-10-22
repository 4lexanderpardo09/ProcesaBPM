import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const at = '2026-10-21T15:00:00.000Z';
const CARTERA = id(10);
const COMPRAS = id(11);
const HIGH = id(20);

const page = <T,>(items: readonly T[]) => ({ items, page: 1, pageSize: 25, total: items.length });
const category = (categoryId: string, name: string, isActive = true) => ({ id: categoryId, name, isActive, createdAt: at });
const priority = (priorityId: string, name: string, sortOrder: number) => ({ id: priorityId, name, sortOrder, color: null, isActive: true });
const grant = (action: string, subject: string) => ({ action, subject, conditional: false });

function handlers(extra: Record<string, FakeHandler> = {}): Record<string, FakeHandler> {
  return {
    '/categories': () => page([category(CARTERA, 'Cartera'), category(COMPRAS, 'Compras')]),
    '/subcategories': () => page([{ id: id(30), categoryId: CARTERA, name: 'Confirmación de pago', description: null, defaultPriorityId: HIGH, isActive: true, createdAt: at }]),
    '/priorities': () => page([priority(HIGH, 'Alta', 1), priority(id(21), 'Media', 2)]),
    '/error-types': () => page([{ id: id(40), name: 'Cierre prematuro', description: null, isProcessError: false, forcesClose: false, isReopening: true, isActive: true }]),
    ...extra,
  };
}

describe('CatalogPage', () => {
  it('lists the categories with their state and the actions an administrator has', async () => {
    renderRoute('/catalog', { handlers: handlers() });

    const table = await screen.findByRole('table', { name: 'Categorías' });
    expect(await within(table).findByText('Cartera')).toBeInTheDocument();
    expect(within(table).getAllByText('Activo')).toHaveLength(2);
    expect(within(table).getByRole('button', { name: 'Editar Cartera' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Prioridades' })).toBeInTheDocument();
  });

  it('searches by name and asks for the deactivated ones too', async () => {
    const { fake } = renderRoute('/catalog', { handlers: handlers() });

    await screen.findByRole('table', { name: 'Categorías' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar por nombre' }), 'car');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mostrar inactivos' }));

    await vi.waitFor(() => expect(fake.callsTo('/categories').at(-1)?.path).toBe('/categories?page=1&pageSize=25&includeInactive=true&search=car'));
  });

  it('creates a category and says so when the name is taken', async () => {
    let calls = 0;
    const create = () => {
      calls += 1;
      if (calls === 1) throw new ApiError({ status: 409, code: 'DUPLICATE', message: 'x' });
      return category(id(12), 'Tesorería');
    };
    const { fake } = renderRoute('/catalog', { handlers: handlers({ '/categories': (options) => (options.method === 'POST' ? create() : page([category(CARTERA, 'Cartera')])) }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Nueva categoría' }));
    const dialog = screen.getByRole('dialog', { name: 'Nueva categoría' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(within(dialog).getByRole('textbox', { name: /Nombre/ })).toHaveAccessibleDescription('Escribe el nombre.');

    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Cartera');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Ya existe uno con ese nombre. Usa otro.')).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByRole('textbox', { name: /Nombre/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Tesorería');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fake.calls.filter((call) => call.path === '/categories' && call.options.method === 'POST').at(-1)?.options.body).toEqual({ name: 'Tesorería' });
  });

  it('deactivates a category', async () => {
    const { fake } = renderRoute('/catalog', { handlers: handlers({ [`/categories/${COMPRAS}/deactivate`]: () => undefined }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Desactivar Compras' }));

    await vi.waitFor(() => expect(fake.callsTo(`/categories/${COMPRAS}/deactivate`)[0]?.options.method).toBe('POST'));
  });

  it('shows the subcategories of a category and adds one with its default priority', async () => {
    const saved = { id: id(31), categoryId: CARTERA, name: 'Acuerdo de pago', description: 'Cuotas atrasadas', defaultPriorityId: HIGH, isActive: true, createdAt: at };
    const { fake } = renderRoute('/catalog', { handlers: handlers({ '/subcategories': (options) => (options.method === 'POST' ? saved : page([])) }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Subcategorías de Cartera' }));
    const panel = await screen.findByRole('table', { name: 'Subcategorías de Cartera' });
    expect(await within(panel).findByText('Esta categoría todavía no tiene subcategorías.')).toBeInTheDocument();
    expect(fake.callsTo('/subcategories')[0]?.path).toContain(`categoryId=${CARTERA}`);

    await userEvent.click(screen.getByRole('button', { name: 'Nueva subcategoría' }));
    const dialog = screen.getByRole('dialog', { name: 'Nueva subcategoría' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Acuerdo de pago');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Descripción' }), 'Cuotas atrasadas');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Prioridad por defecto' }), await within(dialog).findByRole('option', { name: 'Alta' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() =>
      expect(fake.calls.find((call) => call.path === '/subcategories' && call.options.method === 'POST')?.options.body).toEqual({ categoryId: CARTERA, name: 'Acuerdo de pago', description: 'Cuotas atrasadas', defaultPriorityId: HIGH }),
    );
  });

  it('limits who sees a category to some companies, all departments staying open', async () => {
    const MAIN = id(60);
    const BRANCH = id(61);
    const company = (companyId: string, name: string) => ({ id: companyId, name, taxId: null, countryCode: 'CO', currencyCode: 'COP', timeZone: 'America/Bogota', calendarId: null, isDefault: false, isActive: true, createdAt: at });
    const { fake } = renderRoute('/catalog', {
      handlers: handlers({
        [`/categories/${CARTERA}/visibility`]: (options) => (options.method === 'PUT' ? options.body : { companyIds: [], departmentIds: [] }),
        '/companies': () => page([company(MAIN, 'Electrocréditos'), company(BRANCH, 'Finansueños')]),
        '/departments': () => page([{ id: id(62), name: 'Cartera', isActive: true, createdAt: at }]),
      }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Quién ve «Cartera»' }));
    const dialog = await screen.findByRole('dialog', { name: 'Quién ve «Cartera»' });
    expect(await within(dialog).findByText('La ven todas las empresas.')).toBeInTheDocument();
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Finansueños' }));
    expect(within(dialog).getByText('Solo la ve 1 empresa.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.calls.find((call) => call.options.method === 'PUT')?.options.body).toEqual({ companyIds: [BRANCH], departmentIds: [] }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Quién ve «Cartera»' })).toBeNull());
  });

  it('keeps a reopening type from also closing the ticket', async () => {
    const { fake } = renderRoute('/catalog?tab=error-types', { handlers: handlers({ [`/error-types/${id(40)}`]: (options) => ({ id: id(40), name: 'Cierre prematuro', description: null, isProcessError: false, forcesClose: true, isReopening: false, isActive: true, ...((options.body as object) ?? {}) }) }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Editar Cierre prematuro' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar tipo de error' });
    expect(within(dialog).getByRole('checkbox', { name: 'Se ofrece al reabrir un ticket cerrado' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Cierra el ticket al reportarlo' }));
    expect(within(dialog).getByRole('checkbox', { name: 'Se ofrece al reabrir un ticket cerrado' })).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.callsTo(`/error-types/${id(40)}`)[0]?.options).toMatchObject({ method: 'PATCH', body: { name: 'Cierre prematuro', description: null, isReopening: false, forcesClose: true, isProcessError: false } }));
  });

  it('offers only what the role allows: reading without changing shows no actions, and no catalog at all without reading', async () => {
    const reader = { permissions: [grant('read', 'Category'), grant('read', 'Priority')] };
    renderRoute('/catalog', { handlers: handlers({ '/auth/me/permissions': () => reader }) });

    const table = await screen.findByRole('table', { name: 'Categorías' });
    await within(table).findByText('Cartera');
    expect(screen.queryByRole('button', { name: 'Nueva categoría' })).toBeNull();
    expect(within(table).queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Categorías', 'Prioridades']);
  });

  it('tells a role that cannot read the catalog', async () => {
    renderRoute('/catalog', { handlers: handlers({ '/auth/me/permissions': () => ({ permissions: [grant('create', 'Ticket')] }) }) });
    expect(await screen.findByText('Tu rol no puede ver el catálogo.')).toBeInTheDocument();
  });
});
