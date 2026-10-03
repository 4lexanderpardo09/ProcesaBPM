export type LoginStep =
  | { readonly kind: 'MFA_REQUIRED' }
  | { readonly kind: 'MFA_ENROLLMENT_REQUIRED'; readonly reason: 'TENANT_POLICY' | 'PLATFORM_ADMIN' }
  | { readonly kind: 'SELECT_ORGANIZATION' };

export interface LoginFacts {
  readonly mfaEnabled: boolean;
  readonly platformAdmin: boolean;
  /** An ACTIVE membership sits in an organization that requires two-step verification. */
  readonly tenantRequiresMfa: boolean;
}

/**
 * What follows a correct password. An account that has the second factor must pass it; one that does not but must have it
 * (a platform administrator, or a member of an organization that requires it) must enroll first; the rest go straight on.
 * The enrollment applies to the whole account, even when the user is about to enter an organization that does not ask for it.
 */
export function decideLoginStep(facts: LoginFacts): LoginStep {
  if (facts.mfaEnabled) return { kind: 'MFA_REQUIRED' };
  if (facts.platformAdmin) return { kind: 'MFA_ENROLLMENT_REQUIRED', reason: 'PLATFORM_ADMIN' };
  if (facts.tenantRequiresMfa) return { kind: 'MFA_ENROLLMENT_REQUIRED', reason: 'TENANT_POLICY' };
  return { kind: 'SELECT_ORGANIZATION' };
}
