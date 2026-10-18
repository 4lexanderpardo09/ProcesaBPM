import { expect, test } from '@playwright/test';
import { BACKUP_CODES, installFakeAuthApi } from '../support/fake-auth-api';
import { expectSignedIn, submitCredentials } from '../support/sign-in';

const ACME = '018f0000-0000-7000-8000-0000000000a1';
const GLOBEX = '018f0000-0000-7000-8000-0000000000b2';
const acme = { tenantId: ACME, slug: 'acme', name: 'Acme' };
const globex = { tenantId: GLOBEX, slug: 'globex', name: 'Globex' };

test.describe('sign-in', () => {
  test('enters the only organization by itself and lands on the page the person asked for', async ({ page, context }) => {
    const api = await installFakeAuthApi(context, { organizations: [acme] });
    await page.goto('/people?tab=roles');

    await expect(page).toHaveURL(/\/login\?returnTo=%2Fpeople%3Ftab%3Droles$/);
    await submitCredentials(page);

    await expect(page).toHaveURL(/\/people\?tab=roles$/);
    await expectSignedIn(page, 'Analista de Acme');
    expect(api.counts.selectTenant).toBe(1);
  });

  test('says the credentials are wrong', async ({ page, context }) => {
    await installFakeAuthApi(context, { organizations: [acme] });
    await page.goto('/login');
    await submitCredentials(page, 'wrong password');
    await expect(page.getByRole('alert')).toContainText('El correo o la contraseña no son correctos.');
  });

  test('blocks the form while the rate limit lasts', async ({ page, context }) => {
    await installFakeAuthApi(context, { organizations: [acme], login: { kind: 'error', status: 429, code: 'RATE_LIMITED', headers: { 'Retry-After': '300' } } });
    await page.goto('/login');
    await submitCredentials(page);
    await expect(page.getByRole('alert')).toContainText('Espera 5 minutos');
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled();
  });

  test('verifies the app code', async ({ page, context }) => {
    await installFakeAuthApi(context, { organizations: [acme], login: { kind: 'mfa', code: '424242' } });
    await page.goto('/login');
    await submitCredentials(page);

    await page.getByLabel(/^Código\s*\*?$/).fill('111111');
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expect(page.getByRole('alert')).toContainText('El código no es válido o ya se usó.');

    await page.getByLabel(/^Código\s*\*?$/).fill('424242');
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expectSignedIn(page, 'Analista de Acme');
  });

  test('enrolls the second factor and gates the backup codes', async ({ page, context }) => {
    const api = await installFakeAuthApi(context, { organizations: [acme], login: { kind: 'enroll', code: '135790' } });
    await page.goto('/login');
    await submitCredentials(page);

    await expect(page.getByRole('img', { name: 'Código QR para tu app de autenticación' })).toBeVisible();
    await expect(page.getByText('JBSW Y3DP EHPK 3PXP')).toBeVisible();
    await page.getByLabel(/^Código\s*\*?$/).fill('135790');
    await page.getByRole('button', { name: 'Activar y continuar' }).click();

    await expect(page.getByRole('heading', { name: 'Guarda tus códigos de respaldo' })).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveText(BACKUP_CODES);
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'Guardé los códigos en un lugar seguro' }).check();
    await page.getByRole('button', { name: 'Continuar' }).click();

    await expectSignedIn(page, 'Analista de Acme');
    expect(api.counts.enrollmentStarted).toBe(1);
  });

  test('keeps the organization list after a refusal and enters another one', async ({ page, context }) => {
    await installFakeAuthApi(context, { organizations: [acme, globex], refusedTenants: { [ACME]: { status: 403, code: 'TENANT_SUSPENDED' } } });
    await page.goto('/login');
    await submitCredentials(page);

    await page.getByRole('button', { name: /Acme/ }).click();
    await expect(page.getByText('Esta organización está suspendida. Contacta a su administrador o elige otra.')).toBeVisible();
    await page.getByRole('button', { name: /Globex/ }).click();
    await expectSignedIn(page, 'Analista de Globex');
  });

  test('shows a sign-in-wide maintenance block', async ({ page, context }) => {
    await installFakeAuthApi(context, { organizations: [acme], login: { kind: 'error', status: 503, code: 'MAINTENANCE' } });
    await page.goto('/login');
    await submitCredentials(page);
    await expect(page.getByText('En mantenimiento')).toBeVisible();
  });

  test('never follows a returnTo to another site', async ({ page, context }) => {
    await installFakeAuthApi(context, { organizations: [acme] });
    await page.goto('/login?returnTo=https%3A%2F%2Fevil.example');
    await submitCredentials(page);
    await expect(page).toHaveURL(/\/tickets$/);
  });
});

test.describe('session', () => {
  test('survives a reload through the refresh cookie', async ({ page, context }) => {
    const api = await installFakeAuthApi(context, { organizations: [acme] });
    await page.goto('/login');
    await submitCredentials(page);
    await expectSignedIn(page, 'Analista de Acme');
    const refreshesBefore = api.counts.refresh;

    await page.reload();
    await expectSignedIn(page, 'Analista de Acme');
    expect(api.counts.refresh).toBe(refreshesBefore + 1);
  });

  test('goes back to the login page, remembering the page, when the session is gone', async ({ page, context }) => {
    const api = await installFakeAuthApi(context, { organizations: [acme], signedInTo: ACME });
    await page.goto('/workflows');
    await expectSignedIn(page, 'Analista de Acme');

    api.revokeSession();
    await page.reload();
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fworkflows$/);
  });

  test('signs out and does not come back on reload', async ({ page, context }) => {
    const api = await installFakeAuthApi(context, { organizations: [acme], signedInTo: ACME });
    await page.goto('/tickets');
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();

    await expect(page).toHaveURL(/\/login$/);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Inicia sesión' })).toBeVisible();
    expect(api.counts.logout).toBe(1);
  });
});
