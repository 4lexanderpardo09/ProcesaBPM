import { expect, test } from '@playwright/test';
import { account, signIn } from './support/sign-in';
import { PEOPLE, STACK_PASSWORD } from './support/stack-fixtures';
import { totpCode } from './support/totp';

// Every change is undone at the end: other specs sign in as the same person with the same password.
test('the profile edits the name, changes the password and turns two-step verification on and off, through the real API', async ({ page }) => {
  await page.goto('/tickets');
  await signIn(page, PEOPLE.singleOrganization.email);

  await account(page).getByRole('link', { name: /Ana Torres/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mi perfil' })).toBeVisible();
  await page.getByRole('textbox', { name: /Apellidos/ }).fill('Torres Díaz');
  await page.getByRole('button', { name: 'Guardar mis datos' }).click();
  await expect(account(page)).toContainText('Ana Torres Díaz');
  await page.getByRole('textbox', { name: /Apellidos/ }).fill('Torres');
  await page.getByRole('button', { name: 'Guardar mis datos' }).click();
  await expect(account(page)).toContainText('Ana Torres');

  await page.getByRole('tab', { name: 'Seguridad' }).click();
  const changePassword = async (from: string, to: string) => {
    await page.getByLabel(/^Contraseña actual/).fill(from);
    await page.getByLabel(/^Contraseña nueva/).fill(to);
    await page.getByLabel(/^Repite/).fill(to);
    await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  };
  await changePassword('not my password', 'otra contraseña larga');
  await expect(page.getByText('La contraseña actual no es correcta.')).toBeVisible();
  await changePassword(STACK_PASSWORD, 'otra contraseña larga');
  await expect(page.getByText('Se cambió tu contraseña.')).toBeVisible();
  await changePassword('otra contraseña larga', STACK_PASSWORD);
  await expect(page.getByText('Se cambió tu contraseña.')).toBeVisible();

  await page.getByRole('button', { name: 'Activar', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Código QR para tu app de autenticación' })).toBeVisible();
  const secret = (await page.locator('code').first().textContent())?.replace(/\s/g, '') ?? '';
  await page.getByRole('textbox', { name: /Código de la app/ }).fill(totpCode(secret));
  await page.getByLabel(/^Tu contraseña/).fill(STACK_PASSWORD);
  await page.getByRole('button', { name: 'Activar la verificación' }).click();
  await expect(page.getByRole('heading', { name: 'Guarda tus códigos de respaldo' })).toBeVisible();
  const backupCode = (await page.getByRole('main').getByRole('listitem').first().textContent()) ?? '';
  await page.getByRole('checkbox', { name: 'Guardé los códigos en un lugar seguro' }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Te quedan 10 códigos de respaldo.')).toBeVisible();

  await page.getByRole('button', { name: 'Desactivar' }).click();
  await page.getByRole('button', { name: 'Usar un código de respaldo' }).click();
  await page.getByLabel(/^Tu contraseña/).fill(STACK_PASSWORD);
  await page.getByRole('textbox', { name: /Código de respaldo/ }).fill(backupCode.trim());
  await page.getByRole('button', { name: 'Desactivar' }).last().click();
  await expect(page.getByText('Inactiva')).toBeVisible();
});
