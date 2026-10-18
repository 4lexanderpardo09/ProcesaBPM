import { expect, type Page, test } from '@playwright/test';
import { account, expectSignedInAs, signIn } from './support/sign-in';
import { PEOPLE } from './support/stack-fixtures';
import { totpCode } from './support/totp';

const REFRESH_COOKIE = '__Secure-refresh_token';

async function bearerOfNextProfileRequest(page: Page, action: () => Promise<unknown>): Promise<string> {
  const [request] = await Promise.all([page.waitForRequest((candidate) => candidate.url().endsWith('/api/auth/me')), action()]);
  return request.headers().authorization ?? '';
}

test('signs in through the real API, keeps the session in an httpOnly cookie and signs out', async ({ page, context }) => {
  await page.goto('/people');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fpeople$/);

  await signIn(page, PEOPLE.singleOrganization.email);
  await expect(page).toHaveURL(/\/people$/);
  await expectSignedInAs(page, PEOPLE.singleOrganization.name);

  const cookie = (await context.cookies()).find((candidate) => candidate.name === REFRESH_COOKIE);
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/api/auth' });
  expect(await page.evaluate(() => document.cookie)).not.toContain(REFRESH_COOKIE);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toMatch(/eyJ/);

  await page.reload();
  await expectSignedInAs(page, PEOPLE.singleOrganization.name);

  await account(page).getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/tickets');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Ftickets$/);
});

test('enrolls the second factor with a real authenticator code and saves the backup codes', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, PEOPLE.mustEnroll.email);

  await expect(page.getByRole('img', { name: 'Código QR para tu app de autenticación' })).toBeVisible();
  const secret = (await page.locator('code').first().textContent())?.replace(/\s/g, '') ?? '';
  await page.getByLabel(/^Código\s*\*?$/).fill(totpCode(secret));
  await page.getByRole('button', { name: 'Activar y continuar' }).click();

  await expect(page.getByRole('heading', { name: 'Guarda tus códigos de respaldo' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(10);
  await page.getByRole('checkbox', { name: 'Guardé los códigos en un lugar seguro' }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expectSignedInAs(page, PEOPLE.mustEnroll.name);
});

test('two tabs that reload together stay signed in, also after the 10-second reuse window', async ({ context }) => {
  const first = await context.newPage();
  await first.goto('/login');
  await signIn(first, PEOPLE.tabs.email);
  await expectSignedInAs(first, PEOPLE.tabs.name);
  const second = await context.newPage();
  await second.goto('/people');
  await expectSignedInAs(second, PEOPLE.tabs.name);

  await Promise.all([first.reload(), second.reload()]);
  await expectSignedInAs(first, PEOPLE.tabs.name);
  await expectSignedInAs(second, PEOPLE.tabs.name);

  // A rotated refresh token presented again after 10 s revokes every session: wait past it and reload again.
  await first.waitForTimeout(11_000);
  await Promise.all([first.reload(), second.reload()]);
  await expectSignedInAs(first, PEOPLE.tabs.name);
  await expectSignedInAs(second, PEOPLE.tabs.name);
});

test('after switching organization the profile is the new one and the old token is refused', async ({ page }) => {
  await page.goto('/login');
  const [loginResponse] = await Promise.all([page.waitForResponse((response) => response.url().endsWith('/api/auth/login')), signIn(page, PEOPLE.twoOrganizations.email)]);
  const { organizations } = (await loginResponse.json()) as { organizations: { tenantId: string; name: string }[] };
  const tenantOf = (name: string) => organizations.find((organization) => organization.name === name)?.tenantId;

  const acmeBearer = await bearerOfNextProfileRequest(page, () => page.getByRole('button', { name: /Acme/ }).click());
  await expectSignedInAs(page, PEOPLE.twoOrganizations.name);

  await account(page).getByRole('button', { name: 'Cerrar sesión' }).click();
  await signIn(page, PEOPLE.twoOrganizations.email);
  const [profile] = await Promise.all([page.waitForResponse((response) => response.url().endsWith('/api/auth/me')), page.getByRole('button', { name: /Globex/ }).click()]);
  await expectSignedInAs(page, PEOPLE.twoOrganizations.name);

  expect(((await profile.json()) as { membership: { tenantId: string } }).membership.tenantId).toBe(tenantOf('Globex'));
  const replay = await page.request.get('/api/auth/me', { headers: { Authorization: acmeBearer } });
  expect(replay.status()).toBe(401);
});
