import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const at = '2026-10-21T15:00:00.000Z';
const CAT = id(10);
const PAYMENTS = id(11);
const REFUNDS = id(12);
const FLOW = id(20);
const V1 = id(21);
const V2 = id(22);
const POSITION = id(30);
const GROUP = id(31);
const OLGA = id(40);

const page = <T,>(items: readonly T[]) => ({ items, page: 1, pageSize: 100, total: items.length });
const version = (versionId: string, number: number, status: string, overrides: Record<string, unknown> = {}) => ({
  id: versionId,
  number,
  status,
  notes: null,
  revision: 0,
  publishedAt: status === 'DRAFT' ? null : at,
  publishedById: null,
  createdAt: at,
  ...overrides,
});
const listItem = (overrides: Record<string, unknown> = {}) => ({
  id: FLOW,
  subcategoryId: PAYMENTS,
  name: 'Confirmación de pagos',
  isActive: true,
  createdAt: at,
  subcategory: { id: PAYMENTS, name: 'Pagos', category: { id: CAT, name: 'Cartera' } },
  publishedVersion: { id: V1, number: 1 },
  draftVersion: null,
  ...overrides,
});

/** A fake API with one workflow that keeps its versions and observers in memory. */
function api(initial: { versions?: ReturnType<typeof version>[]; isActive?: boolean } = {}) {
  let versions = initial.versions ?? [version(V1, 1, 'PUBLISHED')];
  let workflow = { id: FLOW, subcategoryId: PAYMENTS, name: 'Confirmación de pagos', isActive: initial.isActive ?? true, createdAt: at };
  let observers: Array<Record<string, unknown>> = [{ id: id(50), participantType: 'POSITION', userId: null, positionId: POSITION, groupId: null }];
  const detail = () => ({ ...workflow, versions });
  const handlers: Record<string, FakeHandler> = {
    '/workflows': (options) => {
      if (options.method === 'POST') return { ...workflow, id: id(60), versions: [version(id(61), 1, 'DRAFT')] };
      return page([listItem({ name: workflow.name, isActive: workflow.isActive })]);
    },
    [`/workflows/${FLOW}`]: (options) => {
      if (options.method === 'PATCH') workflow = { ...workflow, ...(options.body as object) };
      return detail();
    },
    [`/workflows/${FLOW}/versions`]: (options) => {
      const body = options.body as { fromVersionId?: string; notes?: string };
      const created = version(V2, versions.length + 1, 'DRAFT', { notes: body.notes ?? null });
      versions = [created, ...versions];
      return created;
    },
    [`/workflows/${FLOW}/versions/${V2}`]: () => {
      versions = versions.filter((candidate) => candidate.id !== V2);
    },
    [`/workflows/${FLOW}/observers`]: (options) => {
      if (options.method === 'POST') {
        const body = options.body as Record<string, string>;
        const added = { id: id(51), participantType: body.participantType, userId: body.userId ?? null, positionId: body.positionId ?? null, groupId: body.groupId ?? null };
        observers = [...observers, added];
        return added;
      }
      return observers;
    },
    [`/workflows/${FLOW}/observers/${id(50)}`]: () => {
      observers = observers.filter((observer) => observer.id !== id(50));
    },
    '/categories': () => page([{ id: CAT, name: 'Cartera', isActive: true, createdAt: at }]),
    '/subcategories': () => page([PAYMENTS, REFUNDS].map((subId, index) => ({ id: subId, categoryId: CAT, name: index === 0 ? 'Pagos' : 'Devoluciones', description: null, defaultPriorityId: null, isActive: true, createdAt: at }))),
    '/positions': () => page([{ id: POSITION, name: 'Analista de cartera', isActive: true, createdAt: at }]),
    '/groups': () => page([{ id: GROUP, name: 'Tesorería', isActive: true, createdAt: at }]),
    '/members/directory': (_options, path) => (path.includes('ids=') ? [{ userId: OLGA, firstName: 'Olga', lastName: 'Pérez' }] : [{ userId: OLGA, firstName: 'Olga', lastName: 'Pérez' }]),
  };
  return handlers;
}

