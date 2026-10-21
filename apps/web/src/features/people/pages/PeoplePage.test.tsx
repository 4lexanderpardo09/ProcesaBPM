import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import { fakeProfile } from '@/test/fake-profile';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const at = '2026-10-21T15:00:00.000Z';
const ME = id(1);
const ADMIN_ROLE = id(50);
const AGENT_ROLE = id(51);
const CUSTOM_ROLE = id(52);
const MAIN = id(60);
const BRANCH = id(61);
const CARTERA = id(70);
const ANALISTA = id(71);
const OWNER = id(80);
const INVITED = id(81);
const GROUP = id(90);

const page = <T,>(items: readonly T[]) => ({ items, page: 1, pageSize: 25, total: items.length });
const role = (roleId: string, name: string, extra: Record<string, unknown> = {}) => ({ id: roleId, name, description: null, systemRole: null, isAdmin: false, isActive: true, createdAt: at, ...extra });
const member = (userId: string, firstName: string, extra: Record<string, unknown> = {}) => ({
  userId,
  email: `${firstName.toLowerCase()}@acme.test`,
  firstName,
  lastName: 'Pérez',
  status: 'ACTIVE',
  isOwner: false,
  roleId: AGENT_ROLE,
  positionId: null,
  departmentId: null,
  siteId: null,
  companyIds: [MAIN],
  joinedAt: at,
  createdAt: at,
  ...extra,
});
const company = (companyId: string, name: string, isDefault: boolean) => ({ id: companyId, name, taxId: null, countryCode: 'CO', currencyCode: 'COP', timeZone: 'America/Bogota', calendarId: null, isDefault, isActive: true, createdAt: at });
const named = (recordId: string, name: string) => ({ id: recordId, name, isActive: true, createdAt: at });
const grant = (action: string, subject: string) => ({ action, subject, conditional: false });

function handlers(extra: Record<string, FakeHandler> = {}): Record<string, FakeHandler> {
  return {
    '/members': () => page([member(OWNER, 'Olga', { isOwner: true, roleId: ADMIN_ROLE, positionId: ANALISTA, departmentId: CARTERA }), member(ME, 'Ana'), member(INVITED, 'Iván', { status: 'INVITED', joinedAt: null, firstName: '', lastName: '', email: 'ivan@acme.test' })]),
    '/roles': () => page([role(ADMIN_ROLE, 'Administrador', { systemRole: 'ADMIN', isAdmin: true }), role(AGENT_ROLE, 'Agente', { systemRole: 'AGENT' }), role(CUSTOM_ROLE, 'Tesorería')]),
    '/departments': () => page([named(CARTERA, 'Cartera')]),
    '/positions': () => page([named(ANALISTA, 'Analista')]),
    '/sites': () => page([]),
    '/companies': () => page([company(MAIN, 'Electrocréditos', true), company(BRANCH, 'Finansueños', false)]),
    '/permissions': () => [
      { subject: 'all', acceptsConditions: false, actions: [{ action: 'manage', description: 'Full access to the tenant' }] },
      { subject: 'Category', acceptsConditions: false, actions: ['create', 'read', 'update', 'delete'].map((action) => ({ action, description: `${action} Category` })) },
      { subject: 'Ticket', acceptsConditions: true, actions: [{ action: 'read_all', description: 'See every ticket' }, { action: 'reassign', description: 'Reassign' }, { action: 'archive', description: 'Archive tickets' }] },
    ],
    [`/roles/${CUSTOM_ROLE}/permissions`]: () => [
      { action: 'read', subject: 'Category', conditions: null },
      { action: 'reassign', subject: 'Ticket', conditions: { companyId: 'x' } },
    ],
    '/groups': () => page([{ id: GROUP, name: 'Tesorería', isActive: true, createdAt: at }]),
    ...extra,
  };
}

const open = (path: string, extra: Record<string, FakeHandler> = {}) => renderRoute(path, { handlers: handlers(extra) });

