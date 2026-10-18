import { ApiError, NetworkError } from './api-error';

export type GenericErrorMessage =
  | { readonly key: 'errors.network' | 'errors.unexpected' }
  | { readonly key: 'errors.unexpectedWithReference'; readonly values: { readonly requestId: string } };

/** The message (a key of the `common` namespace) for an error no screen explains better: no connection, or unexpected with its reference if the API gave one. */
export function genericErrorMessage(error: unknown): GenericErrorMessage {
  if (error instanceof NetworkError) return { key: 'errors.network' };
  if (error instanceof ApiError && error.requestId !== undefined) return { key: 'errors.unexpectedWithReference', values: { requestId: error.requestId } };
  return { key: 'errors.unexpected' };
}
