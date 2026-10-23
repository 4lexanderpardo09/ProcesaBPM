import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/i18n';
import { PlatformSessionProvider } from '@/features/platform';
import { type SessionManager, SessionProvider } from '@/shared/session';

export interface AppProvidersProps {
  readonly queryClient: QueryClient;
  readonly session: SessionManager;
  readonly children: ReactNode;
}

export function AppProviders({ queryClient, session, children }: AppProvidersProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider manager={session}>
          <PlatformSessionProvider>{children}</PlatformSessionProvider>
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
