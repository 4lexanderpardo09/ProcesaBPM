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

export interface ApiErrorFields {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly requestId?: string | undefined;
  readonly details?: unknown;
  /** From `Retry-After` (rate limits, maintenance, temporarily unavailable). */
  readonly retryAfterSeconds?: number | undefined;
}

/** The API answered with an error status. `code` is the domain error code (`ERROR_CODES` in shared). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: unknown;
  readonly retryAfterSeconds: number | undefined;

  constructor({ status, code, message, requestId, details, retryAfterSeconds }: ApiErrorFields) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
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
const DELTA_SECONDS = /^\d+$/;
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** `Retry-After` as seconds from now: delta-seconds or an HTTP date. Anything else is ignored. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (DELTA_SECONDS.test(trimmed)) return Number(trimmed);
  if (!HTTP_DATE.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

export function apiErrorFrom(status: number, body: unknown, headers: Headers, now = Date.now()): ApiError {
  const retryAfterSeconds = parseRetryAfter(headers.get('Retry-After'), now);
  const parsed = apiErrorBodySchema.safeParse(body);
  if (!parsed.success) return new ApiError({ status, code: UNKNOWN_ERROR_CODE, message: `HTTP ${status}`, retryAfterSeconds });
  return new ApiError({ status, ...parsed.data.error, retryAfterSeconds });
}
