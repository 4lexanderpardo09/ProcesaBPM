import { Inject, Injectable } from '@nestjs/common';
import { InvalidReferenceError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';
import { PlatformOutboxRepository } from '../../../infrastructure/outbox/platform-outbox.repository.js';
import { generateOpaqueToken, sha256Hex } from '../../../infrastructure/security/token-utils.js';
import { TenantOwnerRepository, type OwnerIdentity } from '../data/tenant-owner.repository.js';
import { INVITATION_EMAIL_EVENT, OWNER_INVITATION_TTL_MS } from '../domain/tenant-signup-policy.js';

export interface OwnerInvitationTarget {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly adminRoleId: string;
  readonly companyId: string;
}

/**
 * Gives the new tenant its owner: an identity without a password (or the existing one), the owner
 * membership and a one-time invitation link. The clear token only travels in the platform outbox
 * payload, which only the worker can read; the database keeps its hash.
 */
@Injectable()
export class TenantOwnerInviter {
  constructor(
    @Inject(TenantOwnerRepository) private readonly repository: TenantOwnerRepository,
    @Inject(PlatformOutboxRepository) private readonly outbox: PlatformOutboxRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** Fails early, before anything is created, when the e-mail belongs to a disabled account. */
  async assertEmailCanOwn(tx: PlatformTransaction, email: string): Promise<void> {
    const status = await this.repository.findUserStatus(tx, email);
    if (status === 'DISABLED') throw new InvalidReferenceError('The owner e-mail belongs to a disabled account');
  }

  /** The transaction scope must already carry the tenant (`invite_user` and the token function require it). */
  async invite(tx: PlatformTransaction, owner: OwnerIdentity, target: OwnerInvitationTarget): Promise<string> {
    const userId = await this.repository.inviteUser(tx, owner);
    await this.repository.createOwnerMembership(tx, { tenantId: target.tenantId, userId, roleId: target.adminRoleId, companyId: target.companyId });

    const token = generateOpaqueToken();
    const expiresAt = new Date(this.clock.now().getTime() + OWNER_INVITATION_TTL_MS);
    await this.repository.issueInvitationToken(tx, { userId, tokenHash: sha256Hex(token), expiresAt });
    await this.outbox.enqueue(tx, INVITATION_EMAIL_EVENT, {
      userId,
      email: owner.email,
      tenantId: target.tenantId,
      tenantName: target.tenantName,
      token,
      expiresAt: expiresAt.toISOString(),
    });
    return userId;
  }
}
