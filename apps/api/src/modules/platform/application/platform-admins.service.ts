import { Inject, Injectable } from '@nestjs/common';
import {
  DuplicateError,
  InvalidReferenceError,
  type InvitePlatformAdminRequest,
  LastPlatformAdminError,
  NotFoundError,
  type PlatformAdminSummary,
} from '@procesabpm/shared';
import { PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { PLATFORM_ADMIN_INVITATION_EVENT } from '../../../infrastructure/outbox/platform-event-types.js';
import { PlatformOutboxRepository } from '../../../infrastructure/outbox/platform-outbox.repository.js';
import { PlatformAdminRepository } from '../data/platform-admin.repository.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

/**
 * Who administers the platform. Inviting sends the "choose your password" e-mail (MFA is enrolled at the first login);
 * revoking ends the person's platform sessions at once and never leaves the platform without an administrator who can sign in.
 */
@Injectable()
export class PlatformAdminsService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(PlatformAdminRepository) private readonly admins: PlatformAdminRepository,
    @Inject(PlatformOutboxRepository) private readonly outbox: PlatformOutboxRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
  ) {}

  list(): Promise<PlatformAdminSummary[]> {
    return this.runner.run((tx) => this.admins.list(tx));
  }

  invite(actorUserId: string, request: InvitePlatformAdminRequest): Promise<PlatformAdminSummary> {
    return this.runner.run(async (tx) => {
      const existing = await this.admins.findUserByEmail(tx, request.email);
      if (existing !== undefined && existing.status !== 'ACTIVE') throw new InvalidReferenceError('The e-mail belongs to an account that is not active');
      const userId = existing?.id ?? (await this.admins.createUser(tx, request));
      if ((await this.admins.lockAll(tx)).some((admin) => admin.userId === userId)) throw new DuplicateError('The user is already a platform admin');
      await this.admins.add(tx, userId);
      await this.outbox.enqueue(tx, PLATFORM_ADMIN_INVITATION_EVENT, { userId });
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.adminInvited, data: { userId, email: request.email } });
      const added = (await this.admins.list(tx)).find((admin) => admin.userId === userId);
      return added!;
    });
  }

  revoke(actorUserId: string, userId: string): Promise<void> {
    return this.runner.run(async (tx) => {
      const current = await this.admins.lockAll(tx);
      if (!current.some((admin) => admin.userId === userId)) throw new NotFoundError();
      // Someone who can actually sign in must remain: counting an unusable admin would leave the platform without one.
      if (!current.some((admin) => admin.userId !== userId && admin.usable)) throw new LastPlatformAdminError();
      await this.admins.remove(tx, userId);
      await this.admins.revokePlatformSessions(tx, userId);
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.adminRevoked, data: { userId, self: actorUserId === userId } });
    });
  }
}
