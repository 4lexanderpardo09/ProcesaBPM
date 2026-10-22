import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useSessionManager } from '@/shared/session';
import { switchTenant } from '../api/login-api';

/**
 * Opens another organization of the same person. The session manager drops every cached answer of the current one
 * first, so nothing of it is shown under the other; then the page goes to `to` (by default, the inbox).
 */
export function useSwitchOrganization() {
  const manager = useSessionManager();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async ({ tenantId }: { readonly tenantId: string; readonly to?: string }) => manager.establish(() => switchTenant(manager.publicClient, tenantId)),
    onSuccess: (_result, { to }) => void navigate(to ?? '/', { replace: true }),
  });
}
