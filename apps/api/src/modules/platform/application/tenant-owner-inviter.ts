import { Inject, Injectable } from '@nestjs/common';
import { InvalidReferenceError } from '@procesabpm/shared';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';
import { INVITATION_EVENT } from '../../../infrastructure/outbox/platform-event-types.js';
import { PlatformOutboxRepository } from '../../../infrastructure/outbox/platform-outbox.repository.js';
import { TenantOwnerRepository, type OwnerIdentity } from '../data/tenant-owner.repository.js';

export interface OwnerInvitationTarget {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly adminRoleId: string;
  readonly companyId: string;
}

/**
 * Gives the new tenant its owner: an identity without a password (or the existing one), the owner
 * membership and the invitation e-mail. The event carries only ids: the worker issues the one-time token.
 */
@Injectable()
export class TenantOwnerInviter {
  constructor(
    @Inject(TenantOwnerRepository) private readonly repository: TenantOwnerRepository,
    @Inject(PlatformOutboxRepository) private readonly outbox: PlatformOutboxRepository,
  ) {}

  /** Fails early, before anything is created, when the e-mail belongs to a disabled account. */
  async assertEmailCanOwn(tx: PlatformTransaction, email: string): Promise<void> {
    const status = await this.repository.findUserStatus(tx, email);
    if (status === 'DISABLED') throw new InvalidReferenceError('The owner e-mail belongs to a disabled account');
  }

  /** The transaction scope must already carry the tenant (`invite_user` requires it). */
  async invite(tx: PlatformTransaction, owner: OwnerIdentity, target: OwnerInvitationTarget): Promise<string> {
    const userId = await this.repository.inviteUser(tx, owner);
    await this.repository.createOwnerMembership(tx, { tenantId: target.tenantId, userId, roleId: target.adminRoleId, companyId: target.companyId });
    await this.outbox.enqueue(tx, INVITATION_EVENT, { tenantId: target.tenantId, userId });
    return userId;
  }
}
