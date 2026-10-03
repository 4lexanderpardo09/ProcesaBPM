import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { AuditTrail } from './audit-trail.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SupportScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly grantId: string;
}

export interface SupportRequestResult {
  readonly outcome: 'OK' | 'ERROR' | 'DENIED';
  readonly status: number;
  readonly code?: string | undefined;
}

/**
 * Writes the audit row of one request made under a support grant: method, normalized route (no query string, no values),
 * the ids in the path, and what happened. `DENIED` is a request the guards refused (a write attempt, a subject support
 * cannot read): those matter most to the tenant. Used by the guards (denials) and by the interceptor (everything else).
 */
@Injectable()
export class SupportRequestRecorder {
  constructor(
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
  ) {}

  record(request: Request, scope: SupportScope, result: SupportRequestResult): Promise<void> {
    const route = (request.route as { path?: string } | undefined)?.path ?? 'unknown';
    const ids = Object.values((request.params ?? {}) as Record<string, string>).filter((value) => UUID.test(value));
    return this.tenantContext.run({ tenantId: scope.tenantId, userId: scope.userId, supportGrantId: scope.grantId }, () =>
      this.runner.withTenantTransaction((tx) =>
        this.audit.record(tx, {
          action: 'support.request',
          subjectType: 'SupportRequest',
          subjectId: ids[0] ?? null,
          after: { method: request.method, route, ids, ...result },
        }),
      ),
    );
  }
}
