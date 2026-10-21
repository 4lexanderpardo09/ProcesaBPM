import { expect, test } from '@playwright/test';
import { signIn } from './support/sign-in';
import { PEOPLE } from './support/stack-fixtures';

test('a draft is drawn, saved, read again and published through the real API', async ({ page }) => {
  await page.goto('/catalog');
  await signIn(page, PEOPLE.singleOrganization.email);
  await page.getByRole('button', { name: 'Nueva categoría' }).click();
  const category = page.getByRole('dialog', { name: 'Nueva categoría' });
  await category.getByRole('textbox', { name: /Nombre/ }).fill('Tesorería E2E');
  await category.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Subcategorías de Tesorería E2E' }).click();
  await page.getByRole('button', { name: 'Nueva subcategoría' }).click();
  const subcategory = page.getByRole('dialog', { name: 'Nueva subcategoría' });
  await subcategory.getByRole('textbox', { name: /Nombre/ }).fill('Pago a proveedor E2E');
  await subcategory.getByRole('button', { name: 'Guardar' }).click();
  await expect(subcategory).toBeHidden();

  await page.goto('/workflows');
  await page.getByRole('button', { name: 'Nuevo flujo' }).click();
  const create = page.getByRole('dialog', { name: 'Nuevo flujo' });
  await create.getByRole('combobox', { name: /Subcategoría/ }).selectOption({ label: 'Tesorería E2E › Pago a proveedor E2E' });
  await create.getByRole('button', { name: 'Crear flujo' }).click();
  await page.getByRole('link', { name: 'Editar el borrador v1' }).click();

  await expect(page.getByText('Todo guardado')).toBeVisible();
  await page.getByRole('button', { name: 'Agregar Paso' }).click();
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });
  await inspector.getByRole('textbox', { name: /Nombre/ }).fill('Revisar factura');
  await inspector.getByRole('textbox', { name: /^Plazo/ }).fill('2');
  await inspector.getByRole('combobox', { name: 'Agregar salida hacia' }).selectOption({ label: 'Fin' });
  await inspector.getByRole('button', { name: 'Conectar' }).click();

  // The start went straight to the end: its way out now leads to the new step.
  // The list of blocks is the keyboard's way to them: it shows when it gets the focus.
  const outline = page.getByRole('navigation', { name: 'Bloques del flujo' });
  const openBlock = async (name: string) => {
    await outline.getByRole('button', { name }).focus();
    await page.keyboard.press('Enter');
  };
  await openBlock('Inicio: Inicio');
  await inspector.getByRole('button', { name: 'Continuar → Fin' }).click();
  await inspector.getByRole('button', { name: 'Eliminar conexión' }).click();
  await openBlock('Inicio: Inicio');
  await inspector.getByRole('combobox', { name: 'Agregar salida hacia' }).selectOption({ label: 'Revisar factura' });
  await inspector.getByRole('button', { name: 'Conectar' }).click();
  await expect(page.getByRole('button', { name: /Validación\s*Sin problemas/ })).toBeVisible();

  const saved = page.waitForResponse((response) => response.url().endsWith('/graph') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Guardar' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('Todo guardado')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Todo guardado')).toBeVisible();
  await openBlock('Paso: Revisar factura');
  await expect(inspector.getByRole('textbox', { name: /^Plazo/ })).toHaveValue('2');

  await page.getByRole('button', { name: 'Publicar' }).click();
  const publish = page.getByRole('dialog', { name: 'Publicar la versión v1' });
  await publish.getByRole('textbox', { name: /Notas/ }).fill('Primera versión');
  await publish.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Se publicó la versión v1. Los tickets nuevos ya la siguen.')).toBeVisible();
  await expect(page.getByText(/Esta versión ya no se cambia/)).toBeVisible();

  await page.goto('/workflows');
  const row = page.getByRole('row').filter({ hasText: 'Pago a proveedor E2E' });
  await expect(row.getByText('v1')).toBeVisible();
  await expect(row).not.toContainText('Sin publicar');
});
