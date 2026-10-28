import { expect, type Page, test } from '@playwright/test';

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe('home', () => {
  test('opens on the promise and the real ticket, with no sideways scroll', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('¿quién lo tiene?');
    await expect(page.getByText('Anticipo feria Expoagro: stand y material')).toBeVisible();
    expect(await noSideScroll(page)).toBe(0);
  });

  test('the amount picks the route of the purchase', async ({ page }) => {
    await page.goto('/#reglas');
    const verdict = page.locator('#verdict');
    await expect(verdict).toContainText('directo a Compras');
    await page.locator('#amount-in').fill('15000000');
    await expect(page.locator('#amount-out')).toHaveText('$15.000.000');
    await expect(verdict).toContainText('Va a Gerencia');
  });

  test('without motion, the journey is the whole map and the activity as a list', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/#recorrido');
    await expect(page.locator('#journey-box')).toHaveClass(/static/);
    await expect(page.getByText('Entregados $2.000.000 en efectivo.')).toBeVisible();
    await context.close();
  });
});

test.describe('demo form', () => {
  test('marks what is missing and sends nothing', async ({ page }) => {
    let sent = false;
    await page.route('**/api/public/demo-requests', (route) => {
      sent = true;
      return route.fulfill({ status: 202 });
    });
    await page.goto('/#contacto');
    await page.getByRole('button', { name: 'Pedir la demo' }).click();
    await expect(page.locator('#form-message')).toContainText('Revisa los campos');
    await expect(page.locator('#f-email')).toHaveAttribute('aria-invalid', 'true');
    expect(sent).toBe(false);
  });

  test('sends the form with the consent and says it was received', async ({ page }) => {
    let body: unknown;
    await page.route('**/api/public/demo-requests', async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ status: 202 });
    });
    await page.goto('/#contacto');
    await page.getByLabel('Nombre', { exact: true }).fill('Laura Méndez');
    await page.getByLabel('Empresa', { exact: true }).fill('Distribuidora del Valle');
    await page.getByLabel('Correo de trabajo').fill('laura@example.com');
    await page.getByLabel('Personas que lo usarían').selectOption('FROM_20_TO_100');
    await page.getByLabel(/Acepto que ProcesaBPM/).check();
    await page.getByRole('button', { name: 'Pedir la demo' }).click();
    await expect(page.locator('#form-message')).toContainText('Recibimos tu pedido');
    expect(body).toMatchObject({ fullName: 'Laura Méndez', email: 'laura@example.com', teamSize: 'FROM_20_TO_100', privacyConsent: true, website: '' });
  });

  test('says when the server is busy', async ({ page }) => {
    await page.route('**/api/public/demo-requests', (route) => route.fulfill({ status: 429 }));
    await page.goto('/#contacto');
    await page.getByLabel('Nombre', { exact: true }).fill('Laura Méndez');
    await page.getByLabel('Empresa', { exact: true }).fill('Distribuidora del Valle');
    await page.getByLabel('Correo de trabajo').fill('laura@example.com');
    await page.getByLabel(/Acepto que ProcesaBPM/).check();
    await page.getByRole('button', { name: 'Pedir la demo' }).click();
    await expect(page.locator('#form-message')).toContainText('muchos pedidos');
  });
});

test.describe('blog and legal pages', () => {
  test('lists the articles and opens one', async ({ page }) => {
    await page.goto('/blog');
    await page.getByRole('link', { name: /anticipos del correo a un flujo/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('anticipos del correo a un flujo');
    await expect(page.getByRole('link', { name: 'Pedir una demo' }).last()).toBeVisible();
  });

  test('the privacy notice shows its version', async ({ page }) => {
    await page.goto('/privacidad');
    await expect(page.getByText('Versión 1')).toBeVisible();
  });
});
