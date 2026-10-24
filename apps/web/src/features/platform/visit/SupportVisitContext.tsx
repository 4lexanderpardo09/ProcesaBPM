import { QueryClientProvider } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet } from 'react-router';
import { platformTenantPath } from '@/shared/lib/paths';
import { SessionProvider, useSessionManager } from '@/shared/session';
import { usePlatformSession, usePlatformSessionState } from '../session/PlatformSessionContext';
import { openSupportVisit, type SupportVisit, type SupportVisitTenant, type VisitEndReason } from './support-visit';

/** A visit that just ended, until the organization's page in the console has said why. */
export interface EndedVisit {
  readonly tenantId: string;
  readonly reason: VisitEndReason;
}

export interface SupportVisits {
  readonly visit: SupportVisit | null;
  readonly ended: EndedVisit | null;
  /** Opens a visit (closing one already open); fails as the API does, e.g. 403 when no access was given. */
  start(tenant: SupportVisitTenant): Promise<void>;
  /** The console's page took the notice of the ended visit. */
  acknowledge(): void;
}

const noVisits: SupportVisits = { visit: null, ended: null, start: () => Promise.reject(new Error('No support visits here')), acknowledge: () => undefined };

const SupportVisitContext = createContext<SupportVisits>(noVisits);

/** At most one visit per page, apart from the member session; it ends with the console session. */
export function SupportVisitProvider({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation('platform');
  const platform = usePlatformSession();
  const platformState = usePlatformSessionState();
  const { publicClient } = useSessionManager();
  const [visit, setVisit] = useState<SupportVisit | null>(null);
  const [ended, setEnded] = useState<EndedVisit | null>(null);
  const visitRef = useRef<SupportVisit | null>(null);

  const start = useCallback(
    async (tenant: SupportVisitTenant) => {
      await visitRef.current?.close();
      const opened = await openSupportVisit({ platform: platform.client, transport: publicClient, tenant, labels: { firstName: t('visit.visitorFirstName'), lastName: t('visit.visitorLastName'), role: t('visit.visitorRole') } });
      opened.onEnd((reason) => {
        if (visitRef.current !== opened) return;
        visitRef.current = null;
        setVisit(null);
        setEnded({ tenantId: tenant.id, reason });
      });
      visitRef.current = opened;
      setEnded(null);
      setVisit(opened);
    },
    [platform, publicClient, t],
  );

  // The console frame ends its session at the token's expiry only while it is shown; during a visit it is not.
  useEffect(() => {
    if (platformState === null) {
      visitRef.current?.end('platformEnded');
      return undefined;
    }
    if (visit === null) return undefined;
    const timer = setTimeout(() => platform.end(), Math.max(0, platformState.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [platformState, platform, visit]);

  const value = useMemo<SupportVisits>(() => ({ visit, ended, start, acknowledge: () => setEnded(null) }), [visit, ended, start]);
  return <SupportVisitContext.Provider value={value}>{children}</SupportVisitContext.Provider>;
}

export function useSupportVisits(): SupportVisits {
  return useContext(SupportVisitContext);
}

/**
 * Where the organization's screens hang: during a visit they run over the visit's session and cache instead of the
 * member's, so the same pages show the organization read-only. When the visit ends it goes back to the console.
 */
export function SupportVisitScope() {
  const { visit, ended } = useSupportVisits();
  if (ended !== null) return <Navigate replace to={platformTenantPath(ended.tenantId)} />;
  if (visit === null) return <Outlet />;
  return (
    <QueryClientProvider client={visit.queryClient}>
      <SessionProvider manager={visit.session}>
        <Outlet />
      </SessionProvider>
    </QueryClientProvider>
  );
}
