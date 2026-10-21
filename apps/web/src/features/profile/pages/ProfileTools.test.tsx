import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const ME = id(1);
const OLGA = id(80);
const LUIS = id(81);
const at = '2026-10-21T15:00:00.000Z';
const person = (userId: string, firstName: string) => ({ userId, firstName, lastName: 'Pérez' });
const DIRECTORY = [person(OLGA, 'Olga'), person(LUIS, 'Luis')];

const directory: FakeHandler = (_options, path) => {
  const query = new URLSearchParams(path.split('?')[1]);
  const ids = query.get('ids')?.split(',');
  if (ids !== undefined) return DIRECTORY.filter((candidate) => ids.includes(candidate.userId));
  const search = (query.get('search') ?? '').toLowerCase();
  return DIRECTORY.filter((candidate) => candidate.firstName.toLowerCase().includes(search));
};

const open = (path: string, extra: Record<string, FakeHandler> = {}) => renderRoute(path, { handlers: { '/members/directory': directory, ...extra } });

describe('profile tools', () => {
  it('saves each notification channel at once, and puts it back when the API refuses', async () => {
    let refuse = false;
    const { fake } = open('/profile?tab=notifications', {
      '/notifications/preferences': () => [{ type: 'TICKET_ASSIGNED', inApp: true, email: false }],
      '/notifications/preferences/TICKET_ASSIGNED': (options) => {
        if (refuse) throw new ApiError({ status: 500, code: 'INTERNAL', message: 'x' });
        return { type: 'TICKET_ASSIGNED', ...(options.body as object) };
      },
      '/notifications/preferences/SLA_OVERDUE': () => {
        refuse = true;
        throw new ApiError({ status: 500, code: 'INTERNAL', message: 'x' });
      },
    });

    const email = await screen.findByRole('checkbox', { name: 'Te asignaron un ticket: por correo' });
    expect(screen.getByRole('checkbox', { name: 'Te asignaron un ticket: en la app' })).toBeChecked();
    await userEvent.click(email);
    await vi.waitFor(() => expect(fake.callsTo('/notifications/preferences/TICKET_ASSIGNED')[0]?.options).toMatchObject({ method: 'PUT', body: { inApp: true, email: true } }));
    expect(email).toBeChecked();

    const overdue = screen.getByRole('checkbox', { name: 'Un ticket se venció: por correo' });
    await userEvent.click(overdue);
    await vi.waitFor(() => expect(overdue).not.toBeChecked());
  });

  it('creates a colored tag and deletes another', async () => {
    const { fake } = open('/profile?tab=tags', {
      '/tags': (options) => (options.method === 'POST' ? { id: id(30), name: 'Urgente', color: '#0369a1' } : [{ id: id(31), name: 'Revisar', color: '#be123c' }]),
      [`/tags/${id(31)}`]: () => undefined,
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Nueva etiqueta' }));
    const dialog = screen.getByRole('dialog', { name: 'Nueva etiqueta' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Urgente');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === '/tags' && call.options.method === 'POST')?.options.body).toEqual({ name: 'Urgente', color: '#0369a1' }));

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar la etiqueta Revisar' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Eliminar la etiqueta «Revisar»' })).getByRole('button', { name: 'Eliminar' }));
    await vi.waitFor(() => expect(fake.callsTo(`/tags/${id(31)}`)[0]?.options.method).toBe('DELETE'));
  });

  it('writes a template as text, edits it back as text, and only the own ones can be changed', async () => {
    const own = { id: id(40), title: 'Recibido', bodyHtml: '<p>Recibimos tu solicitud.</p><p>Gracias</p>', isOwner: true, ownerId: ME, ownerName: 'Ana Torres', updatedAt: at };
    const shared = { id: id(41), title: 'Cierre', bodyHtml: '<p>Cerramos el caso.</p>', isOwner: false, ownerId: OLGA, ownerName: 'Olga Pérez', updatedAt: at };
    const { fake } = open('/profile?tab=templates', {
      '/text-templates': (options) => (options.method === 'POST' ? { ...own, id: id(42) } : [own, shared]),
      [`/text-templates/${id(40)}`]: () => own,
    });

    expect(await screen.findByText('Compartida por Olga Pérez')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar la plantilla Cierre' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Nueva plantilla' }));
    const create = screen.getByRole('dialog', { name: 'Nueva plantilla' });
    await userEvent.type(within(create).getByRole('textbox', { name: /Título/ }), 'Pendiente');
    await userEvent.type(within(create).getByRole('textbox', { name: /Texto/ }), 'Falta un soporte <pdf>.{enter}{enter}Gracias');
    await userEvent.click(within(create).getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === '/text-templates' && call.options.method === 'POST')?.options.body).toEqual({ title: 'Pendiente', bodyHtml: '<p>Falta un soporte &lt;pdf&gt;.</p><p>Gracias</p>' }));

    await userEvent.click(screen.getByRole('button', { name: 'Editar la plantilla Recibido' }));
    expect(within(screen.getByRole('dialog', { name: 'Editar plantilla' })).getByRole('textbox', { name: /Texto/ })).toHaveValue('Recibimos tu solicitud.\n\nGracias');
  });

  it('shares a template with a colleague found by name', async () => {
    const own = { id: id(40), title: 'Recibido', bodyHtml: '<p>Hola</p>', isOwner: true, ownerId: ME, ownerName: 'Ana Torres', updatedAt: at };
    let shares = [OLGA];
    const { fake } = open('/profile?tab=templates', {
      '/text-templates': () => [own],
      [`/text-templates/${id(40)}/shares`]: (options) => {
        if (options.method === 'PUT') shares = (options.body as { userIds: string[] }).userIds;
        return shares;
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Compartir la plantilla Recibido' }));
    const dialog = screen.getByRole('dialog', { name: 'Compartir «Recibido»' });
    expect(await within(within(dialog).getByRole('list', { name: 'Compartida con' })).findByText('Olga Pérez')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('searchbox', { name: /Buscar con quién compartir/ }), 'lu');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Compartir con Luis Pérez' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.callsTo(`/text-templates/${id(40)}/shares`).find((call) => call.options.method === 'PUT')?.options.body).toEqual({ userIds: [OLGA, LUIS] }));

    // Opened again, it shows what was saved.
    await userEvent.click(screen.getByRole('button', { name: 'Compartir la plantilla Recibido' }));
    expect(await within(screen.getByRole('list', { name: 'Compartida con' })).findByText('Luis Pérez')).toBeInTheDocument();
  });

  it('lists the delegations given and received, and delegates to a colleague', async () => {
    const given = { id: id(50), fromUserId: ME, toUserId: OLGA, startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2099-01-01T00:00:00.000Z', reason: 'Vacaciones', createdAt: at };
    const received = { id: id(51), fromUserId: LUIS, toUserId: ME, startsAt: '2098-01-01T00:00:00.000Z', endsAt: '2099-01-01T00:00:00.000Z', reason: null, createdAt: at };
    const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 100, total: items.length });
    const { fake } = open('/profile?tab=delegations', {
      '/delegations': (options, path) => {
        if (options.method === 'POST') throw new ApiError({ status: 409, code: 'OVERLAP', message: 'overlap' });
        return path.includes('fromUserId') ? page([given]) : page([received]);
      },
    });

    const givenList = await screen.findByRole('list', { name: 'Las que diste' });
    expect(await within(givenList).findByText(/A Olga Pérez/)).toBeInTheDocument();
    expect(within(givenList).getByText('Vigente')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Las que recibiste' })).getByText('Programada')).toBeInTheDocument();
    expect(await screen.findByText(/De Luis Pérez/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delegar' }));
    const dialog = screen.getByRole('dialog', { name: 'Delegar' });
    await userEvent.type(within(dialog).getByRole('searchbox', { name: /Buscar quién te reemplaza/ }), 'lu');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Elegir a Luis Pérez' }));
    await userEvent.type(within(dialog).getByLabelText(/Hasta/), '2099-02-01T18:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear delegación' }));

    expect(await within(dialog).findByText(/Se cruza con otra delegación tuya/)).toBeInTheDocument();
    const body = fake.calls.find((call) => call.path === '/delegations' && call.options.method === 'POST')?.options.body;
    expect(body).toMatchObject({ toUserId: LUIS, endsAt: new Date('2099-02-01T18:00').toISOString() });
    expect(body).not.toHaveProperty('fromUserId');
  });
});
