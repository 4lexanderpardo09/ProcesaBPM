import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, tap } from 'rxjs';
import { AUDITED_KEY } from '../../src/common/audit/audited.decorator.js';
import { RequestContext } from '../../src/common/logging/request-context.js';

/**
 * Only the end-to-end tests register it: a route that declares `@Audited(...)` and answers 2xx must have recorded each
 * declared action in its own transaction, or the request fails loudly. In production nothing extra runs.
 */
@Injectable()
export class AuditCoverageInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RequestContext) private readonly requestContext: RequestContext,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const declared = this.reflector.get<readonly string[] | undefined>(AUDITED_KEY, context.getHandler());
    if (declared === undefined) return next.handle();
    return next.handle().pipe(
      tap(() => {
        const recorded = this.requestContext.current()?.auditedActions ?? new Set<string>();
        const missing = declared.filter((action) => !recorded.has(action));
        if (missing.length > 0) throw new Error(`${context.getClass().name}.${context.getHandler().name} answered without recording ${missing.join(', ')}`);
      }),
    );
  }
}
