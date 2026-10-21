import { expect, test } from '@playwright/test';
import { signIn } from './support/sign-in';
import { PEOPLE } from './support/stack-fixtures';

test('a draft is drawn, saved, read again and published through the real API', async ({ page }) => {
  await page.goto('/catalog');
  await signIn(page, PEOPLE.designer.email);
  await page.getByRole('button', { name: 'Nueva categoría' }).click();
  const category = page.getByRole('dialog', { name: 'Nueva categoría' });
  await category.getByRole('textbox', { name: /Nombre/ }).fill('Tesorería E2E');
  await category.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Subcategorías de Tesorería E2E', exact: true }).click();
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
  await inspector.getByRole('textbox', { name: 'Plazo', exact: true }).fill('2');
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
  await expect(inspector.getByRole('textbox', { name: 'Plazo', exact: true })).toHaveValue('2');

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

test('a draft gets a field, who may start it, a pool with a candidate and an amount cap, and is published through the real API', async ({ page }) => {
  await page.goto('/catalog');
  await signIn(page, PEOPLE.designer.email);
  await page.getByRole('button', { name: 'Nueva categoría' }).click();
  const category = page.getByRole('dialog', { name: 'Nueva categoría' });
  await category.getByRole('textbox', { name: /Nombre/ }).fill('Anticipos E2E');
  await category.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Subcategorías de Anticipos E2E', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva subcategoría' }).click();
  const subcategory = page.getByRole('dialog', { name: 'Nueva subcategoría' });
  await subcategory.getByRole('textbox', { name: /Nombre/ }).fill('Anticipo E2E');
  await subcategory.getByRole('button', { name: 'Guardar' }).click();
  await expect(subcategory).toBeHidden();

  await page.goto('/workflows');
  await page.getByRole('button', { name: 'Nuevo flujo' }).click();
  const create = page.getByRole('dialog', { name: 'Nuevo flujo' });
  await create.getByRole('combobox', { name: /Subcategoría/ }).selectOption({ label: 'Anticipos E2E › Anticipo E2E' });
  await create.getByRole('button', { name: 'Crear flujo' }).click();
  await page.getByRole('link', { name: 'Editar el borrador v1' }).click();
  await expect(page.getByText('Todo guardado')).toBeVisible();

  const inspector = page.getByRole('complementary', { name: 'Propiedades' });
  const outline = page.getByRole('navigation', { name: 'Bloques del flujo' });
  const openBlock = async (name: string) => {
    await outline.getByRole('button', { name }).focus();
    await page.keyboard.press('Enter');
  };

  // The start: an amount to fill in, and only the organization's company may start it.
  await openBlock('Inicio: Inicio');
  await inspector.getByRole('button', { name: 'Agregar campo' }).click();
  const fieldDialog = page.getByRole('dialog', { name: 'Nuevo campo' });
  await fieldDialog.getByRole('textbox', { name: /^Nombre/ }).fill('Monto');
  await fieldDialog.getByRole('combobox', { name: 'Tipo' }).selectOption({ label: 'Moneda' });
  await fieldDialog.getByRole('checkbox', { name: 'Obligatorio' }).check();
  const fieldSaved = page.waitForResponse((response) => response.url().endsWith('/fields') && response.request().method() === 'POST');
  await fieldDialog.getByRole('button', { name: 'Agregar campo' }).click();
  expect((await fieldSaved).status()).toBe(201);
  await expect(inspector.getByRole('list', { name: 'Campos del bloque' }).getByText('MONTO · Moneda')).toBeVisible();
  const initiators = inspector.getByRole('region', { name: 'Quién puede crear tickets' });
  await initiators.getByRole('combobox', { name: 'Tipo' }).selectOption({ label: 'Empresa' });
  await initiators.getByRole('combobox', { name: 'Cuál' }).selectOption({ index: 1 });
  await initiators.getByRole('button', { name: 'Agregar' }).click();
  await expect(initiators.getByRole('list', { name: 'Quién puede crear tickets' }).getByRole('listitem')).toHaveCount(1);

  // A pool step between start and end, saved so it can get candidates.
  await page.getByRole('button', { name: 'Agregar Paso' }).click();
  await inspector.getByRole('textbox', { name: /^Nombre/ }).fill('Revisar anticipo');
  await inspector.getByRole('combobox', { name: 'Modo de asignación' }).selectOption({ label: 'Bolsa (el primero que lo toma)' });
  await inspector.getByRole('combobox', { name: 'Agregar salida hacia' }).selectOption({ label: 'Fin' });
  await inspector.getByRole('button', { name: 'Conectar' }).click();
  await openBlock('Inicio: Inicio');
  await inspector.getByRole('button', { name: 'Continuar → Fin' }).click();
  await inspector.getByRole('button', { name: 'Eliminar conexión' }).click();
  await openBlock('Inicio: Inicio');
  await inspector.getByRole('combobox', { name: 'Agregar salida hacia' }).selectOption({ label: 'Revisar anticipo' });
  await inspector.getByRole('button', { name: 'Conectar' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Todo guardado')).toBeVisible();

  await openBlock('Paso: Revisar anticipo');
  const candidates = inspector.getByRole('region', { name: 'Candidatos' });
  await candidates.getByRole('searchbox', { name: /Buscar persona/ }).fill('Leo');
  const candidatesSaved = page.waitForResponse((response) => response.url().endsWith('/candidates') && response.request().method() === 'PUT');
  await candidates.getByRole('button', { name: 'Agregar a Leo Mora' }).click();
  expect((await candidatesSaved).status()).toBe(200);
  await expect(candidates.getByRole('list', { name: 'Candidatos' }).getByText('Leo Mora')).toBeVisible();

  // A cap on the amount that stops the ticket.
  await page.getByRole('button', { name: 'Topes de monto' }).click();
  await page.getByRole('dialog', { name: 'Topes de monto' }).getByRole('button', { name: 'Agregar tope' }).click();
  const rule = page.getByRole('dialog', { name: 'Nuevo tope de monto' });
  await rule.getByRole('combobox', { name: 'Campo con el monto' }).selectOption({ label: 'Monto (MONTO)' });
  await rule.getByRole('textbox', { name: /^Tope/ }).fill('2000000');
  await rule.getByRole('combobox', { name: 'Dónde se revisa' }).selectOption({ label: 'Revisar anticipo' });
  const ruleSaved = page.waitForResponse((response) => response.url().endsWith('/amount-rules') && response.request().method() === 'POST');
  await rule.getByRole('button', { name: 'Guardar tope' }).click();
  expect((await ruleSaved).status()).toBe(201);
  const rules = page.getByRole('dialog', { name: 'Topes de monto' });
  await expect(rules.getByText('Monto hasta 2.000.000 COP: Impedir que avance')).toBeVisible();
  await rules.getByRole('button', { name: 'Cerrar' }).last().click();

  // The edits moved the revision: a canvas change saves on top of them, then it publishes.
  await openBlock('Paso: Revisar anticipo');
  await inspector.getByRole('textbox', { name: 'Plazo', exact: true }).fill('1');
  const graphSaved = page.waitForResponse((response) => response.url().endsWith('/graph') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Guardar' }).click();
  expect((await graphSaved).status()).toBe(200);
  await expect(page.getByRole('button', { name: /Validación\s*Sin problemas/ })).toBeVisible();
  await page.getByRole('button', { name: 'Publicar' }).click();
  await page.getByRole('dialog', { name: 'Publicar la versión v1' }).getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Se publicó la versión v1. Los tickets nuevos ya la siguen.')).toBeVisible();
});
