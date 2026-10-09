import { expect, test } from '@playwright/test';

test.describe('app shell', () => {
  test('opens on the inboxes and moves between sections from the sidebar', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/tickets$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Bandejas' })).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Navegación principal' });
    await nav.getByRole('link', { name: 'Flujos' }).click();

    await expect(page).toHaveURL(/\/workflows$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Flujos' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Flujos' })).toHaveAttribute('aria-current', 'page');
  });

  test('serves a deep link directly', async ({ page }) => {
    await page.goto('/people');
    await expect(page.getByRole('heading', { level: 1, name: 'Personas' })).toBeVisible();
  });

  test('shows the not found page for an unknown address', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page.getByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeVisible();
    await page.getByRole('link', { name: 'Volver al inicio' }).click();
    await expect(page).toHaveURL(/\/tickets$/);
  });

  test('loads the design tokens and the logo', async ({ page }) => {
    await page.goto('/tickets');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe('rgb(245, 246, 248)');
    const logo = page.getByRole('complementary').locator('img');
    await expect(logo).toHaveJSProperty('complete', true);
    expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  });
});
