import { ApiError, type GenericErrorMessage, genericErrorMessage } from '@/shared/api';

const FORBIDDEN = 403;

/** Why a catalog change failed, as a key of the `catalog` namespace, or the generic message (a key of `common`). */
export type AdminErrorMessage = { readonly namespace: 'admin'; readonly key: 'errors.duplicate' | 'errors.forbidden' | 'errors.invalid' | 'errors.inUse' } | ({ readonly namespace: 'common' } & GenericErrorMessage);

/** Never the API's own text: a name already taken, no permission, data the API refuses, or the generic message. */
export function adminErrorMessage(error: unknown): AdminErrorMessage {
  if (error instanceof ApiError) {
    if (error.code === 'DUPLICATE') return { namespace: 'admin', key: 'errors.duplicate' };
    if (error.status === FORBIDDEN) return { namespace: 'admin', key: 'errors.forbidden' };
    if (error.code === 'VALIDATION_FAILED') return { namespace: 'admin', key: 'errors.invalid' };
    if (error.code === 'INVALID_STATE' || error.code === 'INVALID_REFERENCE') return { namespace: 'admin', key: 'errors.inUse' };
  }
  return { namespace: 'common', ...genericErrorMessage(error) };
}