describe('PeoplePage', () => {
  it('lists the members with their role, position, department and state, and never offers to deactivate the owner or oneself', async () => {
    open('/people');

    const table = await screen.findByRole('table', { name: 'Miembros' });
    const olga = (await within(table).findByText('Olga Pérez')).closest('tr');
    if (olga === null) throw new Error('row expected');
    expect(within(olga).getByText('Propietario')).toBeInTheDocument();
    expect(await within(olga).findByText('Administrador')).toBeInTheDocument();
    expect(await within(olga).findByText('Analista · Cartera')).toBeInTheDocument();
    expect(within(table).getByText('Tú')).toBeInTheDocument();
    expect(within(table).getByText('Invitado')).toBeInTheDocument();
    // A pending invitation comes without names: the e-mail names it.
    expect(within(table).getAllByText('ivan@acme.test')).toHaveLength(2);
    expect(within(table).queryByRole('button', { name: 'Desactivar a Olga Pérez' })).toBeNull();
    expect(within(table).queryByRole('button', { name: 'Desactivar a Ana Pérez' })).toBeNull();
    expect(within(table).getByRole('button', { name: 'Desactivar a ivan@acme.test' })).toBeInTheDocument();
  });

  it('filters by role and state', async () => {
    const { fake } = open('/people');

    const roleFilter = await screen.findByRole('combobox', { name: 'Rol' });
    await userEvent.selectOptions(roleFilter, await within(roleFilter).findByRole('option', { name: 'Tesorería' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'Inactivo');

    await vi.waitFor(() => expect(fake.callsTo('/members').at(-1)?.path).toBe(`/members?page=1&pageSize=25&roleId=${CUSTOM_ROLE}&status=INACTIVE`));
  });

  it('invites a person to the default company, and says when they are already a member', async () => {
    let answer: 'ok' | 'duplicate' = 'duplicate';
    const { fake } = open('/people', {
      '/members/invitations': () => {
        if (answer === 'duplicate') throw new ApiError({ status: 409, code: 'DUPLICATE', message: 'exists' });
        return member(id(82), 'Nora', { status: 'INVITED' });
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Invitar persona' }));
    const dialog = screen.getByRole('dialog', { name: 'Invitar persona' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Invitar persona' }));
    expect(within(dialog).getByRole('textbox', { name: /Correo/ })).toHaveAccessibleDescription('Este dato es obligatorio.');
    expect(within(dialog).getByRole('combobox', { name: /Rol/ })).toHaveAccessibleDescription('Elige el rol.');

    await userEvent.type(within(dialog).getByRole('textbox', { name: /Correo/ }), 'nora@acme.test');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombres/ }), 'Nora');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Apellidos/ }), 'Díaz');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /Rol/ }), 'Tesorería');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Departamento' }), 'Cartera');
    expect(within(dialog).getByRole('checkbox', { name: 'Electrocréditos' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Finansueños' })).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Invitar persona' }));

    expect(await within(dialog).findByText('Esa persona ya es miembro de la organización.')).toBeInTheDocument();
    expect(fake.callsTo('/members/invitations')[0]?.options.body).toEqual({ email: 'nora@acme.test', firstName: 'Nora', lastName: 'Díaz', roleId: CUSTOM_ROLE, departmentId: CARTERA, companyIds: [MAIN] });

    answer = 'ok';
    await userEvent.click(within(dialog).getByRole('button', { name: 'Invitar persona' }));
    expect(await screen.findByText('Se envió la invitación a nora@acme.test. Entra con el enlace del correo.')).toBeInTheDocument();
  });

  it('edits a member: another role, no department and one more company', async () => {
    const { fake } = open('/people', { [`/members/${OWNER}`]: () => member(OWNER, 'Olga') });

    await userEvent.click(await screen.findByRole('button', { name: 'Editar a Olga Pérez' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar miembro' });
    expect(within(dialog).getByText('Olga Pérez · olga@acme.test')).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /Rol/ }), 'Agente');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Departamento' }), 'Ninguno');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Finansueños' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() =>
      expect(fake.callsTo(`/members/${OWNER}`)[0]?.options).toMatchObject({ method: 'PATCH', body: { roleId: AGENT_ROLE, positionId: ANALISTA, departmentId: null, siteId: null, companyIds: [MAIN, BRANCH] } }),
    );
  });

  it('sends an invitation again and deactivates a member', async () => {
    const { fake } = open('/people', {
      [`/members/${INVITED}/resend-invitation`]: () => member(INVITED, 'Iván', { status: 'INVITED', firstName: '', lastName: '', email: 'ivan@acme.test' }),
      [`/members/${INVITED}/deactivate`]: () => member(INVITED, 'Iván', { status: 'INACTIVE', firstName: '', lastName: '', email: 'ivan@acme.test' }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Reenviar la invitación a ivan@acme.test' }));
    expect(await screen.findByText('Se envió de nuevo la invitación a ivan@acme.test.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar a ivan@acme.test' }));

    await vi.waitFor(() => expect(fake.callsTo(`/members/${INVITED}/deactivate`)[0]?.options.method).toBe('POST'));
  });

  it('edits the permissions of a role in Spanish, keeping the conditions of the ones it had', async () => {
    const { fake } = open('/people?tab=roles', { [`/roles/${CUSTOM_ROLE}/permissions`]: (options) => (options.method === 'PUT' ? [] : handlers()[`/roles/${CUSTOM_ROLE}/permissions`]?.(options, '')) });

    const table = await screen.findByRole('table', { name: 'Roles' });
    await userEvent.click(await within(table).findByRole('button', { name: 'Permisos de Tesorería' }));
    const tickets = await screen.findByRole('group', { name: 'Tickets' });
    expect(within(tickets).getByRole('checkbox', { name: 'Ver todos' })).not.toBeChecked();
    expect(within(tickets).getByRole('checkbox', { name: 'Reasignar' })).toBeChecked();
    expect(within(tickets).getByText('con condiciones')).toBeInTheDocument();
    expect(within(tickets).getByRole('checkbox', { name: 'Archive tickets' })).toBeInTheDocument();
    expect(screen.getAllByRole('group').map((group) => group.querySelector('legend')?.textContent).filter((name) => name !== undefined)).toEqual(['Tickets', 'Categorías']);
    expect(screen.getByRole('button', { name: 'Guardar permisos' })).toBeDisabled();

    await userEvent.click(within(screen.getByRole('group', { name: 'Categorías' })).getByRole('checkbox', { name: 'Crear' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar permisos' }));

    await vi.waitFor(() =>
      expect(fake.callsTo(`/roles/${CUSTOM_ROLE}/permissions`).find((call) => call.options.method === 'PUT')?.options.body).toEqual({
        permissions: [
          { action: 'read', subject: 'Category' },
          { action: 'reassign', subject: 'Ticket', conditions: { companyId: 'x' } },
          { action: 'create', subject: 'Category' },
        ],
      }),
    );
  });

  it('says when a permission cannot be given, and an administrator role has every permission', async () => {
    open('/people?tab=roles', {
      [`/roles/${CUSTOM_ROLE}/permissions`]: (options) => {
        if (options.method === 'PUT') throw new ApiError({ status: 403, code: 'PERMISSION_DENIED', message: 'no' });
        return [];
      },
    });

    const table = await screen.findByRole('table', { name: 'Roles' });
    await userEvent.click(await within(table).findByRole('button', { name: 'Permisos de Tesorería' }));
    await userEvent.click(within(await screen.findByRole('group', { name: 'Tickets' })).getByRole('checkbox', { name: 'Ver todos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar permisos' }));
    expect(await screen.findByText(/No puedes dar permisos que tu rol no tiene/)).toBeInTheDocument();

    await userEvent.click(within(table).getByRole('button', { name: 'Permisos de Administrador' }));
    expect(await screen.findByText(/Es un rol de administrador: puede hacer todo/)).toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: 'Eliminar el rol Administrador' })).toBeNull();
  });

  it('refuses to delete a role that still has members', async () => {
    open('/people?tab=roles', {
      [`/roles/${CUSTOM_ROLE}`]: () => {
        throw new ApiError({ status: 422, code: 'INVALID_STATE', message: 'members' });
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar el rol Tesorería' }));
    const dialog = screen.getByRole('dialog', { name: 'Eliminar el rol «Tesorería»' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }));

    expect(await within(dialog).findByText('No se puede: es un rol base o todavía tiene miembros.')).toBeInTheDocument();
  });

  it('offers to make a role an administrator one only to an administrator', async () => {
    const adminProfile: FakeHandler = (options) => {
      const profile = fakeProfile(options.headers?.Authorization);
      return { ...profile, membership: { ...profile.membership, role: { ...profile.membership.role, isAdmin: true } } };
    };
    const { fake } = open('/people?tab=roles', { '/auth/me': adminProfile });

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo rol' }));
    const dialog = screen.getByRole('dialog', { name: 'Nuevo rol' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Auditor');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Es de administrador/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === '/roles' && call.options.method === 'POST')?.options.body).toEqual({ name: 'Auditor', isAdmin: true }));
  });

  it('shows who is in a group, removes one and adds another found by name', async () => {
    const { fake } = open('/people?tab=groups', {
      [`/groups/${GROUP}/members`]: (options) => (options.method === 'POST' ? { userIds: [OWNER, INVITED] } : { userIds: [OWNER] }),
      [`/groups/${GROUP}/members/${OWNER}`]: () => undefined,
      [`/members/${OWNER}`]: () => member(OWNER, 'Olga'),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Integrantes de Tesorería' }));
    const dialog = screen.getByRole('dialog', { name: 'Integrantes de «Tesorería»' });
    expect(await within(dialog).findByText('Olga Pérez')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole('searchbox', { name: /Buscar persona/ }), 'Iv');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Agregar a ivan@acme.test' }));
    await vi.waitFor(() => expect(fake.callsTo(`/groups/${GROUP}/members`).find((call) => call.options.method === 'POST')?.options.body).toEqual({ userId: INVITED }));
    expect(fake.callsTo('/members').some((call) => call.path.includes('search=Iv') && call.path.includes('status=ACTIVE'))).toBe(true);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar a Olga Pérez' }));
    await vi.waitFor(() => expect(fake.callsTo(`/groups/${GROUP}/members/${OWNER}`)[0]?.options.method).toBe('DELETE'));
  });

  it('shows only the tabs the role can read', async () => {
    open('/people', { '/auth/me/permissions': () => ({ permissions: [grant('read', 'Group')] }) });

    expect(await screen.findByRole('table', { name: 'Grupos' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Grupos']);
    expect(screen.queryByRole('button', { name: 'Nuevo grupo' })).toBeNull();
  });
});
