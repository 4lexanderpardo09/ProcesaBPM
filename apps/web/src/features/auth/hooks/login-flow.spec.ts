import type { MfaEnrollment, Organization, SelectOrganizationResponse } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { autoSelectable, expiryOf, initialLoginFlow, isSelectable, type LoginFlowState, loginFlowReducer, type OrganizationChoice } from './login-flow';

const NOW = 1_000_000;

const organization = (overrides: Partial<Organization> = {}): Organization => ({
  tenantId: '018f0000-0000-7000-8000-00000000000a',
  slug: 'acme',
  name: 'Acme',
  membershipStatus: 'ACTIVE',
  mfaRequired: false,
  tenantStatus: 'ACTIVE',
  maintenance: null,
  ...overrides,
});

const offered = (organizations: Organization[], platformAdmin = false): SelectOrganizationResponse => ({
  step: 'SELECT_ORGANIZATION',
  organizations,
  selectionToken: 'selection',
  expiresIn: 120,
  platformAdmin,
});

const enrollment: MfaEnrollment = { secret: 'JBSWY3DP', otpauthUri: 'otpauth://totp/x', issuer: 'ProcesaBPM', accountName: 'ana', algorithm: 'SHA1', digits: 6, period: 30 };
const choice = (organizations: Organization[], platformAdmin = false): OrganizationChoice => ({ organizations, selectionToken: 's', expiresAt: NOW, platformAdmin });

const mfaStep: LoginFlowState = { step: 'mfa', challengeToken: 'challenge', expiresAt: NOW + 300_000, method: 'totp' };
const enrollmentStep: LoginFlowState = { step: 'enrollment', challengeToken: 'challenge', expiresAt: NOW + 300_000, reason: 'TENANT_POLICY', enrollment };
const organizationStep = loginFlowReducer(initialLoginFlow(), { type: 'ORGANIZATIONS_OFFERED', response: offered([organization()]), now: NOW });

describe('loginFlowReducer', () => {
  it('offers the organizations with the expiry of the selection token', () => {
    expect(organizationStep).toEqual({
      step: 'organization',
      choice: { organizations: [organization()], selectionToken: 'selection', expiresAt: NOW + 120_000, platformAdmin: false },
      backupCodesLeft: undefined,
      rowErrors: {},
    });
  });

  it('asks for the app code first when MFA is required', () => {
    expect(loginFlowReducer(initialLoginFlow(), { type: 'MFA_REQUESTED', challengeToken: 'challenge', expiresIn: 300, now: NOW })).toEqual(mfaStep);
  });

  it('switches between the app code and a backup code', () => {
    const backup = loginFlowReducer(mfaStep, { type: 'METHOD_SWITCHED' });
    expect(backup).toMatchObject({ method: 'backupCode', challengeToken: 'challenge' });
    expect(loginFlowReducer(backup, { type: 'METHOD_SWITCHED' })).toMatchObject({ method: 'totp' });
  });

  it('keeps the backup codes left after a backup code was used', () => {
    const state = loginFlowReducer(mfaStep, { type: 'ORGANIZATIONS_OFFERED', response: { ...offered([organization()]), backupCodesLeft: 3 }, now: NOW });
    expect(state).toMatchObject({ step: 'organization', backupCodesLeft: 3 });
    expect(state).not.toHaveProperty('challengeToken');
  });

  it('shows the backup codes after enrolling and drops the challenge', () => {
    const codes = Array.from({ length: 10 }, (_, index) => `CODE-${index}`);
    const state = loginFlowReducer(enrollmentStep, { type: 'ENROLLMENT_CONFIRMED', backupCodes: codes, response: offered([organization()]), now: NOW });
    expect(state).toMatchObject({ step: 'backupCodes', codes, next: { selectionToken: 'selection' } });
    expect(state).not.toHaveProperty('challengeToken');
  });

  it('drops the backup codes once they were saved', () => {
    const state = loginFlowReducer({ step: 'backupCodes', codes: ['A'], next: choice([organization()]) }, { type: 'BACKUP_CODES_SAVED' });
    expect(state).toEqual({ step: 'organization', choice: choice([organization()]), rowErrors: {} });
  });

  it('keeps the selection after a refused organization, with its message, so another can be picked', () => {
    const opening = loginFlowReducer(organizationStep, { type: 'ORGANIZATION_OPENING', tenantId: 't1' });
    expect(opening).toMatchObject({ openingTenantId: 't1' });
    const refused = loginFlowReducer(opening, { type: 'ORGANIZATION_REFUSED', tenantId: 't1', message: 'auth:errors.tenantSuspended' });
    expect(refused).toMatchObject({ step: 'organization', openingTenantId: undefined, rowErrors: { t1: 'auth:errors.tenantSuspended' }, choice: { selectionToken: 'selection' } });
  });

  it('stops opening when the selection fails for another reason', () => {
    const opening = loginFlowReducer(organizationStep, { type: 'ORGANIZATION_OPENING', tenantId: 't1' });
    expect(loginFlowReducer(opening, { type: 'ORGANIZATION_FAILED' })).toMatchObject({ openingTenantId: undefined, rowErrors: {} });
  });

  it('starts over with a notice when a token expires, forgetting it', () => {
    expect(loginFlowReducer(mfaStep, { type: 'EXPIRED', notice: 'challengeExpired' })).toEqual({ step: 'credentials', notice: 'challengeExpired' });
  });

  it('starts over without a notice on request', () => {
    expect(loginFlowReducer(organizationStep, { type: 'RESTARTED' })).toEqual({ step: 'credentials', notice: undefined });
  });

  it.each([
    ['METHOD_SWITCHED outside the MFA step', organizationStep, { type: 'METHOD_SWITCHED' }],
    ['BACKUP_CODES_SAVED outside its step', mfaStep, { type: 'BACKUP_CODES_SAVED' }],
    ['ORGANIZATION_OPENING outside its step', mfaStep, { type: 'ORGANIZATION_OPENING', tenantId: 't' }],
  ] as const)('ignores %s', (_label, state, event) => {
    expect(loginFlowReducer(state, event)).toBe(state);
  });
});

describe('isSelectable and autoSelectable', () => {
  const invited = organization({ tenantId: 'b', membershipStatus: 'INVITED' });
  const inMaintenance = organization({ tenantId: 'c', maintenance: { title: 'x', endsAt: null } });

  it('only an active membership without maintenance can be entered', () => {
    expect([organization(), invited, inMaintenance].map(isSelectable)).toEqual([true, false, false]);
  });

  it('enters the only selectable organization by itself', () => {
    expect(autoSelectable(choice([organization(), invited, inMaintenance]))).toEqual(organization());
  });

  it('asks when there are several, none, or the person administers the platform', () => {
    expect(autoSelectable(choice([organization(), organization({ tenantId: 'd' })]))).toBeUndefined();
    expect(autoSelectable(choice([invited]))).toBeUndefined();
    expect(autoSelectable(choice([organization()], true))).toBeUndefined();
  });
});

describe('expiryOf', () => {
  it('follows the token of each step', () => {
    expect(expiryOf(mfaStep)).toEqual({ at: NOW + 300_000, notice: 'challengeExpired' });
    expect(expiryOf(enrollmentStep)).toEqual({ at: NOW + 300_000, notice: 'challengeExpired' });
    expect(expiryOf(organizationStep)).toEqual({ at: NOW + 120_000, notice: 'selectionExpired' });
    expect(expiryOf({ step: 'backupCodes', codes: [], next: choice([]) })).toEqual({ at: NOW, notice: 'selectionExpired' });
    expect(expiryOf(initialLoginFlow())).toBeUndefined();
  });
});
