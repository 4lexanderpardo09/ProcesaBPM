import type { LoginRequest, MfaCode, MfaFactor, SelectOrganizationResponse } from '@procesabpm/shared';
import { useEffect, useReducer, useRef, useState } from 'react';
import { useSessionManager } from '@/shared/session';
import { beginMfaEnrollment, confirmMfaEnrollment, logIn, selectTenant, verifyMfa } from '../api/login-api';
import { type AuthErrorContext, authErrorMessage, isExpiredStep, isOrganizationRefusal } from '../lib/auth-error-message';
import { autoSelectable, expiryOf, initialLoginFlow, type LoginFlowEvent, type LoginFlowState, type LoginNotice, loginFlowReducer } from './login-flow';

export interface StepFailure {
  readonly error: unknown;
  readonly context: AuthErrorContext;
  readonly step: LoginFlowState['step'];
}

type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
type OfferedOrganizations = SelectOrganizationResponse & { readonly backupCodesLeft?: number | undefined };

/**
 * Drives the sign-in steps. The API is called directly, not through React Query mutations: their cache would keep
 * the password, the step tokens and the backup codes after the step. Each call belongs to an attempt; once the flow
 * restarts or a step token expires, late answers of the previous attempt are ignored.
 */
export function useLoginFlow(notice: LoginNotice | undefined) {
  const manager = useSessionManager();
  const transport = manager.publicClient;
  const [state, dispatch] = useReducer(loginFlowReducer, notice, initialLoginFlow);
  const [failure, setFailure] = useState<StepFailure>();
  const [pending, setPending] = useState(0);
  const attempt = useRef(0);

  async function call<T>(work: () => Promise<T>): Promise<Outcome<T> | undefined> {
    const mine = attempt.current;
    setPending((count) => count + 1);
    try {
      const value = await work();
      return attempt.current === mine ? { ok: true, value } : undefined;
    } catch (error) {
      return attempt.current === mine ? { ok: false, error } : undefined;
    } finally {
      setPending((count) => count - 1);
    }
  }

  function startOver(event: Extract<LoginFlowEvent, { type: 'RESTARTED' | 'EXPIRED' }>) {
    attempt.current += 1;
    setFailure(undefined);
    dispatch(event);
  }

  const openingTenantId = state.step === 'organization' ? state.openingTenantId : undefined;
  useEffect(() => {
    const expiry = expiryOf(state);
    if (expiry === undefined || openingTenantId !== undefined) return undefined;
    const timer = setTimeout(() => startOver({ type: 'EXPIRED', notice: expiry.notice }), Math.max(0, expiry.at - Date.now()));
    return () => clearTimeout(timer);
  }, [state, openingTenantId]);

  async function open(selectionToken: string, tenantId: string) {
    setFailure(undefined);
    dispatch({ type: 'ORGANIZATION_OPENING', tenantId });
    const outcome = await call(() => manager.establish(() => selectTenant(transport, selectionToken, tenantId)));
    if (outcome === undefined || outcome.ok) return;
    const { error } = outcome;
    if (isExpiredStep(error)) startOver({ type: 'EXPIRED', notice: 'selectionExpired' });
    else if (isOrganizationRefusal(error)) dispatch({ type: 'ORGANIZATION_REFUSED', tenantId, message: authErrorMessage(error, 'selection').key });
    else {
      dispatch({ type: 'ORGANIZATION_FAILED' });
      setFailure({ error, context: 'selection', step: 'organization' });
    }
  }

  /** Enters the only organization by itself, unless there is a warning to read first (backup codes running out). */
  function offer(response: OfferedOrganizations) {
    const now = Date.now();
    dispatch({ type: 'ORGANIZATIONS_OFFERED', response, now });
    const only = response.backupCodesLeft === undefined ? autoSelectable({ ...response, expiresAt: now }) : undefined;
    if (only !== undefined) void open(response.selectionToken, only.tenantId);
  }

  async function submitCredentials(body: LoginRequest) {
    setFailure(undefined);
    const outcome = await call(() => logIn(transport, body));
    if (outcome === undefined) return;
    if (!outcome.ok) return setFailure({ error: outcome.error, context: 'credentials', step: 'credentials' });
    const response = outcome.value;
    if (response.step === 'SELECT_ORGANIZATION') return offer(response);
    if (response.step === 'MFA_REQUIRED') return dispatch({ type: 'MFA_REQUESTED', challengeToken: response.challengeToken, expiresIn: response.expiresIn, now: Date.now() });
    // Started here, in the event handler, exactly once: each call replaces the pending secret.
    const enrollment = await call(() => beginMfaEnrollment(transport, response.challengeToken));
    if (enrollment === undefined) return;
    if (!enrollment.ok) return setFailure({ error: enrollment.error, context: 'credentials', step: 'credentials' });
    dispatch({ type: 'ENROLLMENT_STARTED', challengeToken: response.challengeToken, expiresIn: response.expiresIn, reason: response.reason, enrollment: enrollment.value, now: Date.now() });
  }

  async function submitMfa(body: MfaFactor) {
    if (state.step !== 'mfa') return;
    setFailure(undefined);
    const { challengeToken, method } = state;
    const outcome = await call(() => verifyMfa(transport, challengeToken, body));
    if (outcome === undefined) return;
    if (outcome.ok) offer(outcome.value);
    else if (isExpiredStep(outcome.error)) startOver({ type: 'EXPIRED', notice: 'challengeExpired' });
    else setFailure({ error: outcome.error, context: method, step: 'mfa' });
  }

  async function submitEnrollmentCode(body: MfaCode) {
    if (state.step !== 'enrollment') return;
    setFailure(undefined);
    const { challengeToken } = state;
    const outcome = await call(() => confirmMfaEnrollment(transport, challengeToken, body));
    if (outcome === undefined) return;
    if (outcome.ok) {
      const { backupCodes, ...response } = outcome.value;
      dispatch({ type: 'ENROLLMENT_CONFIRMED', backupCodes, response, now: Date.now() });
    } else if (isExpiredStep(outcome.error)) startOver({ type: 'EXPIRED', notice: 'challengeExpired' });
    else setFailure({ error: outcome.error, context: 'enrollment', step: 'enrollment' });
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

  return {
    state,
    failure: failure?.step === state.step ? failure : undefined,
    busy: pending > 0,
    submitCredentials,
    submitMfa,
    switchMfaMethod: () => dispatch({ type: 'METHOD_SWITCHED' }),
    submitEnrollmentCode,
    saveBackupCodes,
    chooseOrganization,
    restart: () => startOver({ type: 'RESTARTED' }),
  };
}
