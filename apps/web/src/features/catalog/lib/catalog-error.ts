import { ApiError, type GenericErrorMessage, genericErrorMessage } from '@/shared/api';

const FORBIDDEN = 403;

/** Why a catalog change failed, as a key of the `catalog` namespace, or the generic message (a key of `common`). */
export type CatalogErrorMessage = { readonly namespace: 'catalog'; readonly key: 'errors.duplicate' | 'errors.forbidden' | 'errors.invalid' | 'errors.inUse' } | ({ readonly namespace: 'common' } & GenericErrorMessage);

/** Never the API's own text: a name already taken, no permission, data the API refuses, or the generic message. */
export function catalogErrorMessage(error: unknown): CatalogErrorMessage {
  if (error instanceof ApiError) {
    if (error.code === 'DUPLICATE') return { namespace: 'catalog', key: 'errors.duplicate' };
    if (error.status === FORBIDDEN) return { namespace: 'catalog', key: 'errors.forbidden' };
    if (error.code === 'VALIDATION_FAILED') return { namespace: 'catalog', key: 'errors.invalid' };
    if (error.code === 'INVALID_STATE' || error.code === 'INVALID_REFERENCE') return { namespace: 'catalog', key: 'errors.inUse' };
  }
  return { namespace: 'common', ...genericErrorMessage(error) };
}
