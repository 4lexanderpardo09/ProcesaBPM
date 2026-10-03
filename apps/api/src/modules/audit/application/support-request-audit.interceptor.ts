import { type CallHandler, type ExecutionContext, HttpException, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { DomainError } from '@procesabpm/shared';
import type { Request, Response } from 'express';
import { catchError, from, mergeMap, type Observable, throwError } from 'rxjs';
import type { AuthenticatedRequest } from '../../../common/auth/principal.js';
import { TenantContext, type TenantScope } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { AuditTrail } from './audit-trail.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Records every request a support visit makes in the tenant's audit log: method, normalized route (no query string, no
 * values), outcome and the ids in the path. It fails closed: the response is released only after the row is written, so
 * support can never read something the tenant cannot see in its history.
 */
@Injectable()
export class SupportRequestAuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal?.support === undefined) return next.handle();
    const response = context.switchToHttp().getResponse<Response>();
    const { principal } = request;
    const scope = { tenantId: principal!.tenantId, userId: principal!.userId, supportGrantId: principal!.support!.grantId };
    return next.handle().pipe(
      catchError((error: unknown) => from(this.record(request, scope, { outcome: 'ERROR', status: statusOf(error), code: error instanceof DomainError ? error.code : undefined })).pipe(mergeMap(() => throwError(() => error)))),
      mergeMap((value) => from(this.record(request, scope, { outcome: 'OK', status: response.statusCode })).pipe(mergeMap(() => [value]))),
    );
  }

  private record(request: Request, scope: TenantScope, result: { outcome: 'OK' | 'ERROR'; status: number; code?: string | undefined }): Promise<void> {
    const route = (request.route as { path?: string } | undefined)?.path ?? 'unknown';
    const ids = Object.values(request.params as Record<string, string>).filter((value) => UUID.test(value));
    return this.tenantContext.run(scope, () =>
      this.runner.withTenantTransaction((tx) =>
        this.audit.record(tx, {
          action: 'support.request',
          subjectType: 'SupportRequest',
          subjectId: ids[0] ?? null,
          after: { method: request.method, route, ...result },
        }),
      ),
    );
  }
}

function statusOf(error: unknown): number {
  return error instanceof HttpException ? error.getStatus() : 500;
}
