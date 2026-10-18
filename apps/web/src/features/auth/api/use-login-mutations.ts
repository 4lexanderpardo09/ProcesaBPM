import type { LoginRequest, MfaCode, MfaFactor } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { useSessionManager } from '@/shared/session';
import { beginMfaEnrollment, confirmMfaEnrollment, logIn, selectTenant, verifyMfa } from './login-api';

interface WithChallenge<T> {
  readonly challengeToken: string;
  readonly body: T;
}

export function useLogIn() {
  const { publicClient } = useSessionManager();
  return useMutation({ mutationFn: (body: LoginRequest) => logIn(publicClient, body) });
}

export function useVerifyMfa() {
  const { publicClient } = useSessionManager();
  return useMutation({ mutationFn: ({ challengeToken, body }: WithChallenge<MfaFactor>) => verifyMfa(publicClient, challengeToken, body) });
}

export function useBeginMfaEnrollment() {
  const { publicClient } = useSessionManager();
  return useMutation({ mutationFn: (challengeToken: string) => beginMfaEnrollment(publicClient, challengeToken) });
}

export function useConfirmMfaEnrollment() {
  const { publicClient } = useSessionManager();
  return useMutation({ mutationFn: ({ challengeToken, body }: WithChallenge<MfaCode>) => confirmMfaEnrollment(publicClient, challengeToken, body) });
}

/** Opens the session through the session manager, which runs select-tenant under the cross-tab cookie lock. */
export function useSelectOrganization() {
  const manager = useSessionManager();
  return useMutation({
    mutationFn: ({ selectionToken, tenantId }: { readonly selectionToken: string; readonly tenantId: string }) =>
      manager.establish(() => selectTenant(manager.publicClient, selectionToken, tenantId)),
  });
}
