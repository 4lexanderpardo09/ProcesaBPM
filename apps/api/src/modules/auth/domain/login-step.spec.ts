import { describe, expect, it } from 'vitest';
import { decideLoginStep } from './login-step.js';

describe('decideLoginStep', () => {
  it.each([
    [{ mfaEnabled: false, platformAdmin: false, tenantRequiresMfa: false }, { kind: 'SELECT_ORGANIZATION' }],
    [{ mfaEnabled: true, platformAdmin: false, tenantRequiresMfa: false }, { kind: 'MFA_REQUIRED' }],
    [{ mfaEnabled: true, platformAdmin: true, tenantRequiresMfa: true }, { kind: 'MFA_REQUIRED' }],
    [{ mfaEnabled: false, platformAdmin: true, tenantRequiresMfa: false }, { kind: 'MFA_ENROLLMENT_REQUIRED', reason: 'PLATFORM_ADMIN' }],
    [{ mfaEnabled: false, platformAdmin: true, tenantRequiresMfa: true }, { kind: 'MFA_ENROLLMENT_REQUIRED', reason: 'PLATFORM_ADMIN' }],
    [{ mfaEnabled: false, platformAdmin: false, tenantRequiresMfa: true }, { kind: 'MFA_ENROLLMENT_REQUIRED', reason: 'TENANT_POLICY' }],
  ])('%j → %j', (facts, step) => {
    expect(decideLoginStep(facts)).toEqual(step);
  });
});
