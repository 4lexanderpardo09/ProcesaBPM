import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

export const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
export const at = '2026-10-01T15:00:00.000Z';
export const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 25, total: items.length });
export const plans = [
  { code: 'basic', name: 'Básico', storageBaseBytes: '1073741824', storagePerUserBytes: '0', storageGracePercent: 10, maxUsers: 20, isActive: true, tenants: 1 },
  { code: 'pro', name: 'Pro', storageBaseBytes: '10737418240', storagePerUserBytes: '0', storageGracePercent: 10, maxUsers: null, isActive: true, tenants: 0 },
];
export const tenant = (index: number, name: string, overrides: Record<string, unknown> = {}) => ({ tenantId: id(index), slug: name.toLowerCase(), name, status: 'ACTIVE', planCode: 'basic', countryCode: 'CO', createdAt: at, ...overrides });

/** Signs in as a platform administrator and opens the console, then goes to `path`. */
export async function openConsole(path: string, handlers: Record<string, FakeHandler>) {
  const rendered = renderRoute('/login', {
    signedIn: false,
    handlers: {
      '/auth/login': () => ({ step: 'SELECT_ORGANIZATION', organizations: [], selectionToken: 'selection-token', expiresIn: 120, platformAdmin: true }),
      '/auth/platform/select': () => ({ accessToken: 'platform-token', tokenType: 'Bearer', expiresIn: 900 }),
      '/auth/platform/logout': () => undefined,
      '/platform/tenants': () => page([]),
      '/platform/plans': () => plans,
      '/platform/catalog/countries': () => [{ code: 'CO', name: 'Colombia', currencyCode: 'COP', timeZone: 'America/Bogota', tenants: 1, hasHolidayGenerator: true }],
      ...handlers,
    },
  });
  await userEvent.type(await screen.findByLabelText(/^Correo/), 'root@example.com');
  await userEvent.type(screen.getByLabelText(/^Contraseña/), 'correct horse battery');
  await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Entrar a la consola de plataforma' }));
  await screen.findByRole('heading', { level: 1, name: 'Organizaciones' });
  if (path !== '/platform') await rendered.router.navigate(path);
  return rendered;
}
