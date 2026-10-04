import { Inject, Injectable } from '@nestjs/common';
import type { AnnouncementResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ActiveAnnouncementRepository } from '../data/active-announcement.repository.js';
import { LoginBlockRegistry } from './login-block-registry.js';

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(ActiveAnnouncementRepository) private readonly announcements: ActiveAnnouncementRepository,
    @Inject(LoginBlockRegistry) private readonly loginBlocks: LoginBlockRegistry,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** In force now, for the caller's organization. */
  listActive(): Promise<AnnouncementResponse[]> {
    const { tenantId } = this.tenantContext.require();
    return this.runner.withTenantTransaction((tx) => this.announcements.listForTenant(tx, tenantId, this.clock.now()));
  }

  /** The banner of the sign-in page: the sign-in blocks for every organization in force now, from the 30 s cache. */
  listPublic(): Promise<AnnouncementResponse[]> {
    return this.loginBlocks.publicNotices();
  }
}
