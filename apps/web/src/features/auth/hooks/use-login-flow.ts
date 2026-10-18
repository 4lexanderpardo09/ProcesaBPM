import type { LoginRequest, MfaCode, MfaFactor, SelectOrganizationResponse } from '@procesabpm/shared';
import { useEffect, useReducer, useState } from 'react';
import { useBeginMfaEnrollment, useConfirmMfaEnrollment, useLogIn, useSelectOrganization, useVerifyMfa } from '../api/use-login-mutations';
import { type AuthErrorContext, authErrorMessage, isExpiredStep, isOrganizationRefusal } from '../lib/auth-error-message';
import { autoSelectable, expiryOf, initialLoginFlow, type LoginFlowState, type LoginNotice, loginFlowReducer } from './login-flow';

export interface StepFailure {
  readonly error: unknown;
  readonly context: AuthErrorContext;
  readonly step: LoginFlowState['step'];
}

/** Drives the sign-in steps: calls the API, moves the reducer and starts over when a step token expires. */
export function useLoginFlow(notice: LoginNotice | undefined) {
  const [state, dispatch] = useReducer(loginFlowReducer, notice, initialLoginFlow);
  const [failure, setFailure] = useState<StepFailure>();
  const logIn = useLogIn();
  const verifyMfa = useVerifyMfa();
  const beginEnrollment = useBeginMfaEnrollment();
  const confirmEnrollment = useConfirmMfaEnrollment();
  const selectOrganization = useSelectOrganization();

  const fail = (error: unknown, context: AuthErrorContext) => setFailure({ error, context, step: state.step });

  const openingTenantId = state.step === 'organization' ? state.openingTenantId : undefined;
  useEffect(() => {
    const expiry = expiryOf(state);
    if (expiry === undefined || openingTenantId !== undefined) return undefined;
    const timer = setTimeout(() => dispatch({ type: 'EXPIRED', notice: expiry.notice }), Math.max(0, expiry.at - Date.now()));
    return () => clearTimeout(timer);
  }, [state, openingTenantId]);

  async function open(selectionToken: string, tenantId: string) {
    setFailure(undefined);
    dispatch({ type: 'ORGANIZATION_OPENING', tenantId });
    try {
      await selectOrganization.mutateAsync({ selectionToken, tenantId });
    } catch (error) {
      if (isExpiredStep(error)) dispatch({ type: 'EXPIRED', notice: 'selectionExpired' });
      else if (isOrganizationRefusal(error)) dispatch({ type: 'ORGANIZATION_REFUSED', tenantId, message: authErrorMessage(error, 'selection').key });
      else {
        dispatch({ type: 'ORGANIZATION_FAILED' });
        setFailure({ error, context: 'selection', step: 'organization' });
      }
    }
  }

  function offer(response: SelectOrganizationResponse & { readonly backupCodesLeft?: number | undefined }) {
    const now = Date.now();
    dispatch({ type: 'ORGANIZATIONS_OFFERED', response, now });
    const only = autoSelectable({ ...response, expiresAt: now });
    if (only !== undefined) void open(response.selectionToken, only.tenantId);
  }

  async function submitCredentials(body: LoginRequest) {
    setFailure(undefined);
    try {
      const response = await logIn.mutateAsync(body);
      if (response.step === 'SELECT_ORGANIZATION') offer(response);
      else if (response.step === 'MFA_REQUIRED') dispatch({ type: 'MFA_REQUESTED', challengeToken: response.challengeToken, expiresIn: response.expiresIn, now: Date.now() });
      else {
        // Started here, in the event handler, exactly once: each call replaces the pending secret.
        const enrollment = await beginEnrollment.mutateAsync(response.challengeToken);
        dispatch({ type: 'ENROLLMENT_STARTED', challengeToken: response.challengeToken, expiresIn: response.expiresIn, reason: response.reason, enrollment, now: Date.now() });
      }
    } catch (error) {
      fail(error, 'credentials');
    }
  }

  async function submitMfa(body: MfaFactor) {
    if (state.step !== 'mfa') return;
    setFailure(undefined);
    try {
      offer(await verifyMfa.mutateAsync({ challengeToken: state.challengeToken, body }));
    } catch (error) {
      if (isExpiredStep(error)) dispatch({ type: 'EXPIRED', notice: 'challengeExpired' });
      else fail(error, state.method);
    }
  }

  async function submitEnrollmentCode(body: MfaCode) {
    if (state.step !== 'enrollment') return;
    setFailure(undefined);
    try {
      const { backupCodes, ...response } = await confirmEnrollment.mutateAsync({ challengeToken: state.challengeToken, body });
      dispatch({ type: 'ENROLLMENT_CONFIRMED', backupCodes, response, now: Date.now() });
    } catch (error) {
      if (isExpiredStep(error)) dispatch({ type: 'EXPIRED', notice: 'challengeExpired' });
      else fail(error, 'enrollment');
    }
  }

  function saveBackupCodes() {
    if (state.step !== 'backupCodes') return;
    dispatch({ type: 'BACKUP_CODES_SAVED' });
    const only = autoSelectable(state.next);
    if (only !== undefined) void open(state.next.selectionToken, only.tenantId);
  }

  function chooseOrganization(tenantId: string) {
    if (state.step === 'organization' && state.openingTenantId === undefined) void open(state.choice.selectionToken, tenantId);
  }

  const busy = logIn.isPending || verifyMfa.isPending || beginEnrollment.isPending || confirmEnrollment.isPending || selectOrganization.isPending;

  return {
    state,
    failure: failure?.step === state.step ? failure : undefined,
    busy,
    submitCredentials,
    submitMfa,
    switchMfaMethod: () => dispatch({ type: 'METHOD_SWITCHED' }),
    submitEnrollmentCode,
    saveBackupCodes,
    chooseOrganization,
    restart: () => dispatch({ type: 'RESTARTED' }),
  };
}
