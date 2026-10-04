import { Inject, Injectable } from '@nestjs/common';
import { type DataExportListResponse, type DataExportResponse, ExportInProgressError, hasSqlState, NotFoundError, RateLimitedError, type RequestDataExport } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { RATE_LIMITER, type RateLimiter } from '../../../infrastructure/security/rate-limiter.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { CurrentPasswordVerifier } from '../../auth/application/current-password-verifier.js';
import { DataExportRepository } from '../data/data-export.repository.js';
import { assertMayExport, assertMayRequest, DATA_EXPORT_POLICY } from '../domain/data-export-policy.js';

const UNIQUE_VIOLATION = '23505';

/**
 * Asking for a copy of the organization's data during the deletion period, and following it. The worker builds the
 * archive (docs/arquitectura.md §19); here only the request is recorded, after the password is checked again.
 */
@Injectable()
export class DataExportRequestsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(DataExportRepository) private readonly exports: DataExportRepository,
    @Inject(CurrentPasswordVerifier) private readonly password: CurrentPasswordVerifier,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * Who may ask is decided before the password (no attempt is spent by a caller who could never export); the password
   * check counts against the account lockout like a sign-in; the state of the organization is read in the transaction
   * that records the request. Two requests at once: the database keeps one in flight and the other gets 409.
   */
  async request(principal: Principal, body: RequestDataExport): Promise<DataExportResponse> {
    assertMayExport(principal);
    await this.enforceRequestRate(principal.userId);
    await this.password.verify(principal.userId, body.currentPassword);
    try {
      return await this.runner.withTenantTransaction(async (tx) => {
        const tenant = await this.exports.findTenantDeadline(tx, principal.tenantId);
        if (tenant === undefined) throw new NotFoundError();
        assertMayRequest({ tenantStatus: tenant.status, purgeAfter: tenant.purgeAfter, ...(await this.exports.countRequests(tx, principal.tenantId)), now: this.clock.now() });
        const created = await this.exports.create(tx, { tenantId: principal.tenantId, requestedById: principal.userId, includeFiles: body.includeFiles });
        await this.audit.record(tx, { action: 'data_export.requested', subjectType: 'DataExport', subjectId: created.id, after: { includeFiles: body.includeFiles } });
        return created;
      });
    } catch (error) {
      if (hasSqlState(error, UNIQUE_VIOLATION)) throw new ExportInProgressError({ cause: error });
      throw error;
    }
  }

  async list(principal: Principal): Promise<DataExportListResponse> {
    assertMayExport(principal);
    return { items: await this.runner.withTenantTransaction((tx) => this.exports.list(tx, principal.tenantId)) };
  }

  async get(principal: Principal, id: string): Promise<DataExportResponse> {
    assertMayExport(principal);
    const found = await this.runner.withTenantTransaction((tx) => this.exports.find(tx, principal.tenantId, id));
    if (found === undefined) throw new NotFoundError();
    return found;
  }

  private async enforceRequestRate(userId: string): Promise<void> {
    const result = await this.limiter.hit(`data-export-request:user:${userId}`, DATA_EXPORT_POLICY.requestsPerUser);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
  }
}
