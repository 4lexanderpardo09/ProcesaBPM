import type { MfaEnrollment, MfaEnrollmentRequiredResponse, Organization, SelectOrganizationResponse } from '@procesabpm/shared';
import type { AuthMessageKey } from '../lib/auth-error-message';

export type LoginNotice = 'expired' | 'mfaRequired' | 'signedOutElsewhere' | 'challengeExpired' | 'selectionExpired';

export interface OrganizationChoice {
  readonly organizations: readonly Organization[];
  readonly selectionToken: string;
  readonly expiresAt: number;
  readonly platformAdmin: boolean;
}

export type LoginFlowState =
  | { readonly step: 'credentials'; readonly notice?: LoginNotice | undefined }
  | { readonly step: 'mfa'; readonly challengeToken: string; readonly expiresAt: number; readonly method: 'totp' | 'backupCode' }
  | {
      readonly step: 'enrollment';
      readonly challengeToken: string;
      readonly expiresAt: number;
      readonly reason: MfaEnrollmentRequiredResponse['reason'];
      readonly enrollment: MfaEnrollment;
    }
  | { readonly step: 'backupCodes'; readonly codes: readonly string[]; readonly next: OrganizationChoice }
  | {
      readonly step: 'organization';
      readonly choice: OrganizationChoice;
      readonly backupCodesLeft?: number | undefined;
      readonly rowErrors: Readonly<Record<string, AuthMessageKey>>;
      readonly openingTenantId?: string | undefined;
    };

export type LoginFlowEvent =
  | { readonly type: 'ORGANIZATIONS_OFFERED'; readonly response: SelectOrganizationResponse & { readonly backupCodesLeft?: number | undefined }; readonly now: number }
  | { readonly type: 'MFA_REQUESTED'; readonly challengeToken: string; readonly expiresIn: number; readonly now: number }
  | { readonly type: 'ENROLLMENT_STARTED'; readonly challengeToken: string; readonly expiresIn: number; readonly reason: MfaEnrollmentRequiredResponse['reason']; readonly enrollment: MfaEnrollment; readonly now: number }
  | { readonly type: 'METHOD_SWITCHED' }
  | { readonly type: 'ENROLLMENT_CONFIRMED'; readonly backupCodes: readonly string[]; readonly response: SelectOrganizationResponse; readonly now: number }
  | { readonly type: 'BACKUP_CODES_SAVED' }
  | { readonly type: 'ORGANIZATION_OPENING'; readonly tenantId: string }
  | { readonly type: 'ORGANIZATION_REFUSED'; readonly tenantId: string; readonly message: AuthMessageKey }
  | { readonly type: 'ORGANIZATION_FAILED' }
  | { readonly type: 'EXPIRED'; readonly notice: 'challengeExpired' | 'selectionExpired' }
  | { readonly type: 'RESTARTED' };

export const initialLoginFlow = (notice?: LoginNotice): LoginFlowState => ({ step: 'credentials', notice });

const choiceOf = (response: SelectOrganizationResponse, now: number): OrganizationChoice => ({
  organizations: response.organizations,
  selectionToken: response.selectionToken,
  expiresAt: now + response.expiresIn * 1000,
  platformAdmin: response.platformAdmin,
});

/**
 * The sign-in steps, in memory only. Each step keeps just what it needs: leaving a step drops its
 * challenge token, selection token or backup codes. Nothing of it goes to the URL, history or storage.
 */
export function loginFlowReducer(state: LoginFlowState, event: LoginFlowEvent): LoginFlowState {
  switch (event.type) {
    case 'ORGANIZATIONS_OFFERED':
      return { step: 'organization', choice: choiceOf(event.response, event.now), backupCodesLeft: event.response.backupCodesLeft, rowErrors: {} };
    case 'MFA_REQUESTED':
      return { step: 'mfa', challengeToken: event.challengeToken, expiresAt: event.now + event.expiresIn * 1000, method: 'totp' };
    case 'ENROLLMENT_STARTED':
      return { step: 'enrollment', challengeToken: event.challengeToken, expiresAt: event.now + event.expiresIn * 1000, reason: event.reason, enrollment: event.enrollment };
    case 'METHOD_SWITCHED':
      return state.step === 'mfa' ? { ...state, method: state.method === 'totp' ? 'backupCode' : 'totp' } : state;
    case 'ENROLLMENT_CONFIRMED':
      return state.step === 'enrollment' ? { step: 'backupCodes', codes: event.backupCodes, next: choiceOf(event.response, event.now) } : state;
    case 'BACKUP_CODES_SAVED':
      return state.step === 'backupCodes' ? { step: 'organization', choice: state.next, rowErrors: {} } : state;
    case 'ORGANIZATION_OPENING':
      return state.step === 'organization' ? { ...state, openingTenantId: event.tenantId } : state;
    case 'ORGANIZATION_REFUSED':
      return state.step === 'organization' ? { ...state, openingTenantId: undefined, rowErrors: { ...state.rowErrors, [event.tenantId]: event.message } } : state;
    case 'ORGANIZATION_FAILED':
      return state.step === 'organization' ? { ...state, openingTenantId: undefined } : state;
    case 'EXPIRED':
      return initialLoginFlow(event.notice);
    case 'RESTARTED':
      return initialLoginFlow();
  }
}

/** An active membership without a maintenance block can be entered. */
export function isSelectable(organization: Organization): boolean {
  return organization.membershipStatus === 'ACTIVE' && organization.maintenance === null;
}

/** Exactly one organization can be entered and the person is not a platform admin: enter it without asking. */
export function autoSelectable(choice: OrganizationChoice): Organization | undefined {
  if (choice.platformAdmin) return undefined;
  const selectable = choice.organizations.filter(isSelectable);
  return selectable.length === 1 ? selectable[0] : undefined;
}

/** When the token of the current step stops working, if the step has one. */
export function expiryOf(state: LoginFlowState): { readonly at: number; readonly notice: 'challengeExpired' | 'selectionExpired' } | undefined {
  if (state.step === 'mfa' || state.step === 'enrollment') return { at: state.expiresAt, notice: 'challengeExpired' };
  if (state.step === 'organization') return { at: state.choice.expiresAt, notice: 'selectionExpired' };
  if (state.step === 'backupCodes') return { at: state.next.expiresAt, notice: 'selectionExpired' };
  return undefined;
}
