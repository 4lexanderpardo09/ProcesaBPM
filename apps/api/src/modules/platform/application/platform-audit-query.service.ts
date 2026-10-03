import { Inject, Injectable } from '@nestjs/common';
import type { ListPlatformAuditQuery, Page, PlatformAuditEntryResponse } from '@procesabpm/shared';
import { PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { PlatformAuditQueryRepository } from '../data/platform-audit-query.repository.js';

@Injectable()
export class PlatformAuditQueryService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(PlatformAuditQueryRepository) private readonly audit: PlatformAuditQueryRepository,
  ) {}

  list(query: ListPlatformAuditQuery): Promise<Page<PlatformAuditEntryResponse>> {
    return this.runner.run((tx) => this.audit.list(tx, query));
  }
}
