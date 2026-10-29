import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { at, id, openConsole, page } from './console-test-helpers';

type Status = 'NEW' | 'CONTACTED' | 'DISCARDED';
const request = (index: number, fullName: string, status: Status, overrides: Record<string, unknown> = {}) => ({
  id: id(index),
  fullName,
  company: 'Distribuidora del Valle',
  email: `${fullName.split(' ')[0]!.toLowerCase()}@valle.co`,
  teamSize: 'FROM_20_TO_100',
  process: 'Anticipos y legalizaciones.\nHoy van por WhatsApp.',
  status,
  handledBy: null as string | null,
  handledAt: null as string | null,
  createdAt: at,
  ...overrides,
});

describe('platform console: demo requests', () => {
  it('shows the new requests first, filters them by status and dates, and marks one contacted from its detail', async () => {
    let items = [request(1, 'Laura Méndez', 'NEW'), request(2, 'Pedro Gil', 'NEW', { process: null })];
    const { fake } = await openConsole('/platform/demo-requests', {
      '/platform/demo-requests': () => page(items),
      [`/platform/demo-requests/${id(1)}/status`]: (options) => {
        const status = (options.body as { status: Status }).status;
        items = items.map((item) => (item.id === id(1) ? { ...item, status, handledBy: 'Root Admin', handledAt: at } : item));
        return items[0];
      },
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Pedidos de demo' })).toBeInTheDocument();
    expect(fake.callsTo('/platform/demo-requests')[0]?.path).toBe('/platform/demo-requests?page=1&status=NEW');
    const table = await screen.findByRole('table', { name: 'Pedidos de demo' });
    expect(within(table).getByText('laura@valle.co')).toBeInTheDocument();
    expect(within(table).getAllByText('20 a 100')).toHaveLength(2);

    await userEvent.selectOptions(screen.getByLabelText('Estado'), '');
    await userEvent.type(screen.getByLabelText('Desde'), '2026-10-01');
    await vi.waitFor(() =>
      expect(fake.callsTo('/platform/demo-requests').some((call) => call.path.startsWith('/platform/demo-requests?page=1&from=') && !call.path.includes('status='))).toBe(true),
    );

    await userEvent.click(within(table).getByRole('button', { name: 'Ver el pedido de Laura Méndez' }));
    const dialog = await screen.findByRole('dialog', { name: 'Laura Méndez · Distribuidora del Valle' });
    expect(within(dialog).getByText(/Anticipos y legalizaciones\.\s+Hoy van por WhatsApp\./)).toBeInTheDocument();
    expect(within(dialog).getByText('Todavía no.')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Escribirle' })).toHaveAttribute('href', 'mailto:laura@valle.co');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Marcar como contactado' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fake.callsTo(`/platform/demo-requests/${id(1)}/status`)[0]?.options).toMatchObject({ method: 'PUT', body: { status: 'CONTACTED' } });

    await userEvent.click(await within(screen.getByRole('table', { name: 'Pedidos de demo' })).findByRole('button', { name: 'Ver el pedido de Laura Méndez' }));
    const again = await screen.findByRole('dialog');
    expect(within(again).getByText(/Contactado por Root Admin/)).toBeInTheDocument();
    expect(within(again).queryByRole('button', { name: 'Marcar como contactado' })).not.toBeInTheDocument();
    expect(within(again).getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
  });

  it('says when no request matches', async () => {
    await openConsole('/platform/demo-requests', { '/platform/demo-requests': () => page([]) });
    expect(await screen.findByText('No hay pedidos con estos filtros.')).toBeInTheDocument();
  });
});
