import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { DomainError, mapDatabaseError, RateLimitedError } from '@procesabpm/shared';
import type { Response } from 'express';
import { JsonLogger } from '../logging/json-logger.js';
import { RequestContext } from '../logging/request-context.js';
import { ERROR_RESPONSES } from './error-responses.js';

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string | undefined;
    readonly details?: unknown;
  };
}

const INTERNAL_ERROR_CODE = 'INTERNAL_ERROR';

interface Resolved {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Turns any error into the API error body. Database rule violations and domain errors keep their
 * typed code with a fixed message; what the database or an unexpected failure wrote is logged, never returned.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(JsonLogger) private readonly logger: JsonLogger,
    @Inject(RequestContext) private readonly requestContext: RequestContext,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const resolved = this.resolve(exception);
    if (resolved.status >= 500 && resolved.status !== HttpStatus.NOT_IMPLEMENTED) {
      this.logger.error(exception, 'AllExceptionsFilter');
    }
    const body: ErrorBody = {
      error: {
        code: resolved.code,
        message: resolved.message,
        requestId: this.requestContext.current()?.requestId,
        ...(resolved.details === undefined ? {} : { details: resolved.details }),
      },
    };
    const response = host.switchToHttp().getResponse<Response>();
    for (const [name, value] of Object.entries(resolved.headers ?? {})) response.setHeader(name, value);
    response.status(resolved.status).json(body);
  }

  private resolve(exception: unknown): Resolved {
    if (exception instanceof HttpException) {
      return { status: exception.getStatus(), code: `HTTP_${exception.getStatus()}`, message: exception.message };
    }
    const domainError = exception instanceof DomainError ? exception : mapDatabaseError(exception);
    if (domainError === undefined) {
      return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: INTERNAL_ERROR_CODE, message: 'Internal server error' };
    }
    const { status, message } = ERROR_RESPONSES[domainError.code];
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      return { status, code: INTERNAL_ERROR_CODE, message };
    }
    return {
      status,
      code: domainError.code,
      message,
      details: domainError.details,
      ...(domainError instanceof RateLimitedError
        ? { headers: { 'Retry-After': String(domainError.retryAfterSeconds) } }
        : {}),
    };
  }
}
