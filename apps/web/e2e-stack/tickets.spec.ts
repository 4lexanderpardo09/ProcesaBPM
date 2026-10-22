import { expect, test } from '@playwright/test';
import { signIn } from './support/sign-in';
import { PEOPLE } from './support/stack-fixtures';

test('the inbox reads every tab from the real API', async ({ page }) => {
  const countQueries: URL[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname === '/api/tickets' || url.pathname === '/api/tickets/counts') expect(response.status()).toBe(200);
    if (url.pathname === '/api/tickets/counts') countQueries.push(url);
  });
  await page.goto('/tickets');
  await signIn(page, PEOPLE.singleOrganization.email);

  await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'No tienes tickets asignados.' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Todos\s*0$/ })).toBeVisible();

  const closedPage = page.waitForResponse((response) => response.url().includes('/api/tickets?') && response.url().includes('view=assigned') && response.url().includes('status=CLOSED'));
  const closedCounts = page.waitForResponse((response) => response.url().includes('/api/tickets/counts?status=CLOSED'));
  await page.getByRole('combobox', { name: 'Estado' }).selectOption('CLOSED');
  expect((await closedPage).status()).toBe(200);
  expect(await (await closedCounts).json()).toEqual({ assigned: 0, created: 0, observed: 0, all: 0 });
  await expect(page.getByRole('cell', { name: 'Ningún ticket coincide con el filtro.' })).toBeVisible();
  expect(countQueries.length).toBeGreaterThan(0);
});

test('a ticket the person cannot see reads as not found from the real API', async ({ page }) => {
  const missing = '018f0000-0000-7000-8000-00000000ffff';
  const detail = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/tickets/${missing}`);
  await page.goto(`/tickets/${missing}`);
  await signIn(page, PEOPLE.singleOrganization.email);

  expect((await detail).status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'No encontramos este ticket' })).toBeVisible();
});
