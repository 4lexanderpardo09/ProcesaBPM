import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { DomainError, mapDatabaseError } from '@procesabpm/shared';
import type { Response } from 'express';
import { JsonLogger } from '../logging/json-logger.js';
import { RequestContext } from '../logging/request-context.js';
import { HTTP_STATUS_BY_ERROR_CODE } from './error-status.js';

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string | undefined;
  };
}

const INTERNAL_ERROR_CODE = 'INTERNAL_ERROR';
const GENERIC_MESSAGES: Readonly<Record<number, string>> = {
  403: 'Not allowed',
  409: 'The request conflicts with the current state of the data',
  422: 'The request cannot be processed in the current state',
};

interface Resolved {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/**
 * Turns any error into the API error body. Database rule violations and domain errors keep their
 * typed code; messages written by the database or by unexpected failures are logged, never returned.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(JsonLogger) private readonly logger: JsonLogger,
    @Inject(RequestContext) private readonly requestContext: RequestContext,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const resolved = this.resolve(exception);
    if (resolved.status >= 500) this.logger.error(exception, 'AllExceptionsFilter');
    const body: ErrorBody = {
      error: { code: resolved.code, message: resolved.message, requestId: this.requestContext.current()?.requestId },
    };
    host.switchToHttp().getResponse<Response>().status(resolved.status).json(body);
  }

  private resolve(exception: unknown): Resolved {
    if (exception instanceof HttpException) {
      return { status: exception.getStatus(), code: `HTTP_${exception.getStatus()}`, message: exception.message };
    }
    const domainError = exception instanceof DomainError ? exception : mapDatabaseError(exception);
    if (domainError !== undefined) {
      const status = HTTP_STATUS_BY_ERROR_CODE[domainError.code];
      if (status < 500) return { status, code: domainError.code, message: GENERIC_MESSAGES[status] ?? 'Request failed' };
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: INTERNAL_ERROR_CODE, message: 'Internal server error' };
  }
}
