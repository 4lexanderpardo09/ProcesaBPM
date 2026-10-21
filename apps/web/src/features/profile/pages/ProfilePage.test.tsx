import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import { fakeProfile } from '@/test/fake-profile';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

const codes = Array.from({ length: 10 }, (_, index) => `abcd-efgh-ijkl-${String(index).padStart(4, '0')}`);
const mfaOff = { enabled: false, enabledAt: null, backupCodesLeft: 0, requiredByPolicy: false };
const mfaOn = { enabled: true, enabledAt: '2026-10-01T15:00:00.000Z', backupCodesLeft: 7, requiredByPolicy: false };
const enrollment = { secret: 'JBSWY3DPEHPK3PXPJBSWY3DP', otpauthUri: 'otpauth://totp/ProcesaBPM:ana?secret=JBSWY3DPEHPK3PXP', issuer: 'ProcesaBPM', accountName: 'ana@example.com', algorithm: 'SHA1', digits: 6, period: 30 };

function handlers(extra: Record<string, FakeHandler> = {}): Record<string, FakeHandler> {
  return {
    '/auth/mfa': () => mfaOff,
    '/auth/me/signature': () => null,
    ...extra,
  };
}

const open = (path: string, extra: Record<string, FakeHandler> = {}) => renderRoute(path, { handlers: handlers(extra) });

