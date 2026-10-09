import { z } from 'zod';

/** Body of every API error (`AllExceptionsFilter`): a typed code, a fixed message and optional details. */
export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

/** The API answered with an error status. `code` is the domain error code (`ERROR_CODES` in shared). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | undefined,
    readonly details: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never got an answer (offline, DNS, CORS, aborted proxy). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('The API could not be reached', { cause });
    this.name = 'NetworkError';
  }
}

/** The API answered 2xx with a body that does not match the expected contract. */
export class UnexpectedResponseError extends Error {
  constructor(
    readonly status: number,
    cause: unknown,
  ) {
    super('The API response does not match the contract', { cause });
    this.name = 'UnexpectedResponseError';
  }
}

const UNKNOWN_ERROR_CODE = 'UNKNOWN_ERROR';

export function apiErrorFrom(status: number, body: unknown): ApiError {
  const parsed = apiErrorBodySchema.safeParse(body);
  if (!parsed.success) return new ApiError(status, UNKNOWN_ERROR_CODE, `HTTP ${status}`, undefined, undefined);
  const { code, message, requestId, details } = parsed.data.error;
  return new ApiError(status, code, message, requestId, details);
}
