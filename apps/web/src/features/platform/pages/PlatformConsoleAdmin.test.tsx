import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import { at, id, openConsole, plans } from './console-test-helpers';

const admin = { userId: id(70), email: 'root@example.com', firstName: 'Rita', lastName: 'Gil', status: 'ACTIVE', mfaEnabled: true, lastLoginAt: at, createdAt: at };
const account = { id: id(80), firstName: 'Ana', lastName: 'Pérez', status: 'ACTIVE', mfaEnabled: true, isPlatformAdmin: false, memberships: [{ tenantId: id(1), tenantName: 'Acme', status: 'ACTIVE', isOwner: true }] };

describe('platform console: plans, administrators and accounts', () => {
  it('edits a plan in GB and MB and sends only what changed', async () => {
    const { fake } = await openConsole('/platform/plans', { '/platform/plans/basic': (options) => ({ ...plans[0], ...(options.body as object) }) });

    const table = await screen.findByRole('table', { name: 'Planes' });
    expect(await within(table).findByText('1 GB + 0 MB por usuario')).toBeInTheDocument();
    expect(within(table).getByText('Sin límite')).toBeInTheDocument();
    await userEvent.click(within(table).getByRole('button', { name: 'Editar el plan Básico' }));
    const dialog = await screen.findByRole('dialog', { name: 'Plan Básico' });
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Almacenamiento base (GB)' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Almacenamiento base (GB)' }), '2,5');
    await userEvent.clear(within(dialog).getByRole('textbox', { name: /Usuarios/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.callsTo('/platform/plans/basic')[0]?.options.body).toEqual({ storageBaseBytes: String(2.5 * 1024 ** 3), maxUsers: null }));
  });

  it('invites an administrator and removes one', async () => {
    const { fake } = await openConsole('/platform/admins', {
      '/platform/admins': (options) => (options.method === 'POST' ? { ...admin, userId: id(71), email: 'nuevo@example.com' } : [admin]),
      [`/platform/admins/${id(70)}`]: () => undefined,
    });

    const table = await screen.findByRole('table', { name: 'Administradores' });
    expect(await within(table).findByText('Rita Gil')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Invitar administrador' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invitar administrador' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Correo/ }), 'nuevo@example.com');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Nombre/ }), 'Nora');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Apellido/ }), 'Díaz');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar invitación' }));
    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === '/platform/admins' && call.options.method === 'POST')?.options.body).toEqual({ email: 'nuevo@example.com', firstName: 'Nora', lastName: 'Díaz' }));

    await userEvent.click(within(table).getByRole('button', { name: 'Quitar a Rita Gil' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Quitar administrador' })).getByRole('button', { name: 'Quitar' }));
    await vi.waitFor(() => expect(fake.callsTo(`/platform/admins/${id(70)}`)[0]?.options.method).toBe('DELETE'));
  });

  it('finds an account by its exact e-mail and resets its MFA with the verification recorded', async () => {
    const { fake } = await openConsole('/platform/accounts', {
      '/platform/users': () => account,
      [`/platform/users/${id(80)}/mfa-reset`]: () => ({ resetAt: at, revokedSessions: 2 }),
    });

    await userEvent.type(await screen.findByRole('textbox', { name: /^Correo de la cuenta/ }), 'ana@acme.test');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByRole('heading', { name: 'Ana Pérez' })).toBeInTheDocument();
    expect(fake.callsTo('/platform/users')[0]?.path).toBe('/platform/users?email=ana%40acme.test');
    expect(within(screen.getByRole('list', { name: 'Organizaciones de la cuenta' })).getByText('Acme · Activa · propietaria')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reiniciar la verificación en dos pasos' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reiniciar el MFA de Ana Pérez' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Motivo/ }), 'corto');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reiniciar la verificación en dos pasos' }));
    expect(within(dialog).getByText('Escribe entre 10 y 500 caracteres.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Motivo/ }), ': perdió el teléfono');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Cómo se verificó quién lo pidió' }), 'Lo pidió un administrador de su organización');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Referencia del caso/ }), 'CASO-1024');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Correo del administrador/ }), 'jefe@acme.test');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reiniciar la verificación en dos pasos' }));

    expect(await screen.findByText('Verificación reiniciada; se cerraron 2 sesiones.')).toBeInTheDocument();
    // The requesting administrator is named by their e-mail, looked up like any account.
    expect(fake.callsTo('/platform/users').map((call) => call.path)).toContain('/platform/users?email=jefe%40acme.test');
    expect(fake.callsTo(`/platform/users/${id(80)}/mfa-reset`)[0]?.options.body).toEqual({
      reason: 'corto: perdió el teléfono',
      verification: { method: 'TENANT_ADMIN_REQUEST', reference: 'CASO-1024', tenantAdminUserId: id(80) },
    });
  });

  it('says when no account has that e-mail', async () => {
    await openConsole('/platform/accounts', {
      '/platform/users': () => {
        throw new ApiError({ status: 404, code: 'NOT_FOUND', message: 'x' });
      },
    });
    await userEvent.type(await screen.findByRole('textbox', { name: /^Correo de la cuenta/ }), 'nadie@acme.test');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('No se encontró.')).toBeInTheDocument();
  });
});
