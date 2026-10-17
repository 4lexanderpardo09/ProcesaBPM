import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppProviders } from './providers/AppProviders';
import { appRoutes } from './router/routes';

export function App() {
  const [router] = useState(() => createBrowserRouter(appRoutes));
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
