import { expect, type Page } from '@playwright/test';
import { STACK_PASSWORD } from './stack-fixtures';

export async function signIn(page: Page, email: string) {
  await page.getByLabel(/^Correo/).fill(email);
  await page.getByLabel(/^Contraseña/).fill(STACK_PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
}

export const account = (page: Page) => page.getByRole('group', { name: 'Cuenta' });

export async function expectSignedInAs(page: Page, name: string) {
  await expect(account(page)).toContainText(name);
}
