import { expect, test } from '@playwright/test';
import { type FakeTicket, installFakeAuthApi } from '../support/fake-auth-api';

const ACME = '018f0000-0000-7000-8000-0000000000a1';
const acme = { tenantId: ACME, slug: 'acme', name: 'Acme' };

const ticketId = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const ticket = (index: number, overrides: Partial<FakeTicket> = {}): FakeTicket => ({ id: ticketId(index), number: `T-${1000 + index}`, title: `Solicitud ${index}`, status: 'OPEN', ...overrides });

test.describe('ticket inbox', () => {
  test('shows the assigned tickets, switches tab and filter, and keeps them on reload', async ({ page, context }) => {
    const api = await installFakeAuthApi(context, {
      organizations: [acme],
      signedInTo: ACME,
      tickets: {
        assigned: [ticket(1, { title: 'Confirmación de pago de crédito', tags: [{ id: ticketId(500), name: 'Urgente', color: '#be123c' }] }), ticket(2, { status: 'PAUSED' })],
        all: [ticket(1), ticket(2, { status: 'PAUSED' }), ticket(3, { status: 'CLOSED', title: 'Cambio de clave de la intranet' })],
      },
    });
    await page.goto('/tickets');

    const table = page.getByRole('table', { name: 'Tickets de la bandeja' });
    await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible();
    await expect(page.getByText('2 tickets')).toBeVisible();
    await expect(table.getByRole('link', { name: 'Confirmación de pago de crédito' })).toBeVisible();
    await expect(table.getByText('Urgente')).toBeVisible();
    await expect(page.getByRole('tab', { name: /Todos\s*3/ })).toBeVisible();

    await page.getByRole('tab', { name: /^Todos/ }).click();
    await expect(page).toHaveURL(/\/tickets\?view=all$/);
    await page.getByRole('combobox', { name: 'Estado' }).selectOption('CLOSED');

    await expect(page).toHaveURL(/\/tickets\?view=all&status=CLOSED$/);
    await expect(table.getByRole('link')).toHaveText(['Cambio de clave de la intranet']);

    await page.reload();
    await expect(table.getByRole('link')).toHaveText(['Cambio de clave de la intranet']);
    await expect(page.getByRole('tab', { name: /^Todos/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('combobox', { name: 'Estado' })).toHaveValue('CLOSED');

    const ticketRequests = api.requests.filter((request) => request.path === '/api/tickets');
    expect(ticketRequests.length).toBeGreaterThan(0);
    expect(ticketRequests.every((request) => request.authorization?.startsWith('Bearer ') === true)).toBe(true);
  });

  test('opens a ticket from its row', async ({ page, context }) => {
    await installFakeAuthApi(context, { organizations: [acme], signedInTo: ACME, tickets: { assigned: [ticket(1)] } });
    await page.goto('/tickets');

    await page.getByRole('cell', { name: 'T-1001' }).click();

    await expect(page).toHaveURL(new RegExp(`/tickets/${ticketId(1)}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Solicitud 1' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('link', { name: 'Solicitud 1' })).toBeVisible();
  });
});
