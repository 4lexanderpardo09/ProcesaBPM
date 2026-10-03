import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContext } from '../../infrastructure/database/tenant-context.js';
import type { AuthenticatedRequest } from './principal.js';

/**
 * Runs the route handler inside the tenant context of the authenticated principal, so every
 * `withTenantTransaction` of the request acts as that user on that tenant. Guards run before
 * interceptors, so the principal is already verified here.
 */
@Injectable()
export class TenantScopeInterceptor implements NestInterceptor {
  constructor(@Inject(TenantContext) private readonly tenantContext: TenantContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (principal === undefined) return next.handle();
    const scope = { tenantId: principal.tenantId, userId: principal.userId, ...(principal.support ? { supportGrantId: principal.support.grantId } : {}) };
    return new Observable((subscriber) =>
      this.tenantContext.run(scope, () => next.handle().subscribe(subscriber)),
    );
  }
}
