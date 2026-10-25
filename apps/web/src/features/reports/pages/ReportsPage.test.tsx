import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const at = '2026-10-21T15:00:00.000Z';
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 25, total: items.length });

/** The lists behind the filters: one of each. */
const filterHandlers = {
  '/companies': () => page([{ id: id(1), name: 'Arpesod', taxId: null, countryCode: 'CO', currencyCode: 'COP', timeZone: 'America/Bogota', calendarId: null, isDefault: true, isActive: true, createdAt: at }]),
  '/workflows': () => page([{ id: id(2), name: 'Compras' }]),
  '/departments': () => page([{ id: id(3), name: 'Cartera', isActive: true, createdAt: at }]),
  '/sites': () => page([
    { id: id(4), parentId: null, level: 1, name: 'Región Norte', isCentral: false, isActive: true, createdAt: at },
    { id: id(5), parentId: id(4), level: 2, name: 'Barranquilla', isCentral: false, isActive: true, createdAt: at },
  ]),
};

const summary = { timeZones: ['America/Bogota'], created: 42, closed: 30, open: 12, stepOnTimePct: 87.5, responsibleOnTimePct: 90, avgResolutionMin: 150, medianResolutionMin: 90, unmeasuredTickets: 0 };

const siteRow = { siteId: id(5), siteName: 'Barranquilla', tickets: 8, responsibles: 3, delivered: 10, onTime: 7, late: 3, compliancePct: 70, processErrors: 1, otherErrors: 2, errorPct: 30, avgMin: 600 };

const ticket = { id: id(9), number: '1024', title: 'Compra de sillas', status: 'OPEN', workflowName: 'Compras', categoryName: null, subcategoryName: null, currentStepName: 'Aprobación', siteName: 'Barranquilla', creatorName: 'Ana Torres', createdAt: at, closedAt: null };

const queryOf = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

afterEach(() => vi.unstubAllGlobals());

describe('ReportsPage', () => {
  it('opens on the summary of the last 30 days and keeps the filters in the address', async () => {
    const { fake, router } = renderRoute('/reports', { handlers: { ...filterHandlers, '/reports/summary': () => summary } });

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('87,5 %')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
    const first = queryOf(fake.callsTo('/reports/summary')[0]!.path);
    const days = (Date.parse(first.get('to')!) - Date.parse(first.get('from')!)) / 86_400_000 + 1;
    expect(days).toBe(30);

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Flujo' }), 'Compras');
    await vi.waitFor(() => expect(fake.callsTo('/reports/summary').some((call) => queryOf(call.path).get('workflowId') === id(2))).toBe(true));
    expect(router.state.location.search).toContain(`workflowId=${id(2)}`);

    await userEvent.click(screen.getByRole('tab', { name: 'Por sede' }));
    expect(router.state.location.pathname).toBe('/reports/sites');
    expect(router.state.location.search).toContain(`workflowId=${id(2)}`);
  });

  it('groups by the chosen level and lists the tickets behind a site', async () => {
    const { fake } = renderRoute('/reports/sites?from=2026-10-01&to=2026-10-20&level=2', {
      handlers: {
        ...filterHandlers,
        '/reports/sites': () => ({ level: 2, targetPct: 85, rows: [siteRow] }),
        '/reports/tickets': () => page([ticket]),
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Barranquilla' }));
    expect(queryOf(fake.callsTo('/reports/sites')[0]!.path).get('level')).toBe('2');
    expect(screen.getByText('70 % · Bajo la meta')).toBeInTheDocument();

    const dialog = await screen.findByRole('dialog', { name: 'Tickets de Barranquilla' });
    expect(await within(dialog).findByRole('link', { name: 'Abrir el ticket 1024' })).toHaveAttribute('href', `/tickets/${id(9)}`);
    const drill = queryOf(fake.callsTo('/reports/tickets')[0]!.path);
    expect(Object.fromEntries(drill)).toMatchObject({ from: '2026-10-01', to: '2026-10-20', underSiteId: id(5), page: '1' });
  });

  it('downloads the report on screen with its options', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:report'), revokeObjectURL: vi.fn() }));
    const { fake } = renderRoute('/reports/sites?from=2026-10-01&to=2026-10-20&level=2', {
      handlers: { ...filterHandlers, '/reports/sites': () => ({ level: 2, targetPct: 85, rows: [siteRow] }), '/reports/sites/export': () => new Blob(['xlsx']) },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Exportar a Excel' }));
    await vi.waitFor(() => expect(fake.callsTo('/reports/sites/export')).toHaveLength(1));
    const call = fake.callsTo('/reports/sites/export')[0]!;
    expect(call.options.responseType).toBe('blob');
    expect(Object.fromEntries(queryOf(call.path))).toEqual({ from: '2026-10-01', to: '2026-10-20', level: '2' });
  });

  it('says why a period cannot be asked and asks nothing, but still shows the backlog', async () => {
    const { fake } = renderRoute('/reports?from=2026-10-20&to=2026-10-01', {
      handlers: { ...filterHandlers, '/reports/summary': () => summary, '/reports/backlog': () => ({ asOf: at, rows: [] }) },
    });

    expect(await screen.findByText('«Hasta» no puede ser antes de «Desde».')).toBeInTheDocument();
    expect(fake.callsTo('/reports/summary')).toHaveLength(0);

    await userEvent.click(screen.getByRole('tab', { name: 'Abiertos por flujo' }));
    await vi.waitFor(() => expect(fake.callsTo('/reports/backlog')).toHaveLength(1));
    expect(queryOf(fake.callsTo('/reports/backlog')[0]!.path).has('from')).toBe(false);
  });

  it('ranks people as the help desk does: weighted score, colored against the best', async () => {
    const row = (userId: string, name: string, rank: number, weighted: number, classification: string) => ({
      rank, userId, name, delivered: 4, handled: 6, onTime: 4, late: 1, errors: 0, compliance: 4 / 6, quality: 1, score: 76.7, weighted, classification, medianMin: 120,
    });
    const { fake } = renderRoute('/reports/ranking?from=2026-10-01&to=2026-10-20', {
      handlers: { ...filterHandlers, '/reports/ranking': () => ({ minVolume: 1, ranked: [row(id(10), 'Ana Torres', 1, 149.25, 'GREEN'), row(id(11), 'Luis Gómez', 2, 69.31, 'RED')], unranked: [] }) },
    });

    const table = await screen.findByRole('table', { name: 'Ranking' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(within(first!).getByText('Ana Torres')).toBeInTheDocument();
    expect(within(first!).getByText('149,3')).toBeInTheDocument();
    expect(within(first!).getByText('Verde')).toBeInTheDocument();
    expect(within(second!).getByText('Rojo')).toBeInTheDocument();
    expect(queryOf(fake.callsTo('/reports/ranking')[0]!.path).get('minVolume')).toBe('1');
  });

  it('sends a role without reports back home', async () => {
    const { router } = renderRoute('/reports', { handlers: { ...filterHandlers, '/auth/me/permissions': () => ({ permissions: [{ action: 'read', subject: 'Ticket', conditional: false }] }) } });

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
