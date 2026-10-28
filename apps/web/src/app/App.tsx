import type { QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import type { RealtimeClient } from '@/shared/realtime';
import type { SessionManager } from '@/shared/session';
import { AppProviders } from './providers/AppProviders';
import { appRoutes } from './router/routes';

export function App({ queryClient, session, realtime }: { readonly queryClient: QueryClient; readonly session: SessionManager; readonly realtime?: RealtimeClient | undefined }) {
  const [router] = useState(() => createBrowserRouter(appRoutes));
  return (
    <AppProviders queryClient={queryClient} session={session} realtime={realtime}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
