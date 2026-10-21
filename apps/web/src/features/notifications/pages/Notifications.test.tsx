import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const TICKET = id(100);
const ASSIGNED = id(500);
const QUOTA = id(501);
const OLD = id(502);

const notification = (notificationId: string, overrides: Record<string, unknown> = {}) => ({
  id: notificationId,
  type: 'TICKET_ASSIGNED',
  title: 'Te asignaron el ticket T-1042',
  body: 'Confirmación de pago de crédito',
  ticketId: TICKET,
  readAt: null,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...overrides,
});

/** A small inbox of notifications the fake API keeps in memory, so marking them read changes what it answers next. */
function inbox() {
  const items = [
    notification(ASSIGNED),
    notification(QUOTA, { type: 'STORAGE_QUOTA', title: 'El almacenamiento llegó al 80 %', body: 'Usan 8 GB de 10 GB.', ticketId: null }),
    notification(OLD, { type: 'TICKET_CLOSED', title: 'Se cerró el ticket T-1001', readAt: '2026-10-01T15:00:00.000Z', createdAt: '2026-10-01T14:00:00.000Z' }),
  ];
  const read = (notificationId: string) => {
    const index = items.findIndex((item) => item.id === notificationId);
    const item = items[index];
    if (item !== undefined && item.readAt === null) items[index] = { ...item, readAt: new Date().toISOString() };
  };
  const handlers: Record<string, FakeHandler> = {
    '/notifications/unread-count': () => ({ count: items.filter((item) => item.readAt === null).length }),
    '/notifications': (_options, path) => {
      const query = new URLSearchParams(path.split('?')[1]);
      const pageSize = Number(query.get('pageSize'));
      const shown = query.get('unread') === 'true' ? items.filter((item) => item.readAt === null) : items;
      return { items: shown.slice(0, pageSize), page: Number(query.get('page')), pageSize, total: shown.length };
    },
    '/notifications/read-all': () => {
      items.forEach((item) => read(item.id));
      return { updated: 2 };
    },
    [`/notifications/${ASSIGNED}/read`]: () => read(ASSIGNED),
    [`/notifications/${QUOTA}/read`]: () => read(QUOTA),
  };
  return handlers;
}

describe('notifications', () => {
  it('counts the unread ones on the bell and opens a ticket from the panel, marking it read', async () => {
    const { fake, router } = renderRoute('/tickets', { handlers: { ...inbox(), [`/tickets/${TICKET}`]: () => { throw new Error('not needed'); } } });

    const bell = await screen.findByRole('button', { name: 'Notificaciones: 2 sin leer' });
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(bell);

    const panel = await screen.findByRole('region', { name: 'Notificaciones' });
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    const assigned = await within(panel).findByRole('link', { name: 'Sin leer: Te asignaron el ticket T-1042 Confirmación de pago de crédito hace 5 minutos' });
    expect(assigned).toHaveAttribute('href', `/tickets/${TICKET}`);
    expect(within(assigned).getByText('hace 5 minutos')).toBeInTheDocument();
    expect(within(panel).getByText('El almacenamiento llegó al 80 %')).toBeInTheDocument();
    expect(within(panel).queryByRole('link', { name: /almacenamiento/ })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Marcar como leída: Se cerró el ticket T-1001' })).not.toBeInTheDocument();

    await userEvent.click(assigned);

    expect(router.state.location.pathname).toBe(`/tickets/${TICKET}`);
    expect(screen.queryByRole('region', { name: 'Notificaciones' })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(fake.callsTo(`/notifications/${ASSIGNED}/read`)[0]?.options.method).toBe('POST'));
    expect(await screen.findByRole('button', { name: 'Notificaciones: 1 sin leer' })).toBeInTheDocument();
  });

  it('marks one or all as read from the panel, and Escape gives the focus back to the bell', async () => {
    const { fake } = renderRoute('/tickets', { handlers: inbox() });

    await userEvent.click(await screen.findByRole('button', { name: 'Notificaciones: 2 sin leer' }));
    const panel = await screen.findByRole('region', { name: 'Notificaciones' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Marcar como leída: El almacenamiento llegó al 80 %' }));
    expect(await screen.findByRole('button', { name: 'Notificaciones: 1 sin leer' })).toBeInTheDocument();
    expect(fake.callsTo(`/notifications/${QUOTA}/read`)).toHaveLength(1);

    await userEvent.click(within(panel).getByRole('button', { name: 'Marcar todas como leídas' }));
    const bell = await screen.findByRole('button', { name: 'Notificaciones' });
    expect(fake.callsTo('/notifications/read-all')).toHaveLength(1);
    expect(within(panel).queryByRole('button', { name: 'Marcar todas como leídas' })).not.toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Notificaciones' })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });

  it('closes the panel on a click outside it', async () => {
    renderRoute('/tickets', { handlers: inbox() });

    await userEvent.click(await screen.findByRole('button', { name: 'Notificaciones: 2 sin leer' }));
    expect(await screen.findByRole('region', { name: 'Notificaciones' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('main'));

    expect(screen.queryByRole('region', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });

  it('lists every notification on its page, and only the unread ones in their tab', async () => {
    const { fake, router } = renderRoute('/tickets', { handlers: inbox() });

    await userEvent.click(await screen.findByRole('button', { name: 'Notificaciones: 2 sin leer' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Ver todas' }));

    expect(router.state.location.pathname).toBe('/notifications');
    expect(await screen.findByRole('heading', { level: 1, name: 'Notificaciones' })).toBeInTheDocument();
    expect(screen.getByText('2 sin leer')).toBeInTheDocument();
    expect(await screen.findByText('Se cerró el ticket T-1001')).toBeInTheDocument();
    expect(screen.getByText('1 de oct de 2026')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Sin leer/ }));

    expect(router.state.location.search).toBe('?filter=unread');
    await vi.waitFor(() => expect(screen.queryByText('Se cerró el ticket T-1001')).not.toBeInTheDocument());
    expect(fake.calls.some((call) => call.path === '/notifications?page=1&pageSize=25&unread=true')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
    expect(await screen.findByText('No tienes notificaciones sin leer.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar todas como leídas' })).not.toBeInTheDocument();
  });
});
