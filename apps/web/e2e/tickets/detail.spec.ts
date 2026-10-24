import { expect, test } from '@playwright/test';
import { installFakeAuthApi } from '../support/fake-auth-api';

const ACME = '018f0000-0000-7000-8000-0000000000a1';
const acme = { tenantId: ACME, slug: 'acme', name: 'Acme' };
const TICKET = '018f0000-0000-7000-8000-000000000001';

test.describe('ticket detail', () => {
  test('shows the ticket and adds a comment to its activity', async ({ page, context }) => {
    const api = await installFakeAuthApi(context, {
      organizations: [acme],
      signedInTo: ACME,
      tickets: { assigned: [{ id: TICKET, number: 'T-1042', title: 'Confirmación de pago de crédito', status: 'OPEN', descriptionHtml: '<p>Adjunto el <strong>comprobante</strong>.</p>' }] },
    });
    await page.goto(`/tickets/${TICKET}`);

    await expect(page.getByRole('heading', { level: 1, name: 'Confirmación de pago de crédito' })).toBeVisible();
    await expect(page.getByLabel('Resumen del ticket')).toContainText('Revisión');
    await expect(page.getByText('comprobante', { exact: true })).toBeVisible();
    await expect(page.getByText('Ana Pérez creó el ticket', { exact: false })).toBeVisible();
    const diagram = page.locator('.react-flow');
    await expect(diagram.getByText('Revisión')).toBeVisible();
    await expect(diagram.getByText('En curso')).toBeVisible();
    await expect(diagram.getByText('Aprobar')).toBeVisible();

    await page.getByRole('textbox', { name: 'Agregar un comentario' }).fill('Ya lo revisé <ok>');
    await page.getByRole('button', { name: 'Comentar' }).click();

    await expect(page.getByText('Ya lo revisé <ok>')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Agregar un comentario' })).toHaveText('');
    const comment = api.requests.find((request) => request.method === 'POST' && request.path === `/api/tickets/${TICKET}/comments`);
    expect(comment?.authorization?.startsWith('Bearer ')).toBe(true);
  });

  test('reassigns the ticket and shows its new holder', async ({ page, context }) => {
    const api = await installFakeAuthApi(context, {
      organizations: [acme],
      signedInTo: ACME,
      tickets: { assigned: [{ id: TICKET, number: 'T-1042', title: 'Confirmación de pago de crédito', status: 'OPEN', actions: { reassign: true } }] },
    });
    await page.goto(`/tickets/${TICKET}`);

    await page.getByRole('group', { name: 'Acciones del ticket' }).getByRole('button', { name: 'Reasignar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reasignar ticket' });
    await dialog.getByRole('combobox', { name: /Nuevo responsable/ }).selectOption({ label: 'Marta Ruiz' });
    await dialog.getByRole('button', { name: 'Reasignar' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByLabel('Resumen del ticket')).toContainText('Marta Ruiz');
    const reassign = api.requests.find((request) => request.method === 'POST' && request.path === `/api/tickets/${TICKET}/reassign`);
    expect(reassign?.body).toMatchObject({ toUserId: '018f0000-0000-7000-8000-0000000000f1' });
  });

  test('says the ticket is not there and leads back to the inbox', async ({ page, context }) => {
    await installFakeAuthApi(context, { organizations: [acme], signedInTo: ACME });
    await page.goto(`/tickets/${TICKET}`);

    await expect(page.getByRole('heading', { level: 1, name: 'No encontramos este ticket' })).toBeVisible();
    await page.getByRole('link', { name: 'Volver a la bandeja' }).click();
    await expect(page).toHaveURL(/\/tickets$/);
  });
});