const reader = { '/auth/me/permissions': () => ({ permissions: [{ action: 'read', subject: 'Workflow', conditional: false }] }) };

describe('workflows', () => {
  it('lists each workflow with its subcategory and where its versions stand, and opens one', async () => {
    const { router } = renderRoute('/workflows', {
      handlers: {
        ...api(),
        '/workflows': () => page([listItem(), listItem({ id: id(70), name: 'Devoluciones', subcategory: { id: REFUNDS, name: 'Devoluciones', category: { id: CAT, name: 'Cartera' } }, publishedVersion: null, draftVersion: { id: id(71), number: 1 } })]),
      },
    });

    const table = await screen.findByRole('table', { name: 'Flujos' });
    const payments = (await within(table).findByRole('link', { name: 'Confirmación de pagos' })).closest('tr')!;
    expect(within(payments).getByText('Cartera › Pagos')).toBeInTheDocument();
    expect(within(payments).getByText('v1')).toBeInTheDocument();
    const refunds = within(table).getByRole('link', { name: 'Devoluciones' }).closest('tr')!;
    expect(within(refunds).getByText('Sin publicar')).toBeInTheDocument();
    expect(within(refunds).getByText('v1')).toBeInTheDocument();

    await userEvent.click(within(payments).getByRole('link', { name: 'Confirmación de pagos' }));
    expect(router.state.location.pathname).toBe(`/workflows/${FLOW}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' })).toBeInTheDocument();
    expect(await screen.findByText('Cartera › Pagos')).toBeInTheDocument();
  });

  it('creates a workflow only for a subcategory without one, named like it by default', async () => {
    const { fake, router } = renderRoute('/workflows', { handlers: api() });

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo flujo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo flujo' });
    const subcategory = await within(dialog).findByRole('combobox', { name: /Subcategoría/ });
    expect(within(subcategory).queryByRole('option', { name: 'Cartera › Pagos' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear flujo' }));
    expect(within(dialog).getByText('Elige la subcategoría.')).toBeInTheDocument();

    await userEvent.selectOptions(subcategory, 'Cartera › Devoluciones');
    expect(within(dialog).getByRole('textbox', { name: /Nombre/ })).toHaveValue('Devoluciones');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear flujo' }));

    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === '/workflows' && call.options.method === 'POST')?.options.body).toEqual({ subcategoryId: REFUNDS, name: 'Devoluciones' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/workflows/${id(60)}`));
  });

  it('says when the subcategory already has a workflow', async () => {
    renderRoute('/workflows', {
      handlers: {
        ...api(),
        '/workflows': (options) => {
          if (options.method === 'POST') throw new ApiError({ status: 409, code: 'DUPLICATE', message: 'x' });
          return page([]);
        },
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo flujo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo flujo' });
    await userEvent.selectOptions(await within(dialog).findByRole('combobox', { name: /Subcategoría/ }), 'Cartera › Pagos');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear flujo' }));

    expect(await within(dialog).findByText('Esa subcategoría ya tiene un flujo.')).toBeInTheDocument();
  });

  it('creates a draft copied from the published version, and deletes it', async () => {
    const { fake } = renderRoute(`/workflows/${FLOW}`, { handlers: api() });

    const versions = await screen.findByRole('table', { name: 'Versiones del flujo' });
    expect(within(versions).getByText('Publicada')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo borrador' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo borrador' });
    expect(within(dialog).getByRole('combobox', { name: 'Empezar desde' })).toHaveDisplayValue('Una copia de la versión publicada (v1)');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Notas/ }), 'Agrega la aprobación del jefe');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear borrador' }));

    await vi.waitFor(() => expect(fake.callsTo(`/workflows/${FLOW}/versions`)[0]?.options.body).toEqual({ fromVersionId: V1, notes: 'Agrega la aprobación del jefe' }));
    expect(await within(versions).findByText('Agrega la aprobación del jefe')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo borrador' })).not.toBeInTheDocument();

    await userEvent.click(within(versions).getByRole('button', { name: 'Eliminar el borrador v2' }));
    const confirm = await screen.findByRole('dialog', { name: 'Eliminar borrador' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Eliminar' }));

    await vi.waitFor(() => expect(fake.callsTo(`/workflows/${FLOW}/versions/${V2}`)[0]?.options.method).toBe('DELETE'));
    await vi.waitFor(() => expect(within(versions).queryByText('Borrador')).not.toBeInTheDocument());
  });

  it('renames and deactivates a workflow, and then says it is inactive', async () => {
    const { fake } = renderRoute(`/workflows/${FLOW}`, { handlers: api() });

    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar flujo' });
    await userEvent.clear(within(dialog).getByRole('textbox', { name: /Nombre/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Pagos de crédito');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Activo/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === `/workflows/${FLOW}` && call.options.method === 'PATCH')?.options.body).toEqual({ name: 'Pagos de crédito', isActive: false }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Pagos de crédito' })).toBeInTheDocument();
    expect(screen.getByText(/Este flujo está inactivo/)).toBeInTheDocument();
  });

  it('warns when nothing is published yet', async () => {
    renderRoute(`/workflows/${FLOW}`, { handlers: api({ versions: [version(V1, 1, 'DRAFT')] }) });

    expect(await screen.findByText(/aún no tiene una versión publicada/)).toBeInTheDocument();
  });

  it('adds a position and a person as observers and removes one', async () => {
    const { fake } = renderRoute(`/workflows/${FLOW}?tab=observers`, { handlers: api() });

    const list = await screen.findByRole('list', { name: 'Observadores del flujo' });
    expect(await within(list).findByText('Analista de cartera')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Agregar observador' }));
    let dialog = await screen.findByRole('dialog', { name: 'Agregar observador' });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Tipo' }), 'Grupo');
    await userEvent.selectOptions(await within(dialog).findByRole('combobox', { name: /Grupo/ }), 'Tesorería');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }));
    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === `/workflows/${FLOW}/observers` && call.options.method === 'POST')?.options.body).toEqual({ participantType: 'GROUP', groupId: GROUP }));
    expect(await within(list).findByText('Tesorería')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Agregar observador' }));
    dialog = await screen.findByRole('dialog', { name: 'Agregar observador' });
    await userEvent.type(within(dialog).getByRole('searchbox', { name: /Buscar persona/ }), 'Olga');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Agregar a Olga Pérez' }));
    await vi.waitFor(() => expect(fake.calls.filter((call) => call.path === `/workflows/${FLOW}/observers` && call.options.method === 'POST')[1]?.options.body).toEqual({ participantType: 'USER', userId: OLGA }));

    await userEvent.click(await within(list).findByRole('button', { name: 'Quitar a Analista de cartera' }));
    await vi.waitFor(() => expect(within(list).queryByText('Analista de cartera')).not.toBeInTheDocument());
  });

  it('only shows a reader what is there, without the actions', async () => {
    renderRoute(`/workflows/${FLOW}`, { handlers: { ...api(), ...reader } });

    expect(await screen.findByRole('table', { name: 'Versiones del flujo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo borrador' })).not.toBeInTheDocument();
  });

  it('says when the workflow is not there', async () => {
    renderRoute(`/workflows/${FLOW}`, {
      handlers: {
        ...api(),
        [`/workflows/${FLOW}`]: () => {
          throw new ApiError({ status: 404, code: 'NOT_FOUND', message: 'x' });
        },
      },
    });

    expect(await screen.findByText('No encontramos este flujo.')).toBeInTheDocument();
  });
});
