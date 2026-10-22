import { useMutation } from '@tanstack/react-query';
import { setSwitchDestination, useSessionManager } from '@/shared/session';
import { switchTenant } from '../api/login-api';

/**
 * Opens another organization of the same person. The session manager drops every cached answer of the current one
 * first, so nothing of it is shown under the other; the session guard then opens `to` (by default, the home).
 */
export function useSwitchOrganization() {
  const manager = useSessionManager();
  return useMutation({
    mutationFn: async ({ tenantId, to = '/' }: { readonly tenantId: string; readonly to?: string }) => {
      setSwitchDestination(to);
      await manager.establish(() => switchTenant(manager.publicClient, tenantId));
    },
  });
}
