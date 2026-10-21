import { expect, test } from '@playwright/test';
import { signIn } from './support/sign-in';
import { PEOPLE } from './support/stack-fixtures';

test('a calendar is created, given working hours and a holiday, tried out and deleted through the real API', async ({ page }) => {
  const year = new Date().getFullYear();
  await page.goto('/organization?tab=calendars');
  await signIn(page, PEOPLE.singleOrganization.email);

  await page.getByRole('button', { name: 'Nuevo calendario' }).click();
  const create = page.getByRole('dialog', { name: 'Nuevo calendario' });
  await create.getByRole('textbox', { name: /Nombre/ }).fill('Turno sábado');
  await create.getByRole('combobox', { name: 'País' }).selectOption({ label: 'Colombia' });
  await create.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Horario y festivos de «Turno sábado»' })).toBeVisible();

  await page.getByRole('button', { name: 'Editar el horario del sábado' }).click();
  const day = page.getByRole('dialog', { name: 'Horario del sábado' });
  await day.getByRole('button', { name: 'Agregar franja' }).click();
  await day.getByLabel(/Desde/).fill('08:00');
  await day.getByLabel(/Hasta/).fill('12:00');
  await day.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('list', { name: 'Horario laboral' }).getByRole('listitem').filter({ hasText: 'Sábado' })).toContainText('08:00–12:00');
  await expect(page.getByText('4 h de trabajo a la semana.')).toBeVisible();

  await page.getByRole('button', { name: 'Agregar festivo' }).click();
  const holiday = page.getByRole('dialog', { name: 'Agregar festivo' });
  await holiday.getByLabel(/Fecha/).fill(`${String(year)}-12-26`);
  await holiday.getByRole('textbox', { name: /Nombre/ }).fill('Cierre de fin de año');
  await holiday.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('list', { name: `Festivos de ${String(year)}` })).toContainText('Cierre de fin de año');

  await page.getByRole('textbox', { name: /Plazo/ }).fill('6');
  await page.getByRole('button', { name: 'Calcular' }).click();
  await expect(page.getByText(/^Vence el .*\(hora de America\/Bogota\)\.$/)).toBeVisible();

  await page.getByRole('button', { name: 'Eliminar Turno sábado' }).click();
  await page.getByRole('dialog', { name: 'Eliminar «Turno sábado»' }).getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByRole('table', { name: 'Calendarios' }).getByText('Turno sábado')).toHaveCount(0);
});
