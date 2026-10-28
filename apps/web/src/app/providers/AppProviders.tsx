import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/i18n';
import { PlatformSessionProvider, SupportVisitProvider } from '@/features/platform';
import { type RealtimeClient, RealtimeProvider } from '@/shared/realtime';
import { type SessionManager, SessionProvider } from '@/shared/session';

export interface AppProvidersProps {
  readonly queryClient: QueryClient;
  readonly session: SessionManager;
  /** The tab's real-time socket; without it the screens poll. */
  readonly realtime?: RealtimeClient | undefined;
  readonly children: ReactNode;
}

export function AppProviders({ queryClient, session, realtime, children }: AppProvidersProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider manager={session}>
          <RealtimeProvider client={realtime}>
            <PlatformSessionProvider>
              <SupportVisitProvider>{children}</SupportVisitProvider>
            </PlatformSessionProvider>
          </RealtimeProvider>
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
