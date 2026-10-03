import { type CallHandler, type ExecutionContext, HttpException, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { DomainError } from '@procesabpm/shared';
import type { Response } from 'express';
import { catchError, from, mergeMap, type Observable, throwError } from 'rxjs';
import type { AuthenticatedRequest } from '../../../common/auth/principal.js';
import { ERROR_RESPONSES } from '../../../common/http/error-responses.js';
import { type SupportScope, SupportRequestRecorder } from './support-request-recorder.js';

/**
 * Records every request a support visit makes that reached its handler (the ones the guards refuse are recorded by the
 * guards). It fails closed: the response is released only after the row is written, so support can never read something
 * the tenant cannot see in its history.
 */
@Injectable()
export class SupportRequestAuditInterceptor implements NestInterceptor {
  constructor(@Inject(SupportRequestRecorder) private readonly recorder: SupportRequestRecorder) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { principal } = request;
    if (principal?.support === undefined) return next.handle();
    const response = context.switchToHttp().getResponse<Response>();
    const scope: SupportScope = { tenantId: principal.tenantId, userId: principal.userId, grantId: principal.support.grantId };
    return next.handle().pipe(
      catchError((error: unknown) => from(this.recorder.record(request, scope, { outcome: 'ERROR', status: statusOf(error), code: error instanceof DomainError ? error.code : undefined })).pipe(mergeMap(() => throwError(() => error)))),
      mergeMap((value) => from(this.recorder.record(request, scope, { outcome: 'OK', status: response.statusCode })).pipe(mergeMap(() => [value]))),
    );
  }
}

/** The status the client will see: the same table the error filter uses for domain errors. */
function statusOf(error: unknown): number {
  if (error instanceof HttpException) return error.getStatus();
  if (error instanceof DomainError) return ERROR_RESPONSES[error.code].status;
  return 500;
}
