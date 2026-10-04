import { Inject, Injectable } from '@nestjs/common';
import type { AnnouncementResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ActiveAnnouncementRepository } from '../data/active-announcement.repository.js';

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(AuthTransactionRunner) private readonly authRunner: AuthTransactionRunner,
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(ActiveAnnouncementRepository) private readonly announcements: ActiveAnnouncementRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** In force now, for the caller's organization. */
  listActive(): Promise<AnnouncementResponse[]> {
    const { tenantId } = this.tenantContext.require();
    return this.runner.withTenantTransaction((tx) => this.announcements.listForTenant(tx, tenantId, this.clock.now()));
  }

  /** In force now and meant for every organization: the banner of the sign-in page. */
  listPublic(): Promise<AnnouncementResponse[]> {
    return this.authRunner.withAnonymousTransaction((tx) => this.announcements.listForEveryTenant(tx, this.clock.now()));
  }
}
