import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/api';
import { profileErrorKey } from './profile-error';

const apiError = (status: number, code: string) => new ApiError({ status, code, message: 'x' });

describe('profileErrorKey', () => {
  it('names a wrong password, code or backup code, and too many tries', () => {
    expect(profileErrorKey(apiError(401, 'INVALID_CREDENTIALS'))).toBe('errors.wrongPassword');
    expect(profileErrorKey(apiError(401, 'INVALID_MFA_CODE'))).toBe('errors.wrongCode');
    expect(profileErrorKey(apiError(401, 'INVALID_MFA_CODE'), 'backupCode')).toBe('errors.wrongBackupCode');
    expect(profileErrorKey(apiError(429, 'RATE_LIMITED'))).toBe('errors.tooMany');
    expect(profileErrorKey(apiError(403, 'MFA_REQUIRED_BY_POLICY'))).toBe('errors.requiredByPolicy');
  });

  it('leaves the rest to the generic messages', () => {
    expect(profileErrorKey(apiError(500, 'INTERNAL'))).toBeUndefined();
    expect(profileErrorKey(new Error('network'))).toBeUndefined();
  });
});
