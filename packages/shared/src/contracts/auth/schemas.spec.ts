import { describe, expect, it } from 'vitest';
import { newPasswordSchema, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.js';
import {
  acceptInvitationRequestSchema,
  accessTokenClaimsSchema,
  changePasswordRequestSchema,
  disableMfaRequestSchema,
  mfaFactorSchema,
  loginRequestSchema,
  meResponseSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  selectTenantRequestSchema,
} from './schemas.js';

const uuid = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
const token = 'x'.repeat(43);

describe('newPasswordSchema', () => {
  it.each([
    ['too short', 'a'.repeat(PASSWORD_MIN_LENGTH - 1), false],
    ['the minimum length', 'a'.repeat(PASSWORD_MIN_LENGTH), true],
    ['spaces and symbols', 'correct horse battery staple!', true],
    ['the maximum length', 'a'.repeat(PASSWORD_MAX_LENGTH), true],
    ['too long', 'a'.repeat(PASSWORD_MAX_LENGTH + 1), false],
    ['empty', '', false],
  ])('%s', (_label, password, valid) => {
    expect(newPasswordSchema.safeParse(password).success).toBe(valid);
  });
});

describe('MFA contracts', () => {
  it.each([
    [{ code: '123456' }, true],
    [{ backupCode: 'ABCD-EFGH-JKMN-PQRS' }, true],
    [{ code: '12345' }, false],
    [{ code: '12345a' }, false],
    [{ code: '123456', backupCode: 'ABCD-EFGH-JKMN-PQRS' }, false],
    [{}, false],
  ])('a second factor %j is valid: %s', (input, valid) => {
    expect(mfaFactorSchema.safeParse(input).success).toBe(valid);
  });

  it('disabling needs the password and exactly one factor', () => {
    expect(disableMfaRequestSchema.safeParse({ password: 'x', code: '123456' }).success).toBe(true);
    expect(disableMfaRequestSchema.safeParse({ password: 'x', backupCode: 'ABCD-EFGH-JKMN-PQRS' }).success).toBe(true);
    expect(disableMfaRequestSchema.safeParse({ code: '123456' }).success).toBe(false);
    expect(disableMfaRequestSchema.safeParse({ password: 'x' }).success).toBe(false);
  });
});

describe('loginRequestSchema', () => {
  it('normalizes the e-mail', () => {
    const parsed = loginRequestSchema.parse({ email: '  Jane.Doe@Example.COM ', password: 'x' });
    expect(parsed.email).toBe('jane.doe@example.com');
  });

  it.each([
    ['not an e-mail', { email: 'jane', password: 'secret' }],
    ['no password', { email: 'jane@example.com', password: '' }],
    ['a huge password', { email: 'jane@example.com', password: 'a'.repeat(PASSWORD_MAX_LENGTH + 1) }],
    ['a missing field', { email: 'jane@example.com' }],
    ['a non-string e-mail', { email: ['jane@example.com'], password: 'secret' }],
  ])('rejects %s', (_label, body) => {
    expect(loginRequestSchema.safeParse(body).success).toBe(false);
  });

  it('does not apply the new-password policy to the password typed at login', () => {
    expect(loginRequestSchema.safeParse({ email: 'jane@example.com', password: 'short' }).success).toBe(true);
  });
});

describe('request schemas', () => {
  it('select-tenant needs a UUID', () => {
    expect(selectTenantRequestSchema.safeParse({ tenantId: uuid }).success).toBe(true);
    expect(selectTenantRequestSchema.safeParse({ tenantId: 'acme' }).success).toBe(false);
  });

  it('password reset request needs an e-mail', () => {
    expect(passwordResetRequestSchema.safeParse({ email: 'jane@example.com' }).success).toBe(true);
    expect(passwordResetRequestSchema.safeParse({}).success).toBe(false);
  });

  it('changing the password needs the current one and applies the policy to the new one', () => {
    expect(changePasswordRequestSchema.safeParse({ currentPassword: 'anything', newPassword: 'a-long-enough-password' }).success).toBe(true);
    expect(changePasswordRequestSchema.safeParse({ currentPassword: '', newPassword: 'a-long-enough-password' }).success).toBe(false);
    expect(changePasswordRequestSchema.safeParse({ currentPassword: 'anything', newPassword: 'short' }).success).toBe(false);
  });

  it('password reset confirmation applies the password policy and needs a long token', () => {
    expect(passwordResetConfirmSchema.safeParse({ token, newPassword: 'a-long-enough-password' }).success).toBe(true);
    expect(passwordResetConfirmSchema.safeParse({ token, newPassword: 'short' }).success).toBe(false);
    expect(passwordResetConfirmSchema.safeParse({ token: 'abc', newPassword: 'a-long-enough-password' }).success).toBe(false);
  });

  it('accepting an invitation takes an optional password that must follow the policy', () => {
    expect(acceptInvitationRequestSchema.safeParse({ token }).success).toBe(true);
    expect(acceptInvitationRequestSchema.safeParse({ token, password: 'a-long-enough-password' }).success).toBe(true);
    expect(acceptInvitationRequestSchema.safeParse({ token, password: 'short' }).success).toBe(false);
  });
});

describe('response schemas', () => {
  it('describes the profile of the current user', () => {
    const me = {
      user: { id: uuid, email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', locale: 'es-CO', timeZone: null, mfaEnabled: false, emailVerifiedAt: null },
      membership: {
        tenantId: uuid,
        status: 'ACTIVE',
        isOwner: false,
        role: { id: uuid, name: 'Admin', isAdmin: true },
        companies: [{ id: uuid, name: 'Main', isDefault: true }],
      },
      tenantMode: 'ACTIVE',
    };
    expect(meResponseSchema.safeParse(me).success).toBe(true);
    expect(meResponseSchema.safeParse({ ...me, tenantMode: 'DELETION_PENDING' }).success).toBe(true);
    expect(meResponseSchema.safeParse({ ...me, tenantMode: 'SUSPENDED' }).success).toBe(false);
  });

  it('access token claims are exactly sub, tid and sid', () => {
    expect(accessTokenClaimsSchema.safeParse({ sub: uuid, tid: uuid, sid: uuid }).success).toBe(true);
    expect(accessTokenClaimsSchema.safeParse({ sub: uuid, tid: uuid }).success).toBe(false);
  });
});
