import type { TicketView } from '@procesabpm/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import { renderRoute } from '@/test/render-route';

interface FakeTicket {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly status: 'OPEN' | 'PAUSED' | 'CLOSED';
  readonly tags?: readonly { id: string; name: string; color: string }[];
  readonly assignees?: readonly { userId: string; name: string; type: string; assignedAt: string }[];
  readonly priority?: { id: string; name: string; color: string | null } | null;
  readonly workflowPriority?: { id: string; name: string; color: string | null } | null;
  readonly filteredValue?: string | number | boolean | null;
}

type View = TicketView;

const ticketId = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const ticket = (index: number, overrides: Partial<FakeTicket> = {}): FakeTicket => ({ id: ticketId(index), number: `T-${1000 + index}`, title: `Solicitud ${index}`, status: 'OPEN', ...overrides });
const many = (count: number) => Array.from({ length: count }, (_, index) => ticket(index + 1));

/** A `/tickets` handler over fixed tickets per view that paginates and filters like the API, recording each query. */
function ticketsApi(byView: Partial<Record<View, readonly FakeTicket[]>>) {
  const queries: URLSearchParams[] = [];
  const handler = (_options: unknown, path: string) => {
    const search = new URLSearchParams(path.split('?')[1]);
    queries.push(search);
    const view = (search.get('view') ?? 'assigned') as View;
    const status = search.get('status');
    const page = Number(search.get('page'));
    const pageSize = Number(search.get('pageSize'));
    const matching = (byView[view] ?? []).filter((item) => status === null || item.status === status);
    const items = matching.slice((page - 1) * pageSize, page * pageSize).map((item) => ({
      companyId: ticketId(900),
      creatorId: ticketId(901),
      subcategoryId: ticketId(902),
      currentStepId: null,
      priorityId: null,
      createdAt: '2026-10-17T15:00:00.000Z',
      closedAt: null,
      tags: [],
      creator: { id: ticketId(901), name: 'Ana Pérez' },
      subcategory: { id: ticketId(902), name: 'Pagos', category: { id: ticketId(903), name: 'Cartera' } },
      currentStep: null,
      priority: null,
      workflowPriority: null,
      lastActivityAt: '2026-10-17T16:00:00.000Z',
      filteredValue: null,
      assignees: [],
      sla: null,
      ...item,
    }));
    return { items, page, pageSize, total: matching.length };
  };
  const counts = (_options: unknown, path: string) => {
    const search = new URLSearchParams(path.split('?')[1]);
    queries.push(search);
    const status = search.get('status');
    const count = (view: View) => (byView[view] ?? []).filter((item) => status === null || item.status === status).length;
    return { assigned: count('assigned'), created: count('created'), observed: count('observed'), all: count('all'), history: count('history'), reopened: count('reopened'), errors_reported: count('errors_reported'), errors_received: count('errors_received') };
  };
  const listQueries = () => queries.filter((search) => search.has('pageSize'));
  return { handler, handlers: { '/tickets': handler, '/tickets/counts': counts }, listQueries, queries };
}

const table = () => screen.findByRole('table', { name: 'Tickets de la bandeja' });
const rowTitles = async () => within(await table()).queryAllByRole('link').map((link) => link.textContent);

