import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '@/app/providers/AppProviders';
import { appRoutes } from '@/app/router/routes';

/** Renders the whole app (providers and routes) at the given URL. */
export function renderRoute(url: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [url] });
  return { router, ...render(<AppProviders><RouterProvider router={router} /></AppProviders>) };
}
