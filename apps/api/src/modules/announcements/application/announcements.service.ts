import { Inject, Injectable } from '@nestjs/common';
import type { AnnouncementResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ActiveAnnouncementRepository } from '../data/active-announcement.repository.js';

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(ActiveAnnouncementRepository) private readonly announcements: ActiveAnnouncementRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  listActive(): Promise<AnnouncementResponse[]> {
    return this.runner.withTenantTransaction((tx) => this.announcements.listActive(tx, this.clock.now()));
  }
}