describe('TicketInboxPage', () => {
  it('opens on the assigned tickets with the count of every tab', async () => {
    const api = ticketsApi({
      assigned: [
        ticket(1, { title: 'Pago de crédito', assignees: [{ userId: ticketId(950), name: 'Luis Gómez', type: 'PRIMARY', assignedAt: '2026-10-17T15:00:00.000Z' }], priority: { id: ticketId(960), name: 'Alta', color: null }, workflowPriority: { id: ticketId(961), name: 'Media', color: null } }),
        ticket(2, { status: 'PAUSED' }),
      ],
      created: [ticket(3)],
      all: many(5),
    });
    renderRoute('/tickets', { handlers: api.handlers });

    expect(await screen.findByRole('heading', { level: 1, name: 'Tickets' })).toBeInTheDocument();
    expect(await screen.findByText('2 tickets')).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /^Asignados a mí\s*2$/, selected: true })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /^Creados por mí\s*1$/ })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /^Observados\s*0$/ })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /^Todos\s*5$/ })).toBeInTheDocument();

    const rows = within(await table()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    // The columns of the help desk: requester, who holds it, both priorities and the last activity.
    expect(within(rows[0]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['T-1001', 'Pago de crédito', 'Ana Pérez', 'Luis Gómez', 'Abierto', 'Alta', 'Media', '', expect.stringMatching(/^17 de oct de 2026, \d{1,2}:00/)]);
    expect(within(rows[1]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['T-1002', expect.any(String), 'Ana Pérez', 'Sin asignar', 'Pausado', '—', '—', '', expect.any(String)]);
    expect(api.listQueries().at(-1)?.get('sort')).toBe('lastActivity');
    expect(within(await table()).getByRole('columnheader', { name: /Última actualización/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('sorts by a column from its header, turning the order around on a second click, and keeps it in the URL', async () => {
    const api = ticketsApi({ assigned: [ticket(1)] });
    const { router } = renderRoute('/tickets', { handlers: api.handlers });

    await userEvent.click(within(await table()).getByRole('button', { name: /Prioridad flujo/ }));
    await vi.waitFor(() => expect(router.state.location.search).toBe('?sort=workflowPriority&dir=desc'));
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('sort')).toBe('workflowPriority'));
    expect(within(await table()).getByRole('columnheader', { name: /Prioridad flujo/ })).toHaveAttribute('aria-sort', 'descending');
    expect(within(await table()).getByRole('columnheader', { name: /Última actualización/ })).toHaveAttribute('aria-sort', 'none');

    await userEvent.click(within(await table()).getByRole('button', { name: /Prioridad flujo/ }));
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('direction')).toBe('asc'));
    expect(router.state.location.search).toBe('?sort=workflowPriority&dir=asc');
    // The counts of the tabs do not depend on the order.
    expect(api.queries.filter((search) => !search.has('pageSize')).every((search) => !search.has('sort'))).toBe(true);
  });

  it('adds a column with the field the inbox is filtered by, named as its form calls it', async () => {
    const api = ticketsApi({ assigned: [ticket(1, { filteredValue: '2026-03-01' }), ticket(2)] });
    renderRoute('/tickets?field=DUE_ON&op=filled', {
      handlers: { ...api.handlers, '/tickets/filter-fields': () => [{ code: 'DUE_ON', label: 'Fecha de pago', type: 'DATE', options: null }] },
    });

    expect(await within(await table()).findByRole('columnheader', { name: 'Fecha de pago' })).toBeInTheDocument();
    const rows = within(await table()).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getAllByRole('cell')[2]).toHaveTextContent('2026-03-01');
    expect(within(rows[1]!).getAllByRole('cell')[2]).toHaveTextContent('—');
  });

  it('searches and filters by priority and category, sends the same filters to the counts, and clears them', async () => {
    const PRIORITY = ticketId(500);
    const CATEGORY = ticketId(501);
    const api = ticketsApi({ assigned: [ticket(1)] });
    const { router } = renderRoute('/tickets', {
      handlers: {
        ...api.handlers,
        '/priorities': () => ({ items: [{ id: PRIORITY, name: 'Alta', color: '#be123c', sortOrder: 1, isActive: true, isDefault: false, createdAt: '2026-10-17T15:00:00.000Z' }], page: 1, pageSize: 100, total: 1 }),
        '/categories': () => ({ items: [{ id: CATEGORY, name: 'Cartera', description: null, isActive: true, createdAt: '2026-10-17T15:00:00.000Z' }], page: 1, pageSize: 100, total: 1 }),
      },
    });

    await userEvent.type(await screen.findByRole('searchbox', { name: 'Buscar' }), 'crédito');
    await vi.waitFor(() => expect(router.state.location.search).toBe('?q=cr%C3%A9dito'));
    // The router applies a new URL in a transition: the page has it once it asked for the list with it.
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('search')).toBe('crédito'));
    // Also in the messages, and back: it travels in the URL and only with a search.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Buscar también en la descripción y los comentarios' }));
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('searchMessages')).toBe('true'));
    expect(router.state.location.search).toBe('?q=cr%C3%A9dito&msgs=1');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Buscar también en la descripción y los comentarios' }));
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.has('searchMessages')).toBe(false));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Prioridad del usuario' }), 'Alta');
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('priorityId')).toBe(PRIORITY));
    // The workflow's priority is filtered apart from the requester's, as in the help desk.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Prioridad del flujo' }), 'Alta');
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('workflowPriorityId')).toBe(PRIORITY));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Categoría' }), 'Cartera');

    await vi.waitFor(() =>
      expect(api.listQueries().at(-1)?.toString()).toBe(`search=cr%C3%A9dito&priorityId=${PRIORITY}&workflowPriorityId=${PRIORITY}&categoryId=${CATEGORY}&view=assigned&page=1&pageSize=25&sort=lastActivity&direction=desc`),
    );
    expect(api.queries.filter((search) => !search.has('pageSize')).at(-1)?.toString()).toBe(`search=cr%C3%A9dito&priorityId=${PRIORITY}&workflowPriorityId=${PRIORITY}&categoryId=${CATEGORY}`);

    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(router.state.location.search).toBe('');
    expect(screen.getByRole('searchbox', { name: 'Buscar' })).toHaveValue('');
  });

  it('filters by one of my tags, the requester and the creation dates from the folded filters, and opens them from a link', async () => {
    const TAG = ticketId(510);
    const OLGA = ticketId(511);
    const api = ticketsApi({ assigned: [ticket(1)] });
    const { router } = renderRoute('/tickets', {
      handlers: {
        ...api.handlers,
        '/tags': () => [{ id: TAG, name: 'Seguimiento', color: '#4F46E5' }],
        '/members/directory': () => [{ userId: OLGA, firstName: 'Olga', lastName: 'Pérez' }],
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Más filtros' }));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Mi etiqueta' }), 'Seguimiento');
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('tagId')).toBe(TAG));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Solicitante' }), 'olga');
    await userEvent.click(await screen.findByRole('button', { name: 'Filtrar por Solicitante: Olga Pérez' }));
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('creatorId')).toBe(OLGA));
    expect(await screen.findByRole('button', { name: 'Quitar Solicitante: Olga Pérez' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Creado desde'), '2026-10-01');
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('createdFrom')).toBe(new Date(2026, 9, 1).toISOString()));
    await userEvent.type(screen.getByLabelText('Creado hasta'), '2026-10-31');

    // The end date is included: the API gets the start of the next day.
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('createdTo')).toBe(new Date(2026, 10, 1).toISOString()));
    expect(router.state.location.search).toBe(`?requester=${OLGA}&tag=${TAG}&from=2026-10-01&to=2026-10-31`);
  });

  it('filters by the value of a field: a condition fit for its type, typed values applied on Enter', async () => {
    const api = ticketsApi({ assigned: [ticket(1)] });
    const { router } = renderRoute('/tickets', {
      handlers: {
        ...api.handlers,
        '/tickets/filter-fields': () => [
          { code: 'DUE_ON', label: 'Fecha límite de pago', type: 'DATE', options: null },
          { code: 'REFERENCE', label: 'Referencia', type: 'TEXT', options: null },
        ],
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Más filtros' }));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Campo del formulario' }), 'Referencia');
    const condition = screen.getByRole('combobox', { name: 'Condición' });
    expect(within(condition).getAllByRole('option').map((option) => option.textContent)).toEqual(['Elige una condición', 'Contiene', 'Es igual a', 'Tiene valor', 'Sin valor']);
    await userEvent.type(screen.getByRole('textbox', { name: 'Valor' }), 'FAC-1{Enter}');
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('fieldValue')).toBe('FAC-1'));
    expect(api.listQueries().at(-1)?.get('fieldOperator')).toBe('contains');

    // A date field starts on the overdue ones: before the person's today.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Campo del formulario' }), 'Fecha límite de pago');
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('fieldCode')).toBe('DUE_ON'));
    expect(api.listQueries().at(-1)?.get('fieldOperator')).toBe('between');
    expect(api.listQueries().at(-1)?.get('fieldValue')).toBeNull();
    expect(router.state.location.search).toBe('?field=DUE_ON&op=overdue');
  });

  it('opens the folded filters when the link carries one of them', async () => {
    const api = ticketsApi({ assigned: [ticket(1)] });
    renderRoute('/tickets?from=2026-10-01', { handlers: api.handlers });

    expect(await screen.findByLabelText('Creado desde')).toHaveValue('2026-10-01');
    expect(screen.getByRole('button', { name: 'Menos filtros' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps what is typed slowly: a search the URL took halfway does not overwrite the box', async () => {
    const api = ticketsApi({ assigned: [ticket(1)] });
    const { router } = renderRoute('/tickets', { handlers: api.handlers });
    const slow = userEvent.setup({ delay: 350 });

    const box = await screen.findByRole('searchbox', { name: 'Buscar' });
    await slow.type(box, 'pago');
    await vi.waitFor(() => expect(router.state.location.search).toBe('?q=pago'));
    expect(box).toHaveValue('pago');
  });

  it('keeps the tab in the URL and asks the API for that view', async () => {
    const api = ticketsApi({ assigned: [ticket(1)], observed: [ticket(7, { title: 'Compra de papelería' })] });
    const { router } = renderRoute('/tickets', { handlers: api.handlers });

    await userEvent.click(await screen.findByRole('tab', { name: /^Observados/ }));

    expect(router.state.location.search).toBe('?view=observed');
    expect(await screen.findByRole('link', { name: 'Compra de papelería' })).toBeInTheDocument();
    expect(api.listQueries().at(-1)?.get('view')).toBe('observed');
  });

  it('filters by status, counts the tabs with the same filter and says when nothing matches', async () => {
    const api = ticketsApi({ assigned: [ticket(1), ticket(2, { status: 'CLOSED', title: 'Cerrada' })], all: [ticket(1), ticket(2, { status: 'CLOSED' }), ticket(3, { status: 'CLOSED' })] });
    const { router } = renderRoute('/tickets', { handlers: api.handlers });

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Estado' }), 'Cerrado');

    expect(router.state.location.search).toBe('?status=CLOSED');
    expect(await rowTitles()).toEqual(['Cerrada']);
    expect(await screen.findByRole('tab', { name: /^Todos\s*2$/ })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'Pausado');
    expect(await screen.findByRole('cell', { name: 'Ningún ticket coincide con el filtro.' })).toBeInTheDocument();
  });

  it('pages through the tickets and goes back to the first page on another tab', async () => {
    const api = ticketsApi({ assigned: many(30), created: [ticket(99)] });
    const { router } = renderRoute('/tickets', { handlers: api.handlers });

    expect(await screen.findByText('Mostrando 1–25 de 30')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(router.state.location.search).toBe('?page=2');
    expect(await screen.findByText('Mostrando 26–30 de 30')).toBeInTheDocument();
    expect(await rowTitles()).toHaveLength(5);

    await userEvent.click(screen.getByRole('tab', { name: /^Creados por mí/ }));
    expect(router.state.location.search).toBe('?view=created');
  });

  it('opens the ticket from its title or its row, and the new ticket page from the button', async () => {
    const api = ticketsApi({ assigned: [ticket(1, { title: 'Pago de crédito' }), ticket(2)] });
    const notFound = () => {
      throw new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Not found' });
    };
    const { router } = renderRoute('/tickets', { handlers: { '/tickets': api.handler, [`/tickets/${ticketId(2)}`]: notFound } });

    expect(await screen.findByRole('link', { name: 'Nuevo ticket' })).toHaveAttribute('href', '/tickets/new');
    expect(await screen.findByRole('link', { name: 'Pago de crédito' })).toHaveAttribute('href', `/tickets/${ticketId(1)}`);

    await userEvent.click(screen.getByRole('cell', { name: 'T-1002' }));
    expect(router.state.location.pathname).toBe(`/tickets/${ticketId(2)}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'No encontramos este ticket' })).toBeInTheDocument();
  });

  it('says what an empty tab means', async () => {
    renderRoute('/tickets?view=created', { handlers: { '/tickets': ticketsApi({}).handler } });
    expect(await screen.findByRole('cell', { name: 'No has creado tickets.' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Paginación' })).toBeNull();
  });

  it('shows the tags of the ticket and how many more there are', async () => {
    const tags = ['Urgente', 'Cartera', 'Revisar'].map((name, index) => ({ id: ticketId(500 + index), name, color: '#be123c' }));
    renderRoute('/tickets', { handlers: { '/tickets': ticketsApi({ assigned: [ticket(1, { tags })] }).handler } });
    const row = (await screen.findByRole('link', { name: 'Solicitud 1' })).closest('tr')!;
    expect(within(row).getByText('Urgente')).toBeInTheDocument();
    expect(within(row).getByText('Cartera')).toBeInTheDocument();
    expect(within(row).getByText('1 etiqueta más: Revisar')).toBeInTheDocument();
  });

  it('explains a failure and loads again on retry', async () => {
    const api = ticketsApi({ assigned: [ticket(1, { title: 'Pago de crédito' })] });
    let fail = true;
    const handler = (options: unknown, path: string) => {
      if (fail && !path.includes('pageSize=1&')) throw new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req-42' });
      return api.handler(options, path);
    };
    renderRoute('/tickets', { handlers: { '/tickets': handler } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Código de referencia: req-42');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('link', { name: 'Pago de crédito' })).toBeInTheDocument();
  });
});
