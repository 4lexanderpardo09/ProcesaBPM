import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const at = '2026-10-21T15:00:00.000Z';
const BOSS = id(100);
const MANAGEMENT = id(101);
const MAIN = id(60);
const GROUP = id(110);
const OLGA = id(80);
const LUIS = id(81);
const NORA = id(82);

const page = <T,>(items: readonly T[]) => ({ items, page: 1, pageSize: 25, total: items.length });
const member = (userId: string, firstName: string) => ({
  userId,
  email: `${firstName.toLowerCase()}@acme.test`,
  firstName,
  lastName: 'Pérez',
  status: 'ACTIVE',
  isOwner: false,
  roleId: id(51),
  positionId: null,
  departmentId: null,
  siteId: null,
  companyIds: [MAIN],
  joinedAt: at,
  createdAt: at,
});
const PEOPLE = { [OLGA]: member(OLGA, 'Olga'), [LUIS]: member(LUIS, 'Luis'), [NORA]: member(NORA, 'Nora') };
const grant = (action: string, subject: string) => ({ action, subject, conditional: false });

function handlers(extra: Record<string, FakeHandler> = {}): Record<string, FakeHandler> {
  return {
    '/approval-group-types': () => page([
      { id: BOSS, name: 'Jefe inmediato', isDefault: true, createdAt: at },
      { id: MANAGEMENT, name: 'Gerencia', isDefault: false, createdAt: at },
    ]),
    '/companies': () => page([{ id: MAIN, name: 'Electrocréditos', taxId: null, countryCode: 'CO', currencyCode: 'COP', timeZone: 'America/Bogota', calendarId: null, isDefault: true, isActive: true, createdAt: at }]),
    '/approval-groups': () => page([{ id: GROUP, typeId: BOSS, companyId: null, name: 'Jefes de Cartera', isActive: true, createdAt: at }]),
    [`/approval-groups/${GROUP}/approvers`]: () => ({ approvers: [{ userId: OLGA, position: 1 }, { userId: LUIS, position: 2 }] }),
    [`/approval-groups/${GROUP}/members`]: () => ({ userIds: [NORA] }),
    '/members': () => page(Object.values(PEOPLE)),
    ...Object.fromEntries(Object.entries(PEOPLE).map(([userId, person]) => [`/members/${userId}`, () => person])),
    '/delegations': () => page([
      { id: id(120), fromUserId: OLGA, toUserId: LUIS, startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2099-01-01T00:00:00.000Z', reason: 'Vacaciones', createdAt: at },
      { id: id(121), fromUserId: NORA, toUserId: OLGA, startsAt: '2098-01-01T00:00:00.000Z', endsAt: '2099-01-01T00:00:00.000Z', reason: null, createdAt: at },
    ]),
    ...extra,
  };
}

const open = (path: string, extra: Record<string, FakeHandler> = {}) => renderRoute(path, { handlers: handlers(extra) });

describe('approval groups', () => {
  it('lists the types and the groups with their type and companies', async () => {
    open('/people?tab=approvals');

    const types = await screen.findByRole('list', { name: 'Tipos de aprobación' });
    expect(await within(types).findByText('Predeterminado')).toBeInTheDocument();
    expect(within(types).queryByRole('button', { name: 'Eliminar el tipo Jefe inmediato' })).toBeNull();
    const row = (await within(await screen.findByRole('table', { name: 'Grupos de aprobación' })).findByText('Jefes de Cartera')).closest('tr');
    if (row === null) throw new Error('row expected');
    expect(within(row).getByText('Jefe inmediato')).toBeInTheDocument();
    expect(within(row).getByText('Todas las empresas')).toBeInTheDocument();
  });

  it('creates a group of the default type for every company', async () => {
    const { fake } = open('/people?tab=approvals');

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo grupo de aprobación' }));
    const dialog = screen.getByRole('dialog', { name: 'Nuevo grupo de aprobación' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Gerentes');
    await vi.waitFor(() => expect(within(dialog).getByRole('combobox', { name: /Tipo/ })).toHaveValue(BOSS));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === '/approval-groups' && call.options.method === 'POST')?.options.body).toEqual({ name: 'Gerentes', typeId: BOSS }));
  });

  it('reorders the approvers and saves them together, and says when a member is in another group', async () => {
    const { fake } = open('/people?tab=approvals', {
      [`/approval-groups/${GROUP}/approvers`]: (options) => (options.method === 'PUT' ? { approvers: [] } : { approvers: [{ userId: OLGA, position: 1 }, { userId: LUIS, position: 2 }] }),
      [`/approval-groups/${GROUP}/members`]: (options) => {
        if (options.method === 'POST') throw new ApiError({ status: 409, code: 'DUPLICATE', message: 'other group' });
        return { userIds: [NORA] };
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Aprobadores y miembros de Jefes de Cartera' }));
    const dialog = screen.getByRole('dialog', { name: 'Aprobadores y miembros de «Jefes de Cartera»' });
    const approvers = await within(dialog).findByRole('list', { name: 'Aprobadores' });
    await within(approvers).findByText('Olga Pérez');
    expect(within(approvers).getAllByRole('listitem').map((item) => item.firstChild?.textContent)).toEqual(['Olga PérezPrincipal', 'Luis PérezSuplente 1']);
    expect(within(dialog).getByText('Tipo «Jefe inmediato», Todas las empresas.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Guardar aprobadores' })).toBeDisabled();

    await userEvent.click(within(approvers).getByRole('button', { name: 'Subir a Luis Pérez' }));
    expect(within(approvers).getAllByRole('listitem').map((item) => item.firstChild?.textContent)).toEqual(['Luis PérezPrincipal', 'Olga PérezSuplente 1']);
    await userEvent.type(within(dialog).getByRole('searchbox', { name: /Buscar aprobador/ }), 'Nora');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Agregar a Nora Pérez como aprobador' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar aprobadores' }));
    await vi.waitFor(() => expect(fake.callsTo(`/approval-groups/${GROUP}/approvers`).find((call) => call.options.method === 'PUT')?.options.body).toEqual({ userIds: [LUIS, OLGA, NORA] }));

    expect(within(within(dialog).getByRole('list', { name: 'Miembros' })).getByText('Nora Pérez')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('searchbox', { name: /Buscar miembro/ }), 'Luis');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Agregar a Luis Pérez como miembro' }));
    expect(await within(dialog).findByText(/ya es miembro de otro grupo de este tipo y empresa/)).toBeInTheDocument();
  });

  it('checks who would approve a person, with how it searched', async () => {
    const { fake } = open('/people?tab=approvals', {
      '/members/directory': () => [
        { userId: NORA, firstName: 'Nora', lastName: 'Pérez' },
        { userId: OLGA, firstName: 'Olga', lastName: 'Pérez' },
      ],
      '/approvals/resolve': () => ({
        found: true,
        approverId: OLGA,
        onBehalfOfId: null,
        level: 1,
        groupId: GROUP,
        scope: 'GENERAL',
        chain: [{ level: 1, subjectId: NORA, groupsTried: [{ groupId: GROUP, scope: 'GENERAL', skipped: [] }], resolved: { approverId: OLGA, onBehalfOfId: null, groupId: GROUP, scope: 'GENERAL' } }],
      }),
    });

    const card = await screen.findByRole('heading', { name: 'Probar quién aprueba' });
    const region = card.closest('section')!;
    await userEvent.type(within(region).getByRole('searchbox', { name: /Persona que hace la solicitud/ }), 'nora');
    await userEvent.click(await within(region).findByRole('button', { name: 'Probar con Nora Pérez' }));
    await userEvent.selectOptions(within(region).getByRole('combobox', { name: 'Tipo' }), 'Jefe inmediato');
    await userEvent.selectOptions(within(region).getByRole('combobox', { name: 'Empresa' }), 'Electrocréditos');
    await userEvent.click(within(region).getByRole('button', { name: 'Probar' }));

    expect(await within(region).findByText('Aprueba Olga Pérez.')).toBeInTheDocument();
    expect(within(region).getByText('Nivel 1: el aprobador de Nora Pérez')).toBeInTheDocument();
    expect(fake.callsTo('/approvals/resolve')[0]?.path).toBe(`/approvals/resolve?userId=${NORA}&typeId=${BOSS}&companyId=${MAIN}&level=1`);
  });

  it('refuses to delete a type still in use', async () => {
    open('/people?tab=approvals', {
      [`/approval-group-types/${MANAGEMENT}`]: () => {
        throw new ApiError({ status: 422, code: 'INVALID_STATE', message: 'in use' });
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar el tipo Gerencia' }));
    expect(await screen.findByText(/es el tipo predeterminado o lo usa un grupo/)).toBeInTheDocument();
  });
});

describe('delegations', () => {
  it('lists who delegates to whom, with its state, and ends one in force', async () => {
    const { fake } = open('/people?tab=delegations', { [`/delegations/${id(120)}/cancel`]: () => ({}) });

    const table = await screen.findByRole('table', { name: 'Delegaciones' });
    await within(table).findAllByText('Olga Pérez');
    await within(table).findByText('Nora Pérez');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell').slice(0, 2).map((cell) => cell.textContent))).toEqual([
      ['Olga Pérez', 'Luis Pérez'],
      ['Nora Pérez', 'Olga Pérez'],
    ]);
    expect(within(table).getByText('Vigente')).toBeInTheDocument();
    expect(within(table).getByText('Programada')).toBeInTheDocument();
    expect(fake.callsTo('/delegations')[0]?.path).toBe('/delegations?page=1&pageSize=25&current=true');

    await userEvent.click(within(table).getByRole('button', { name: 'Cancelar la delegación de Olga Pérez a Luis Pérez' }));
    await vi.waitFor(() => expect(fake.callsTo(`/delegations/${id(120)}/cancel`)[0]?.options.method).toBe('POST'));
  });

  it('creates a delegation between two people, and says when it overlaps another', async () => {
    const { fake } = open('/people?tab=delegations', {
      '/delegations': (options) => {
        if (options.method === 'POST') throw new ApiError({ status: 409, code: 'OVERLAP', message: 'overlap' });
        return page([]);
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Nueva delegación' }));
    const dialog = screen.getByRole('dialog', { name: 'Nueva delegación' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear delegación' }));
    expect(within(dialog).getByText('Elige a quien delega y a quien la reemplaza.')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole('searchbox', { name: /Buscar a quien delega/ }), 'Olga');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Elegir a Olga Pérez como quien delega' }));
    await userEvent.type(within(dialog).getByRole('searchbox', { name: /Buscar a quien la reemplaza/ }), 'Luis');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Elegir a Luis Pérez como reemplazo' }));
    const starts = within(dialog).getByLabelText(/Desde/);
    await userEvent.clear(starts);
    await userEvent.type(starts, '2026-12-20T08:00');
    await userEvent.type(within(dialog).getByLabelText(/Hasta/), '2026-12-10T08:00');
    expect(within(dialog).getByLabelText(/Hasta/)).toHaveAccessibleDescription('Debe terminar después de empezar.');
    await userEvent.clear(within(dialog).getByLabelText(/Hasta/));
    await userEvent.type(within(dialog).getByLabelText(/Hasta/), '2027-01-10T18:00');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Motivo' }), 'Vacaciones');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear delegación' }));

    expect(await within(dialog).findByText(/Se cruza con otra delegación/)).toBeInTheDocument();
    expect(fake.calls.find((call) => call.path === '/delegations' && call.options.method === 'POST')?.options.body).toEqual({
      fromUserId: OLGA,
      toUserId: LUIS,
      startsAt: new Date('2026-12-20T08:00').toISOString(),
      endsAt: new Date('2027-01-10T18:00').toISOString(),
      reason: 'Vacaciones',
    });
  });

  it('is a tab only for whoever manages delegations', async () => {
    open('/people', { '/auth/me/permissions': () => ({ permissions: [grant('read', 'ApprovalGroup')] }) });

    expect(await screen.findByRole('table', { name: 'Grupos de aprobación' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Aprobaciones']);
    expect(screen.queryByRole('button', { name: 'Nuevo grupo de aprobación' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nuevo tipo' })).toBeNull();
  });
});
