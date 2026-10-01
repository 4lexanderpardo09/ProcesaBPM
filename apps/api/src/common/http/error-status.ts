import { ERROR_CODES, type ErrorCode } from '@procesabpm/shared';

/** docs/base-de-datos.md §8.5: how each domain error is answered over HTTP. */
export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ErrorCode, number>> = {
  [ERROR_CODES.immutableData]: 409,
  [ERROR_CODES.invalidState]: 422,
  [ERROR_CODES.invalidReference]: 422,
  [ERROR_CODES.duplicate]: 409,
  [ERROR_CODES.overlap]: 409,
  [ERROR_CODES.permissionDenied]: 403,
  [ERROR_CODES.invalidCalendar]: 422,
  [ERROR_CODES.invalidDuration]: 422,
  [ERROR_CODES.invalidCondition]: 422,
  [ERROR_CODES.missingTenantContext]: 500,
  [ERROR_CODES.tenantContextMismatch]: 500,
  [ERROR_CODES.invalidTenantContext]: 500,
};
