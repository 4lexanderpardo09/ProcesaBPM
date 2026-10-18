import { expect, type Page } from '@playwright/test';

export async function submitCredentials(page: Page, password = 'correct horse battery') {
  await page.getByLabel(/^Correo/).fill('ana@example.com');
  await page.getByLabel(/^Contraseña/).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
}

export async function expectSignedIn(page: Page, role: string) {
  await expect(page.getByRole('group', { name: 'Cuenta' })).toContainText(role);
}
