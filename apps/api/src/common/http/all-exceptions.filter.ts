import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { DomainError, extractSqlState, isTransactionTimeout, MaintenanceError, mapDatabaseError, RateLimitedError, TemporarilyUnavailableError } from '@procesabpm/shared';
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

/** Errors that tell the client when to try again. A maintenance window without an end sends no header. */
function retryAfterOf(error: DomainError): number | undefined {
  if (error instanceof RateLimitedError || error instanceof TemporarilyUnavailableError || error instanceof MaintenanceError) return error.retryAfterSeconds;
  return undefined;
}

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
    // A maintenance block is the platform's own decision, not a failure: no error log per refused request.
    if (resolved.status >= 500 && resolved.status !== HttpStatus.NOT_IMPLEMENTED && !(exception instanceof MaintenanceError)) {
      this.logger.error(exception, 'AllExceptionsFilter');
    } else if (!(exception instanceof DomainError) && !(exception instanceof HttpException) && resolved.status !== HttpStatus.INTERNAL_SERVER_ERROR) {
      // A database rule or timeout became a 4xx/503: the response is generic by design, so the log is where the real reason is.
      this.logger.warn('Database error answered as a typed error', {
        event: 'http.database_error',
        status: resolved.status,
        code: resolved.code,
        sqlState: extractSqlState(exception) ?? (isTransactionTimeout(exception) ? 'P2028' : undefined),
        cause: exception instanceof Error ? exception.message.slice(0, 500) : String(exception).slice(0, 500),
      });
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
    const retryAfter = retryAfterOf(domainError);
    return {
      status,
      code: domainError.code,
      message,
      details: domainError.details,
      ...(retryAfter === undefined ? {} : { headers: { 'Retry-After': String(retryAfter) } }),
    };
  }
}
