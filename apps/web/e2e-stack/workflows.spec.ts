import { expect, test } from '@playwright/test';
import { signIn } from './support/sign-in';
import { PEOPLE } from './support/stack-fixtures';

test('a workflow is created for a subcategory, its draft deleted and made again, and an observer added, through the real API', async ({ page }) => {
  await page.goto('/catalog');
  await signIn(page, PEOPLE.singleOrganization.email);

  // The stack has no catalog: a category and a subcategory for the workflow.
  await page.getByRole('button', { name: 'Nueva categoría' }).click();
  const category = page.getByRole('dialog', { name: 'Nueva categoría' });
  await category.getByRole('textbox', { name: /Nombre/ }).fill('Compras E2E');
  await category.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Subcategorías de Compras E2E' }).click();
  await page.getByRole('button', { name: 'Nueva subcategoría' }).click();
  const subcategory = page.getByRole('dialog', { name: 'Nueva subcategoría' });
  await subcategory.getByRole('textbox', { name: /Nombre/ }).fill('Orden de compra E2E');
  await subcategory.getByRole('button', { name: 'Guardar' }).click();
  await expect(subcategory).toBeHidden();

  await page.goto('/workflows');
  await page.getByRole('button', { name: 'Nuevo flujo' }).click();
  const create = page.getByRole('dialog', { name: 'Nuevo flujo' });
  await create.getByRole('combobox', { name: /Subcategoría/ }).selectOption({ label: 'Compras E2E › Orden de compra E2E' });
  await expect(create.getByRole('textbox', { name: /Nombre/ })).toHaveValue('Orden de compra E2E');
  await create.getByRole('button', { name: 'Crear flujo' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Orden de compra E2E' })).toBeVisible();
  await expect(page.getByText('Compras E2E › Orden de compra E2E')).toBeVisible();
  await expect(page.getByText(/aún no tiene una versión publicada/)).toBeVisible();
  const versions = page.getByRole('table', { name: 'Versiones del flujo' });
  await expect(versions.getByText('Borrador', { exact: true })).toBeVisible();

  // Only one draft at a time: deleting it lets a new, empty one be made.
  await versions.getByRole('button', { name: 'Eliminar el borrador v1' }).click();
  await page.getByRole('dialog', { name: 'Eliminar borrador' }).getByRole('button', { name: 'Eliminar' }).click();
  await expect(versions.getByText('Este flujo no tiene versiones.')).toBeVisible();
  await page.getByRole('button', { name: 'Nuevo borrador' }).click();
  const draft = page.getByRole('dialog', { name: 'Nuevo borrador' });
  await expect(draft.getByRole('combobox', { name: 'Empezar desde' })).toHaveValue('empty');
  await draft.getByRole('textbox', { name: /Notas/ }).fill('Primera versión');
  await draft.getByRole('button', { name: 'Crear borrador' }).click();
  // The new draft opens on the canvas; the workflow's page lists it.
  await expect(page.getByText('Borrador · v1')).toBeVisible();
  await page.getByRole('navigation', { name: 'Ruta de navegación' }).getByRole('link', { name: 'Orden de compra E2E' }).click();
  await expect(versions.getByText('Primera versión')).toBeVisible();
  await expect(versions.getByText('v1')).toBeVisible();

  await page.getByRole('tab', { name: 'Observadores' }).click();
  await page.getByRole('button', { name: 'Agregar observador' }).click();
  const observer = page.getByRole('dialog', { name: 'Agregar observador' });
  await observer.getByRole('searchbox', { name: /Buscar persona/ }).fill('Tomás');
  await observer.getByRole('button', { name: 'Agregar a Tomás Rey' }).click();
  await expect(page.getByRole('list', { name: 'Observadores del flujo' }).getByText('Tomás Rey')).toBeVisible();

  await page.goto('/workflows');
  const row = page.getByRole('row').filter({ hasText: 'Orden de compra E2E' });
  await expect(row).toContainText('Sin publicar');
  await expect(row).toContainText('v1');
});