describe('ProfilePage', () => {
  it('opens from the account menu and saves the names and the time zone', async () => {
    const { fake, router } = open('/tickets', {
      '/auth/me': (options) => {
        if (options.method !== 'PATCH') return fakeProfile(options.headers?.Authorization);
        const profile = fakeProfile(options.headers?.Authorization, { firstName: 'Ana María' });
        return { ...profile, user: { ...profile.user, timeZone: 'America/Bogota' } };
      },
    });

    await userEvent.click(await within(await screen.findByRole('group', { name: 'Cuenta' })).findByRole('link', { name: /Ana Torres/ }));
    expect(router.state.location.pathname).toBe('/profile');
    expect(await screen.findByRole('textbox', { name: /Correo/ })).toHaveAttribute('readonly');
    const save = screen.getByRole('button', { name: 'Guardar mis datos' });
    expect(save).toBeDisabled();

    await userEvent.clear(screen.getByRole('textbox', { name: /Nombres/ }));
    await userEvent.type(screen.getByRole('textbox', { name: /Nombres/ }), 'Ana María');
    await userEvent.type(screen.getByRole('combobox', { name: 'Zona horaria' }), 'Bogotá');
    expect(screen.getByRole('combobox', { name: 'Zona horaria' })).toHaveAccessibleDescription(/Elige una zona de la lista, p. ej. America\/Bogota\./);
    expect(save).toBeDisabled();
    await userEvent.clear(screen.getByRole('combobox', { name: 'Zona horaria' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Zona horaria' }), 'America/Bogota');
    await userEvent.click(save);

    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === '/auth/me' && call.options.method === 'PATCH')?.options.body).toEqual({ firstName: 'Ana María', lastName: 'Torres', timeZone: 'America/Bogota' }));
    expect(await screen.findByText('Se guardaron tus datos.')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Cuenta' })).getByText('Ana María Torres')).toBeInTheDocument();
  });

  it('changes the password, and a wrong current one is an answer, not the end of the session', async () => {
    let wrong = true;
    const { fake } = open('/profile?tab=security', {
      '/auth/password': () => {
        if (wrong) throw new ApiError({ status: 401, code: 'INVALID_CREDENTIALS', message: 'no' });
        return undefined;
      },
    });

    await userEvent.type(await screen.findByLabelText(/^Contraseña actual/), 'old password!');
    await userEvent.type(screen.getByLabelText(/^Contraseña nueva/), 'corta');
    expect(screen.getByLabelText(/^Contraseña nueva/)).toHaveAccessibleDescription(/Debe tener al menos 10 caracteres/);
    await userEvent.clear(screen.getByLabelText(/^Contraseña nueva/));
    await userEvent.type(screen.getByLabelText(/^Contraseña nueva/), 'una contraseña larga');
    await userEvent.type(screen.getByLabelText(/^Repite/), 'otra contraseña');
    expect(screen.getByLabelText(/^Repite/)).toHaveAccessibleDescription('No coincide con la contraseña nueva.');
    await userEvent.clear(screen.getByLabelText(/^Repite/));
    await userEvent.type(screen.getByLabelText(/^Repite/), 'una contraseña larga');
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    expect(await screen.findByText('La contraseña actual no es correcta.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Mi perfil' })).toBeInTheDocument();
    expect(fake.callsTo('/auth/password')[0]?.options.body).toEqual({ currentPassword: 'old password!', newPassword: 'una contraseña larga' });

    wrong = false;
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText('Se cambió tu contraseña.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Contraseña actual/)).toHaveValue('');
  });

  it('turns on two-step verification with a code and the password, and shows the backup codes once', async () => {
    let enabled = false;
    const { fake } = open('/profile?tab=security', {
      '/auth/mfa': () => (enabled ? mfaOn : mfaOff),
      '/auth/mfa/enrollment': () => enrollment,
      '/auth/mfa/enrollment/confirm': () => {
        enabled = true;
        return { backupCodes: codes };
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Activar' }));
    expect(await screen.findByRole('img', { name: 'Código QR para tu app de autenticación' })).toBeInTheDocument();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Activar la verificación' }));
    expect(screen.getByRole('textbox', { name: /Código de la app/ })).toHaveAccessibleDescription('Escribe los 6 dígitos que muestra la app.');

    await userEvent.type(screen.getByRole('textbox', { name: /Código de la app/ }), '123456');
    await userEvent.type(screen.getByLabelText(/^Tu contraseña/), 'mi contraseña');
    await userEvent.click(screen.getByRole('button', { name: 'Activar la verificación' }));
    expect(await screen.findByText('abcd-efgh-ijkl-0000')).toBeInTheDocument();
    expect(fake.callsTo('/auth/mfa/enrollment/confirm')[0]?.options.body).toEqual({ code: '123456', currentPassword: 'mi contraseña' });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Guardé los códigos en un lugar seguro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText('Te quedan 7 códigos de respaldo.')).toBeInTheDocument();
    expect(screen.queryByText('abcd-efgh-ijkl-0000')).toBeNull();
  });

  it('turns it off with the password and a backup code', async () => {
    const { fake } = open('/profile?tab=security', {
      '/auth/mfa': () => mfaOn,
      '/auth/mfa/disable': () => {
        throw new ApiError({ status: 401, code: 'INVALID_MFA_CODE', message: 'no' });
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Desactivar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Usar un código de respaldo' }));
    await userEvent.type(screen.getByLabelText(/^Tu contraseña/), 'mi contraseña');
    await userEvent.type(screen.getByRole('textbox', { name: /Código de respaldo/ }), 'abcd-efgh-ijkl-0001');
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));

    expect(await screen.findByText('El código de respaldo no es válido o ya se usó.')).toBeInTheDocument();
    expect(fake.callsTo('/auth/mfa/disable')[0]?.options.body).toEqual({ password: 'mi contraseña', backupCode: 'abcd-efgh-ijkl-0001' });
  });

  it('cannot be turned off where an organization requires it, but new backup codes can be generated', async () => {
    const { fake } = open('/profile?tab=security', {
      '/auth/mfa': () => ({ ...mfaOn, requiredByPolicy: true }),
      '/auth/mfa/backup-codes': () => ({ backupCodes: codes }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Generar códigos nuevos' }));
    expect(screen.queryByRole('button', { name: 'Desactivar' })).toBeNull();
    expect(screen.getAllByText(/exige la verificación en dos pasos/).length).toBeGreaterThan(0);
    await userEvent.type(screen.getByRole('textbox', { name: /Código de la app/ }), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Generar códigos nuevos' }));

    expect(await screen.findByText('abcd-efgh-ijkl-0009')).toBeInTheDocument();
    expect(fake.callsTo('/auth/mfa/backup-codes')[0]?.options.body).toEqual({ code: '654321' });
  });

  it('refuses a signature that is not an image, and removes the one there is', async () => {
    let signature: { url: string; expiresAt: string } | null = { url: 'https://files.test/firma.png', expiresAt: '2026-10-21T16:00:00.000Z' };
    const { fake } = open('/profile?tab=signature', {
      '/auth/me/signature': (options) => {
        if (options.method === 'DELETE') signature = null;
        return signature;
      },
    });

    expect(await screen.findByRole('img', { name: 'Tu firma' })).toHaveAttribute('src', 'https://files.test/firma.png');
    await userEvent.upload(screen.getByLabelText('Imagen de la firma'), new File(['%PDF'], 'firma.pdf', { type: 'application/pdf' }), { applyAccept: false });
    expect(screen.getByText('La firma debe ser una imagen PNG o JPEG.')).toBeInTheDocument();
    expect(fake.callsTo('/files/uploads')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Quitar firma' }));
    expect(await screen.findByText('Todavía no tienes firma.')).toBeInTheDocument();
    expect(fake.callsTo('/auth/me/signature').some((call) => call.options.method === 'DELETE')).toBe(true);
  });
});
