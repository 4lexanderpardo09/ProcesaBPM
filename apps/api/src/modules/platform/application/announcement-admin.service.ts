import { Inject, Injectable } from '@nestjs/common';
import { type AnnouncementRequest, type AnnouncementResponse, NotFoundError } from '@procesabpm/shared';
import { PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { AnnouncementAdminRepository } from '../data/announcement-admin.repository.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

/** Notices from the platform to every tenant (maintenance windows, release notes). */
@Injectable()
export class AnnouncementAdminService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(AnnouncementAdminRepository) private readonly announcements: AnnouncementAdminRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
  ) {}

  list(): Promise<AnnouncementResponse[]> {
    return this.runner.run((tx) => this.announcements.list(tx));
  }

  create(actorUserId: string, request: AnnouncementRequest): Promise<AnnouncementResponse> {
    return this.runner.run(async (tx) => {
      const created = await this.announcements.create(tx, request);
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.announcementCreated, data: { id: created.id, type: created.type, title: created.title } });
      return created;
    });
  }

  update(actorUserId: string, id: string, request: AnnouncementRequest): Promise<AnnouncementResponse> {
    return this.runner.run(async (tx) => {
      const updated = await this.announcements.update(tx, id, request);
      if (updated === undefined) throw new NotFoundError();
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.announcementUpdated, data: { id, title: updated.title, type: updated.type, startsAt: updated.startsAt, endsAt: updated.endsAt, blocksLogin: updated.blocksLogin } });
      return updated;
    });
  }

  delete(actorUserId: string, id: string): Promise<void> {
    return this.runner.run(async (tx) => {
      if (!(await this.announcements.delete(tx, id))) throw new NotFoundError();
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.announcementDeleted, data: { id } });
    });
  }
}
