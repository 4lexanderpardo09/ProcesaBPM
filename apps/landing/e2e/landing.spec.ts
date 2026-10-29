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

  test('the privacy notice shows its version, links the full policy and publishes no ID number', async ({ page }) => {
    await page.goto('/privacidad');
    await expect(page.getByText('Versión 4')).toBeVisible();
    await expect(page.locator('main')).not.toContainText('C.C.');
    await page.getByRole('link', { name: 'Política de Tratamiento de la Información' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Política de Tratamiento de la Información');
  });

  test('the terms and the data processing agreement are published and linked from the footer', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Términos' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Términos y Condiciones del Servicio');
    await page.getByRole('link', { name: 'contrato de transmisión de datos' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contrato de transmisión de datos personales');
    await expect(page.getByText('Anthropic').first()).toBeVisible();
  });
});

test.describe('search engines and AI assistants', () => {
  test('one canonical address per page and the structured data of the home', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://procesabpm.com/');
    const graph = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}') as { '@graph': Array<{ '@type': string }> };
    expect(graph['@graph'].map((node) => node['@type'])).toEqual(['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']);
    await page.goto('/blog.html');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://procesabpm.com/blog');
  });

  test('robots.txt points to the sitemap and llms.txt describes the product', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Sitemap: https://procesabpm.com/sitemap-index.xml');
    expect(robots).toContain('User-agent: GPTBot');
    expect((await request.get('/sitemap-index.xml')).status()).toBe(200);
    const llms = await (await request.get('/llms.txt')).text();
    expect(llms).toContain('# ProcesaBPM');
    expect(llms).toContain('¿Necesito saber programar?');
  });

  test('the questions open and close', async ({ page }) => {
    await page.goto('/#preguntas');
    await page.getByText('¿Funciona en el celular?').click();
    await expect(page.getByText('sin instalar nada')).toBeVisible();
  });

  test('the privacy checkbox stays inside the demo form', async ({ page }) => {
    await page.goto('/#contacto');
    const checkbox = page.locator('label[for="f-consent"]');
    expect(await checkbox.evaluate((label) => getComputedStyle(label).position)).toBe('static');
    expect(await page.locator('.form').evaluate((form, label) => form.contains(label), await checkbox.elementHandle())).toBe(true);
  });

  test('without a measurement id there is no analytics and no banner', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#consent')).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelector('script[src*="googletagmanager"]'))).toBeNull();
  });
});

test.describe('analytics consent', () => {
  test.use({ baseURL: 'http://localhost:4322' });

  test('the banner closes once the visitor chooses, and stays closed', async ({ page }) => {
    await page.goto('/');
    test.skip((await page.locator('#consent').count()) === 0, 'built without PUBLIC_GA_ID');
    await page.getByRole('button', { name: 'Rechazar' }).click();
    await expect(page.locator('#consent')).toBeHidden();
    await page.reload();
    await expect(page.locator('#consent')).toBeHidden();
  });

  test('the footer reopens the banner to change the choice', async ({ page }) => {
    await page.goto('/');
    test.skip((await page.locator('#consent').count()) === 0, 'built without PUBLIC_GA_ID');
    await page.getByRole('button', { name: 'Rechazar' }).click();
    await page.getByRole('button', { name: 'Cookies' }).click();
    await expect(page.locator('#consent')).toBeVisible();
    await page.getByRole('button', { name: 'Aceptar' }).click();
    await expect(page.locator('#consent')).toBeHidden();
    await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(1);
  });
});
