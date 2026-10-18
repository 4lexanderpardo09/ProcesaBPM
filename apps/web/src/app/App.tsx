import type { QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import type { SessionManager } from '@/shared/session';
import { AppProviders } from './providers/AppProviders';
import { appRoutes } from './router/routes';

export function App({ queryClient, session }: { readonly queryClient: QueryClient; readonly session: SessionManager }) {
  const [router] = useState(() => createBrowserRouter(appRoutes));
  return (
    <AppProviders queryClient={queryClient} session={session}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
