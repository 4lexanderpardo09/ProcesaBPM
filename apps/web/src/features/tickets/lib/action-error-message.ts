import { ApiError, type GenericErrorMessage, genericErrorMessage } from '@/shared/api';

const FORBIDDEN = 403;
const CONFLICT = 409;
const UNPROCESSABLE = 422;

/** Why a ticket action failed, as a key of the `tickets` namespace, or the generic message (a key of `common`). */
export type ActionErrorMessage = { readonly namespace: 'tickets'; readonly key: 'actions.errors.forbidden' | 'actions.errors.changed' | 'actions.errors.rejected' } | ({ readonly namespace: 'common' } & GenericErrorMessage);

/** Never the API's own message: a permission problem, a ticket that changed meanwhile, a request the step refuses, or the generic one. */
export function actionErrorMessage(error: unknown): ActionErrorMessage {
  if (error instanceof ApiError) {
    if (error.status === FORBIDDEN) return { namespace: 'tickets', key: 'actions.errors.forbidden' };
    if (error.status === CONFLICT || error.code === 'INVALID_STATE') return { namespace: 'tickets', key: 'actions.errors.changed' };
    if (error.status === UNPROCESSABLE) return { namespace: 'tickets', key: 'actions.errors.rejected' };
  }
  return { namespace: 'common', ...genericErrorMessage(error) };
}
