import { expect, test } from '@playwright/test';
import { signIn } from './support/sign-in';
import { PEOPLE } from './support/stack-fixtures';

test('the inbox reads every tab from the real API', async ({ page }) => {
  const ticketQueries: URL[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname === '/api/tickets') {
      expect(response.status()).toBe(200);
      ticketQueries.push(url);
    }
  });
  await page.goto('/tickets');
  await signIn(page, PEOPLE.singleOrganization.email);

  await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'No tienes tickets asignados.' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Todos\s*0$/ })).toBeVisible();

  const closedPage = page.waitForResponse((response) => response.url().includes('/api/tickets?') && response.url().includes('view=assigned') && response.url().includes('status=CLOSED') && !response.url().includes('pageSize=1&'));
  await page.getByRole('combobox', { name: 'Estado' }).selectOption('CLOSED');
  expect((await closedPage).status()).toBe(200);
  await expect(page.getByRole('cell', { name: 'Ningún ticket coincide con el filtro.' })).toBeVisible();
  expect(new Set(ticketQueries.map((url) => url.searchParams.get('view')))).toEqual(new Set(['assigned', 'created', 'observed', 'all']));
});
