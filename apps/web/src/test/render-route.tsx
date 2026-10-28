import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '@/app/providers/AppProviders';
import { appRoutes } from '@/app/router/routes';
import type { RealtimeClient } from '@/shared/realtime';
import { createTestSession, type TestSessionOptions } from './test-session';

/** Renders the whole app (providers, session and routes) at the given URL over a fake API. */
export function renderRoute(url: string, { strict = false, realtime, ...options }: TestSessionOptions & { readonly strict?: boolean; readonly realtime?: RealtimeClient | undefined } = {}) {
  const testSession = createTestSession(options);
  const router = createMemoryRouter(appRoutes, { initialEntries: [url] });
  testSession.session.start();
  const app = (
    <AppProviders queryClient={testSession.queryClient} session={testSession.session} realtime={realtime}>
      <RouterProvider router={router} />
    </AppProviders>
  );
  const view = render(strict ? <StrictMode>{app}</StrictMode> : app);
  return { router, ...testSession, ...view };
}
