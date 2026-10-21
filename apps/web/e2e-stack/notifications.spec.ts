import { expect, test } from '@playwright/test';
import { signIn } from './support/sign-in';
import { PEOPLE } from './support/stack-fixtures';

test('the bell counts the unread notifications and marks them read through the real API', async ({ page }) => {
  await page.goto('/tickets');
  await signIn(page, PEOPLE.notified.email);

  const bell = page.getByRole('button', { name: 'Notificaciones: 2 sin leer' });
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = page.getByRole('region', { name: 'Notificaciones' });
  await expect(panel.getByText('Bienvenida a ProcesaBPM')).toBeVisible();

  const markOne = page.waitForResponse((response) => /\/api\/notifications\/[^/]+\/read$/.test(new URL(response.url()).pathname));
  await panel.getByRole('button', { name: 'Marcar como leída: El almacenamiento llegó al 80 %' }).click();
  expect((await markOne).status()).toBe(204);
  await expect(page.getByRole('button', { name: 'Notificaciones: 1 sin leer' })).toBeVisible();

  await panel.getByRole('link', { name: 'Ver todas' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Notificaciones' })).toBeVisible();
  await page.getByRole('tab', { name: /Sin leer/ }).click();
  await expect(page.getByText('Mantenimiento programado')).toBeVisible();
  await expect(page.getByText('Bienvenida a ProcesaBPM')).toBeHidden();

  await page.getByRole('button', { name: 'Marcar todas como leídas' }).click();
  await expect(page.getByText('No tienes notificaciones sin leer.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notificaciones', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Notificaciones', exact: true })).toBeVisible();
  await expect(page.getByText('No tienes notificaciones sin leer.')).toBeVisible();
});
