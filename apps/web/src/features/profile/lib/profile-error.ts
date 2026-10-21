import { ERROR_CODES } from '@procesabpm/shared';
import { ApiError } from '@/shared/api';

export type ProfileErrorKey = 'errors.wrongPassword' | 'errors.wrongCode' | 'errors.wrongBackupCode' | 'errors.tooMany' | 'errors.requiredByPolicy' | 'errors.notAnImage' | 'errors.weakPassword';

/**
 * What only the profile says. A wrong password or code is a 401 the session keeps (only an expired token ends it);
 * the API's own words are never shown.
 */
export function profileErrorKey(error: unknown, factor: 'code' | 'backupCode' = 'code'): ProfileErrorKey | undefined {
  if (!(error instanceof ApiError)) return undefined;
  switch (error.code) {
    case ERROR_CODES.invalidCredentials:
      return 'errors.wrongPassword';
    case ERROR_CODES.invalidMfaCode:
      return factor === 'backupCode' ? 'errors.wrongBackupCode' : 'errors.wrongCode';
    case ERROR_CODES.rateLimited:
      return 'errors.tooMany';
    case ERROR_CODES.mfaRequiredByPolicy:
      return 'errors.requiredByPolicy';
    case ERROR_CODES.invalidState:
      return 'errors.notAnImage';
    case ERROR_CODES.validationFailed:
      return 'errors.weakPassword';
    default:
      return undefined;
  }
}
