import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { at, id, openConsole, page } from './console-test-helpers';

const suppression = (index: number, email: string, reason: 'BOUNCE' | 'COMPLAINT', detail: string | null) => ({ id: id(index), email, reason, detail, events: index, createdAt: at, lastEventAt: at });

describe('platform console: blocked e-mail addresses', () => {
  it('lists the addresses SES blocked, filters them, and removes one after confirming', async () => {
    let items = [suppression(1, 'ana@acme.co', 'BOUNCE', 'Permanent/NoEmail'), suppression(2, 'luis@acme.co', 'COMPLAINT', 'abuse')];
    const { fake } = await openConsole('/platform/email-suppressions', {
      '/platform/email-suppressions': () => page(items),
      [`/platform/email-suppressions/${id(1)}`]: () => {
        items = items.filter((item) => item.id !== id(1));
        return undefined;
      },
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Correos bloqueados' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Direcciones bloqueadas' });
    expect(within(table).getByText('ana@acme.co')).toBeInTheDocument();
    expect(within(table).getByText('Rebote permanente')).toBeInTheDocument();
    expect(within(table).getByText('Queja (marcado como spam)')).toBeInTheDocument();
    expect(within(table).getByText('Permanent/NoEmail')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Buscar dirección'), 'ana');
    await userEvent.selectOptions(screen.getByLabelText('Motivo'), 'BOUNCE');
    await vi.waitFor(() => expect(fake.callsTo('/platform/email-suppressions').some((call) => call.path === '/platform/email-suppressions?page=1&search=ana&reason=BOUNCE')).toBe(true));

    await userEvent.click(within(table).getByRole('button', { name: 'Quitar el bloqueo de ana@acme.co' }));
    const dialog = await screen.findByRole('dialog', { name: 'Quitar el bloqueo' });
    expect(within(dialog).getByText(/La plataforma volverá a escribir a ana@acme.co/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fake.callsTo(`/platform/email-suppressions/${id(1)}`)[0]?.options.method).toBe('DELETE');
    await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Direcciones bloqueadas' })).queryByText('ana@acme.co')).not.toBeInTheDocument());
  });

  it('says when no address is blocked', async () => {
    await openConsole('/platform/email-suppressions', { '/platform/email-suppressions': () => page([]) });
    expect(await screen.findByText('No hay direcciones bloqueadas.')).toBeInTheDocument();
  });
});
