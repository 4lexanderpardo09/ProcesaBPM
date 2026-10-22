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
}

type View = 'assigned' | 'created' | 'observed' | 'all';

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
    return { assigned: count('assigned'), created: count('created'), observed: count('observed'), all: count('all') };
  };
  const listQueries = () => queries.filter((search) => search.has('pageSize'));
  return { handler, handlers: { '/tickets': handler, '/tickets/counts': counts }, listQueries, queries };
}

const table = () => screen.findByRole('table', { name: 'Tickets de la bandeja' });
const rowTitles = async () => within(await table()).queryAllByRole('link').map((link) => link.textContent);

describe('TicketInboxPage', () => {
  it('opens on the assigned tickets with the count of every tab', async () => {
    const api = ticketsApi({ assigned: [ticket(1, { title: 'Pago de crédito' }), ticket(2, { status: 'PAUSED' })], created: [ticket(3)], all: many(5) });
    renderRoute('/tickets', { handlers: api.handlers });

    expect(await screen.findByRole('heading', { level: 1, name: 'Tickets' })).toBeInTheDocument();
    expect(await screen.findByText('2 tickets')).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /^Asignados a mí\s*2$/, selected: true })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /^Creados por mí\s*1$/ })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /^Observados\s*0$/ })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /^Todos\s*5$/ })).toBeInTheDocument();

    const rows = within(await table()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['T-1001', 'Pago de crédito', 'Abierto', '17 de oct de 2026', '']);
    expect(within(rows[1]!).getByText('Pausado')).toBeInTheDocument();
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
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Prioridad' }), 'Alta');
    await vi.waitFor(() => expect(api.listQueries().at(-1)?.get('priorityId')).toBe(PRIORITY));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Categoría' }), 'Cartera');

    await vi.waitFor(() => expect(api.listQueries().at(-1)?.toString()).toBe(`search=cr%C3%A9dito&priorityId=${PRIORITY}&categoryId=${CATEGORY}&view=assigned&page=1&pageSize=25`));
    expect(api.queries.filter((search) => !search.has('pageSize')).at(-1)?.toString()).toBe(`search=cr%C3%A9dito&priorityId=${PRIORITY}&categoryId=${CATEGORY}`);

    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(router.state.location.search).toBe('');
    expect(screen.getByRole('searchbox', { name: 'Buscar' })).toHaveValue('');
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
