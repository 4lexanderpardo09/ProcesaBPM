import type { Organization } from '@procesabpm/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

const ACME = '018f0000-0000-7000-8000-0000000000a1';
const GLOBEX = '018f0000-0000-7000-8000-0000000000b2';
const INITECH = '018f0000-0000-7000-8000-0000000000c3';
const UMBRELLA = '018f0000-0000-7000-8000-0000000000d4';

const organization = (tenantId: string, name: string, overrides: Partial<Organization> = {}): Organization => ({
  tenantId,
  slug: name.toLowerCase(),
  name,
  membershipStatus: 'ACTIVE',
  mfaRequired: false,
  maintenance: null,
  ...overrides,
});

const selection = (organizations: Organization[], extra: Record<string, unknown> = {}) => ({
  step: 'SELECT_ORGANIZATION',
  organizations,
  selectionToken: 'selection-token',
  expiresIn: 120,
  platformAdmin: false,
  ...extra,
});

const apiError = (status: number, code: string, extra: { retryAfterSeconds?: number; details?: unknown } = {}) => new ApiError({ status, code, message: code, ...extra });
const thrower = (error: unknown) => () => {
  throw error;
};

function renderLogin(handlers: Record<string, FakeHandler>, { url = '/login', strict = false } = {}) {
  return renderRoute(url, { signedIn: false, strict, handlers });
}

const codeField = () => screen.getByLabelText(/^Código\s*\*?$/);

async function signIn(email = 'ana@example.com', password = 'correct horse battery') {
  await userEvent.type(await screen.findByLabelText(/^Correo/), email);
  await userEvent.type(screen.getByLabelText(/^Contraseña/), password);
  await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
}

