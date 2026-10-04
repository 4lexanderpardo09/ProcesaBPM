import { Inject, Injectable } from '@nestjs/common';
import { type AnnouncementRequest, NotFoundError, type PlatformAnnouncementResponse } from '@procesabpm/shared';
import { type PlatformTransaction, PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { LoginBlockRegistry } from '../../announcements/application/login-block-registry.js';
import { AnnouncementAdminRepository } from '../data/announcement-admin.repository.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

const audienceOf = (announcement: PlatformAnnouncementResponse) => ({ audience: announcement.audience, tenantIds: announcement.tenantIds });

/**
 * Notices from the platform to every tenant or to some of them (maintenance windows, release notes). After a change the
 * login block cache of this instance is dropped; the other instances see it within 30 s.
 */
@Injectable()
export class AnnouncementAdminService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(AnnouncementAdminRepository) private readonly announcements: AnnouncementAdminRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
    @Inject(LoginBlockRegistry) private readonly loginBlocks: LoginBlockRegistry,
  ) {}

  list(): Promise<PlatformAnnouncementResponse[]> {
    return this.runner.run((tx) => this.announcements.list(tx));
  }

  create(actorUserId: string, request: AnnouncementRequest): Promise<PlatformAnnouncementResponse> {
    return this.changing(async (tx) => {
      const created = await this.announcements.create(tx, request);
      await this.audit.record(tx, {
        actorUserId,
        action: PLATFORM_AUDIT_ACTIONS.announcementCreated,
        data: { id: created.id, type: created.type, title: created.title, blocksLogin: created.blocksLogin, ...audienceOf(created) },
      });
      return created;
    });
  }

  update(actorUserId: string, id: string, request: AnnouncementRequest): Promise<PlatformAnnouncementResponse> {
    return this.changing(async (tx) => {
      const updated = await this.announcements.update(tx, id, request);
      if (updated === undefined) throw new NotFoundError();
      await this.audit.record(tx, {
        actorUserId,
        action: PLATFORM_AUDIT_ACTIONS.announcementUpdated,
        data: { id, title: updated.title, type: updated.type, startsAt: updated.startsAt, endsAt: updated.endsAt, blocksLogin: updated.blocksLogin, ...audienceOf(updated) },
      });
      return updated;
    });
  }

  delete(actorUserId: string, id: string): Promise<void> {
    return this.changing(async (tx) => {
      if (!(await this.announcements.delete(tx, id))) throw new NotFoundError();
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.announcementDeleted, data: { id } });
    });
  }

  /** Invalidates after COMMIT, so the next read of the cache cannot see the old rows again. */
  private async changing<T>(work: (tx: PlatformTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.runner.run(work);
    } finally {
      this.loginBlocks.invalidate();
    }
  }
}
