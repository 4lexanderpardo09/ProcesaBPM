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

test('the profile keeps tags, a shared template, a notification choice and a delegation, through the real API', async ({ page }) => {
  await page.goto('/profile?tab=notifications');
  await signIn(page, PEOPLE.tabs.email);

  const email = page.getByRole('checkbox', { name: 'Te asignaron un ticket: por correo' });
  const wanted = !(await email.isChecked());
  await email.setChecked(wanted);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Te asignaron un ticket: por correo' })).toBeChecked({ checked: wanted });

  await page.getByRole('tab', { name: 'Etiquetas' }).click();
  await page.getByRole('button', { name: 'Nueva etiqueta' }).click();
  await page.getByRole('dialog', { name: 'Nueva etiqueta' }).getByRole('textbox', { name: /Nombre/ }).fill('Revisar E2E');
  await page.getByRole('dialog', { name: 'Nueva etiqueta' }).getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('list', { name: 'Etiquetas' })).toContainText('Revisar E2E');

  await page.getByRole('tab', { name: 'Plantillas' }).click();
  await page.getByRole('button', { name: 'Nueva plantilla' }).click();
  const create = page.getByRole('dialog', { name: 'Nueva plantilla' });
  await create.getByRole('textbox', { name: /Título/ }).fill('Recibido E2E');
  await create.getByRole('textbox', { name: /Texto/ }).fill('Recibimos tu solicitud.\n\nGracias');
  await create.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Compartir la plantilla Recibido E2E' }).click();
  const share = page.getByRole('dialog', { name: 'Compartir «Recibido E2E»' });
  await share.getByRole('searchbox', { name: /Buscar con quién compartir/ }).fill('Leo');
  await share.getByRole('button', { name: 'Compartir con Leo Mora' }).click();
  await share.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Compartir la plantilla Recibido E2E' }).click();
  await expect(page.getByRole('dialog', { name: 'Compartir «Recibido E2E»' }).getByRole('list', { name: 'Compartida con' })).toContainText('Leo Mora');
  await page.getByRole('dialog', { name: 'Compartir «Recibido E2E»' }).getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('tab', { name: 'Delegaciones' }).click();
  await page.getByRole('button', { name: 'Delegar' }).click();
  const delegate = page.getByRole('dialog', { name: 'Delegar' });
  await delegate.getByRole('searchbox', { name: /Buscar quién te reemplaza/ }).fill('Leo');
  await delegate.getByRole('button', { name: 'Elegir a Leo Mora' }).click();
  const inADay = new Date(Date.now() + 24 * 3_600_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await delegate.getByLabel(/Hasta/).fill(inADay);
  await delegate.getByRole('button', { name: 'Crear delegación' }).click();
  const given = page.getByRole('list', { name: 'Las que diste' });
  await expect(given).toContainText('A Leo Mora');
  await expect(given).toContainText('Vigente');
  await given.getByRole('button', { name: 'Cancelar la delegación a Leo Mora' }).click();
  await expect(page.getByText('No has delegado a nadie.')).toBeVisible();
});