describe('LoginPage', () => {
  it('is a POST form with the autocomplete hints password managers need', async () => {
    renderLogin({});
    const email = await screen.findByLabelText(/^Correo/);
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText(/^Contraseña/)).toHaveAttribute('autocomplete', 'current-password');
    expect(email.closest('form')).toHaveAttribute('method', 'post');
  });

  it('asks for the missing fields in Spanish without calling the API', async () => {
    const login = vi.fn();
    renderLogin({ '/auth/login': login });
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar sesión' }));
    expect(await screen.findByText('Escribe tu correo.')).toBeInTheDocument();
    expect(screen.getByText('Escribe tu contraseña.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('tells apart an invalid e-mail from a missing one', async () => {
    renderLogin({});
    await userEvent.type(await screen.findByLabelText(/^Correo/), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(await screen.findByText('Escribe un correo válido.')).toBeInTheDocument();
  });

  it('says the credentials are wrong and clears the password', async () => {
    renderLogin({ '/auth/login': thrower(apiError(401, 'INVALID_CREDENTIALS')) });
    await signIn();
    expect(await screen.findByRole('alert')).toHaveTextContent('El correo o la contraseña no son correctos.');
    expect(screen.getByLabelText(/^Contraseña/)).toHaveValue('');
  });

  it('blocks the form while the rate limit lasts', async () => {
    renderLogin({ '/auth/login': thrower(apiError(429, 'RATE_LIMITED', { retryAfterSeconds: 300 })) });
    await signIn();
    expect(await screen.findByRole('alert')).toHaveTextContent('Espera 5 minutos');
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled();
  });

  it('shows a sign-in-wide maintenance announcement', async () => {
    renderLogin({ '/auth/login': thrower(apiError(503, 'MAINTENANCE', { details: { announcementId: 'a', title: 'Actualización programada', body: 'Volvemos pronto', endsAt: null } })) });
    await signIn();
    const notice = await screen.findByRole('status', { name: '' });
    expect(within(notice).getByText('Actualización programada')).toBeInTheDocument();
    expect(within(notice).getByText('Aún no hay hora de fin anunciada.')).toBeInTheDocument();
  });

  it('enters the only organization by itself and lands where the person was going', async () => {
    const view = renderLogin({ '/auth/login': () => selection([organization(ACME, 'Acme')]) }, { url: '/login?returnTo=%2Fpeople' });
    await signIn();
    await screen.findByRole('heading', { level: 1, name: 'Personas' });
    expect(view.router.state.location.pathname).toBe('/people');
  });

  it('sends the selection token as a bearer and the organization in the body', async () => {
    const view = renderLogin({ '/auth/login': () => selection([organization(ACME, 'Acme')]) });
    await signIn();
    await screen.findByRole('heading', { level: 1, name: 'Bandejas' });
    const call = view.fake.callsTo('/auth/select-tenant')[0];
    expect(call?.options.headers).toEqual({ Authorization: 'Bearer selection-token' });
    expect(call?.options.body).toEqual({ tenantId: ACME });
  });

  it('lets the person choose among several organizations, with maintenance and invitations disabled', async () => {
    renderLogin({
      '/auth/login': () =>
        selection([
          organization(ACME, 'Acme'),
          organization(UMBRELLA, 'Umbrella'),
          organization(GLOBEX, 'Globex', { maintenance: { title: 'x', endsAt: null } }),
          organization(INITECH, 'Initech', { membershipStatus: 'INVITED' }),
        ]),
    });
    await signIn();
    expect(await screen.findByRole('heading', { level: 1, name: 'Elige una organización' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Acme/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Umbrella/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Globex/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Initech/ })).toBeDisabled();
    expect(screen.getByText('Acepta la invitación desde el correo que recibiste.')).toBeInTheDocument();
  });

  it('keeps the list after a refused organization and lets the person pick another', async () => {
    const view = renderLogin({ '/auth/login': () => selection([organization(ACME, 'Acme'), organization(GLOBEX, 'Globex')]) });
    view.routes['/auth/select-tenant'] = (options) => {
      if ((options.body as { tenantId: string }).tenantId === ACME) throw apiError(403, 'TENANT_SUSPENDED');
      return view.server.issue(GLOBEX);
    };
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: /Acme/ }));
    expect(await screen.findByText('Esta organización está suspendida. Contacta a su administrador o elige otra.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Globex/ }));
    await screen.findByRole('heading', { level: 1, name: 'Bandejas' });
  });

  it('tells a platform admin the console is not in the web yet, without entering by itself', async () => {
    renderLogin({ '/auth/login': () => selection([organization(ACME, 'Acme')], { platformAdmin: true }) });
    await signIn();
    expect(await screen.findByText('La consola de plataforma todavía no está disponible en la web.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Acme/ })).toBeEnabled();
  });

  it('explains an account without organizations', async () => {
    renderLogin({ '/auth/login': () => selection([]) });
    await signIn();
    expect(await screen.findByText(/Tu cuenta no pertenece a ninguna organización activa/)).toBeInTheDocument();
  });

  it('asks for the app code, rejects a wrong one and then enters', async () => {
    const verify = vi.fn<FakeHandler>((options) => {
      if ((options.body as { code: string }).code !== '123456') throw apiError(401, 'INVALID_MFA_CODE');
      return selection([organization(ACME, 'Acme')]);
    });
    const view = renderLogin({ '/auth/login': () => ({ step: 'MFA_REQUIRED', challengeToken: 'challenge', expiresIn: 300, methods: ['TOTP', 'BACKUP_CODE'] }), '/auth/login/mfa': verify });
    await signIn();
    await screen.findByRole('heading', { level: 1, name: 'Verificación en dos pasos' });
    const code = codeField();
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');

    await userEvent.type(code, '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El código no es válido o ya se usó.');

    await userEvent.clear(codeField());
    await userEvent.type(codeField(), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    await screen.findByRole('heading', { level: 1, name: 'Bandejas' });
    expect(view.fake.callsTo('/auth/login/mfa')[0]?.options.headers).toEqual({ Authorization: 'Bearer challenge' });
  });

  it('accepts a backup code and warns how many are left before entering, even with one organization', async () => {
    renderLogin({
      '/auth/login': () => ({ step: 'MFA_REQUIRED', challengeToken: 'challenge', expiresIn: 300, methods: ['TOTP', 'BACKUP_CODE'] }),
      '/auth/login/mfa': () => selection([organization(ACME, 'Acme')], { backupCodesLeft: 2 }),
    });
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Usar un código de respaldo' }));
    await userEvent.type(screen.getByLabelText(/^Código de respaldo/), 'ABCD-EFGH-IJKL-MNOP');
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByText('Te quedan 2 códigos de respaldo. Genera nuevos desde tu perfil.')).toBeInTheDocument();
  });

  it('ignores a late answer after the person went back to the start', async () => {
    let answer: (value: unknown) => void = () => undefined;
    renderLogin({
      '/auth/login': () => ({ step: 'MFA_REQUIRED', challengeToken: 'challenge', expiresIn: 300, methods: ['TOTP'] }),
      '/auth/login/mfa': () => new Promise((resolve) => (answer = resolve)),
    });
    await signIn();
    await screen.findByRole('heading', { level: 1, name: 'Verificación en dos pasos' });
    await userEvent.type(codeField(), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Volver al inicio de sesión' }));

    answer(selection([organization(ACME, 'Acme')]));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByRole('heading', { level: 1, name: 'Inicia sesión' })).toBeInTheDocument();
  });

  it('starts over with a notice when the verification expired', async () => {
    renderLogin({
      '/auth/login': () => ({ step: 'MFA_REQUIRED', challengeToken: 'challenge', expiresIn: 300, methods: ['TOTP'] }),
      '/auth/login/mfa': thrower(apiError(401, 'UNAUTHENTICATED')),
    });
    await signIn();
    await screen.findByRole('heading', { level: 1, name: 'Verificación en dos pasos' });
    await userEvent.type(codeField(), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByText('La verificación venció. Inicia sesión de nuevo.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Inicia sesión' })).toBeInTheDocument();
  });

  it('enrolls the second factor: one secret even in StrictMode, the QR drawn in the page, then the backup codes', async () => {
    const begin = vi.fn<FakeHandler>(() => ({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/ProcesaBPM:ana@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ProcesaBPM',
      issuer: 'ProcesaBPM',
      accountName: 'ana@example.com',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    }));
    const codes = Array.from({ length: 10 }, (_, index) => `AAAA-BBBB-CCCC-000${index}`);
    renderLogin(
      {
        '/auth/login': () => ({ step: 'MFA_ENROLLMENT_REQUIRED', challengeToken: 'challenge', expiresIn: 300, reason: 'TENANT_POLICY' }),
        '/auth/login/mfa/enrollment': begin,
        '/auth/login/mfa/enrollment/confirm': () => ({ ...selection([organization(ACME, 'Acme')]), backupCodes: codes }),
      },
      { strict: true },
    );
    await signIn();

    expect(await screen.findByRole('img', { name: 'Código QR para tu app de autenticación' })).toBeInTheDocument();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    expect(screen.getByText('Una de tus organizaciones exige verificación en dos pasos.')).toBeInTheDocument();
    expect(begin).toHaveBeenCalledOnce();

    await userEvent.type(codeField(), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Activar y continuar' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Guarda tus códigos de respaldo' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(codes);
    const continueButton = screen.getByRole('button', { name: 'Continuar' });
    expect(continueButton).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Guardé los códigos en un lugar seguro' }));
    await userEvent.click(continueButton);
    await screen.findByRole('heading', { level: 1, name: 'Bandejas' });
    expect(screen.queryByText(codes[0] ?? '')).not.toBeInTheDocument();
  });

  it.each([
    ['expired', 'Tu sesión terminó. Inicia sesión de nuevo para continuar.'],
    ['mfaRequired', 'Tu organización ahora exige verificación en dos pasos. Inicia sesión de nuevo para configurarla.'],
    ['signedOutElsewhere', 'Cerraste sesión en otra pestaña.'],
  ])('shows the %s notice from the URL', async (notice, text) => {
    renderLogin({}, { url: `/login?notice=${notice}` });
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('ignores a notice that is not in the list', async () => {
    renderLogin({}, { url: '/login?notice=%3Cb%3Ehola%3C%2Fb%3E' });
    await screen.findByRole('heading', { level: 1, name: 'Inicia sesión' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
