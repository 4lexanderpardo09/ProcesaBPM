import { expect, test } from '@playwright/test';
import { installFakeAuthApi } from '../support/fake-auth-api';
import { expectSignedIn, submitCredentials } from '../support/sign-in';

const ACME = '018f0000-0000-7000-8000-0000000000a1';
const GLOBEX = '018f0000-0000-7000-8000-0000000000b2';
const organizations = [
  { tenantId: ACME, slug: 'acme', name: 'Acme' },
  { tenantId: GLOBEX, slug: 'globex', name: 'Globex' },
];

test.describe('several tabs of one browser', () => {
  test('a new tab takes the session of an open one without rotating it', async ({ context }) => {
    const api = await installFakeAuthApi(context, { organizations, signedInTo: ACME });
    const first = await context.newPage();
    await first.goto('/tickets');
    await expectSignedIn(first, 'Analista de Acme');

    const second = await context.newPage();
    await second.goto('/people');
    await expectSignedIn(second, 'Analista de Acme');

    expect(api.counts.refresh).toBe(1);
  });

  test('two tabs that start together renew the session once', async ({ context }) => {
    const api = await installFakeAuthApi(context, { organizations, signedInTo: ACME });
    const [first, second] = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all([first.goto('/tickets'), second.goto('/workflows')]);

    await expectSignedIn(first, 'Analista de Acme');
    await expectSignedIn(second, 'Analista de Acme');
    expect(api.counts.refresh).toBe(1);
    // Both tabs use the one valid token: a rotated token would have been refused with 401.
    expect(api.requests.filter((request) => request.path === '/api/auth/me').every((request) => request.authorization === `Bearer ${api.currentToken()}`)).toBe(true);
  });

  test('signing out in one tab signs out the others', async ({ context }) => {
    await installFakeAuthApi(context, { organizations, signedInTo: ACME });
    const first = await context.newPage();
    await first.goto('/tickets');
    await expectSignedIn(first, 'Analista de Acme');
    const second = await context.newPage();
    await second.goto('/people');
    await expectSignedIn(second, 'Analista de Acme');

    await first.getByRole('button', { name: 'Cerrar sesión' }).click();

    await expect(second).toHaveURL(/\/login\?notice=signedOutElsewhere$/, { timeout: 2_000 });
    await expect(second.getByText('Cerraste sesión en otra pestaña.')).toBeVisible();
  });
});

test.describe('no data crosses organizations', () => {
  test('after switching organization the page shows only the new one and old tokens are never sent again', async ({ page, context }) => {
    const api = await installFakeAuthApi(context, { organizations, signedInTo: ACME });
    await page.goto('/tickets');
    await expectSignedIn(page, 'Analista de Acme');
    const acmeToken = api.currentToken();

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await submitCredentials(page);
    await page.getByRole('button', { name: /Globex/ }).click();

    await expectSignedIn(page, 'Analista de Globex');
    await expect(page.getByText('Analista de Acme')).toHaveCount(0);
    const afterSwitch = api.requests.slice(api.requests.findIndex((request) => request.path === '/api/auth/select-tenant'));
    expect(afterSwitch.some((request) => request.authorization === `Bearer ${acmeToken}`)).toBe(false);
  });

  test('another tab that opens a different organization replaces what this tab shows', async ({ context }) => {
    await installFakeAuthApi(context, { organizations, signedInTo: ACME });
    const watcher = await context.newPage();
    await watcher.goto('/people');
    await expectSignedIn(watcher, 'Analista de Acme');

    const switcher = await context.newPage();
    await switcher.goto('/tickets');
    await expectSignedIn(switcher, 'Analista de Acme');
    await switcher.getByRole('button', { name: 'Cerrar sesión' }).click();
    await submitCredentials(switcher);
    await switcher.getByRole('button', { name: /Globex/ }).click();
    await expectSignedIn(switcher, 'Analista de Globex');

    // The watcher was signed out with the first tab, then picked up the new session from the channel.
    await expectSignedIn(watcher, 'Analista de Globex');
    await expect(watcher.getByText('Analista de Acme')).toHaveCount(0);
  });
});
