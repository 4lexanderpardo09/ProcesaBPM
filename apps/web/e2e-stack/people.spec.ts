import { expect, test } from '@playwright/test';
import { signIn } from './support/sign-in';
import { PEOPLE } from './support/stack-fixtures';

test('a role is given permissions, a person is invited with it and a group gets a member, through the real API', async ({ page }) => {
  await page.goto('/people?tab=roles');
  await signIn(page, PEOPLE.singleOrganization.email);

  await page.getByRole('button', { name: 'Nuevo rol' }).click();
  const create = page.getByRole('dialog', { name: 'Nuevo rol' });
  await create.getByRole('textbox', { name: /Nombre/ }).fill('Auditor E2E');
  await create.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Permisos de Auditor E2E' }).click();
  await page.getByRole('group', { name: 'Categorías', exact: true }).getByRole('checkbox', { name: 'Ver' }).check();
  await page.getByRole('group', { name: 'Tickets', exact: true }).getByRole('checkbox', { name: 'Ver todos' }).check();
  await page.getByRole('button', { name: 'Guardar permisos' }).click();
  await expect(page.getByText('Se guardaron los permisos.')).toBeVisible();

  await page.getByRole('tab', { name: 'Miembros' }).click();
  await expect(page.getByRole('table', { name: 'Miembros' }).getByText('Tú')).toBeVisible();
  await page.getByRole('button', { name: 'Invitar persona' }).click();
  const invite = page.getByRole('dialog', { name: 'Invitar persona' });
  await invite.getByRole('textbox', { name: /Correo/ }).fill('nora@e2e.test');
  await invite.getByRole('textbox', { name: /Nombres/ }).fill('Nora');
  await invite.getByRole('textbox', { name: /Apellidos/ }).fill('Díaz');
  await invite.getByRole('combobox', { name: /Rol/ }).selectOption({ label: 'Auditor E2E' });
  const company = invite.getByRole('checkbox').first();
  if (!(await company.isChecked())) await company.check();
  await invite.getByRole('button', { name: 'Invitar persona' }).click();
  await expect(page.getByText('Se envió la invitación a nora@e2e.test. Entra con el enlace del correo.')).toBeVisible();
  // Until Nora accepts, the API does not tell her names: the e-mail names her.
  const nora = page.getByRole('row').filter({ hasText: 'nora@e2e.test' });
  await expect(nora).toContainText('Auditor E2E');
  await expect(nora).toContainText('Invitado');

  await page.getByRole('tab', { name: 'Grupos' }).click();
  await page.getByRole('button', { name: 'Nuevo grupo' }).click();
  await page.getByRole('dialog', { name: 'Nuevo grupo' }).getByRole('textbox', { name: /Nombre/ }).fill('Soporte E2E');
  await page.getByRole('dialog', { name: 'Nuevo grupo' }).getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Integrantes de Soporte E2E' }).click();
  const members = page.getByRole('dialog', { name: 'Integrantes de «Soporte E2E»' });
  await expect(members.getByText('El grupo no tiene integrantes.')).toBeVisible();
  await members.getByRole('searchbox', { name: /Buscar persona/ }).fill('Ana');
  await members.getByRole('button', { name: 'Agregar a Ana Torres' }).click();
  await expect(members.getByRole('list', { name: 'Integrantes' })).toContainText('Ana Torres');
});

test('an approval group gets approvers in order and a member, and a delegation is created, through the real API', async ({ page }) => {
  await page.goto('/people?tab=approvals');
  await signIn(page, PEOPLE.tabs.email);

  // The test organization starts without types (a real one gets a default type).
  await page.getByRole('button', { name: 'Nuevo tipo' }).click();
  await page.getByRole('dialog', { name: 'Nuevo tipo' }).getByRole('textbox', { name: /Nombre/ }).fill('Jefe inmediato E2E');
  await page.getByRole('dialog', { name: 'Nuevo tipo' }).getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('list', { name: 'Tipos de aprobación' })).toContainText('Jefe inmediato E2E');

  await page.getByRole('button', { name: 'Nuevo grupo de aprobación' }).click();
  const create = page.getByRole('dialog', { name: 'Nuevo grupo de aprobación' });
  await create.getByRole('textbox', { name: /Nombre/ }).fill('Jefes E2E');
  await create.getByRole('combobox', { name: /Tipo/ }).selectOption({ label: 'Jefe inmediato E2E' });
  await create.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Aprobadores y miembros de Jefes E2E' }).click();
  const dialog = page.getByRole('dialog', { name: 'Aprobadores y miembros de «Jefes E2E»' });
  await dialog.getByRole('searchbox', { name: /Buscar aprobador/ }).fill('Leo');
  await dialog.getByRole('button', { name: 'Agregar a Leo Mora como aprobador' }).click();
  await dialog.getByRole('searchbox', { name: /Buscar aprobador/ }).fill('Ana');
  await dialog.getByRole('button', { name: 'Agregar a Ana Torres como aprobador' }).click();
  await dialog.getByRole('button', { name: 'Subir a Ana Torres' }).click();
  await dialog.getByRole('button', { name: 'Guardar aprobadores' }).click();
  await expect(dialog.getByText('Se guardaron los aprobadores.')).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'Aprobadores' }).getByRole('listitem').first()).toContainText('Ana TorresPrincipal');
  await dialog.getByRole('searchbox', { name: /Buscar miembro/ }).fill('Tomás');
  await dialog.getByRole('button', { name: 'Agregar a Tomás Rey como miembro' }).click();
  await expect(dialog.getByRole('list', { name: 'Miembros' })).toContainText('Tomás Rey');
  await dialog.getByRole('button', { name: 'Cerrar' }).last().click();

  await page.getByRole('tab', { name: 'Delegaciones' }).click();
  await page.getByRole('button', { name: 'Nueva delegación' }).click();
  const delegation = page.getByRole('dialog', { name: 'Nueva delegación' });
  await delegation.getByRole('searchbox', { name: /Buscar a quien delega/ }).fill('Ana');
  await delegation.getByRole('button', { name: 'Elegir a Ana Torres como quien delega' }).click();
  await delegation.getByRole('searchbox', { name: /Buscar a quien la reemplaza/ }).fill('Leo');
  await delegation.getByRole('button', { name: 'Elegir a Leo Mora como reemplazo' }).click();
  const inAWeek = new Date(Date.now() + 7 * 24 * 3_600_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await delegation.getByLabel(/Hasta/).fill(inAWeek);
  await delegation.getByRole('textbox', { name: 'Motivo' }).fill('Vacaciones');
  await delegation.getByRole('button', { name: 'Crear delegación' }).click();
  const row = page.getByRole('table', { name: 'Delegaciones' }).getByRole('row').filter({ hasText: 'Vacaciones' });
  await expect(row).toContainText('Ana Torres');
  await expect(row).toContainText('Leo Mora');
  await expect(row).toContainText('Vigente');
});
