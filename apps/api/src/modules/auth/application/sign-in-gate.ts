import { Inject, Injectable } from '@nestjs/common';
import type { MaintenanceError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { LoginBlockRegistry } from '../../announcements/application/login-block-registry.js';
import { maintenanceErrorFor } from '../../announcements/domain/login-block-policy.js';
import { CredentialsRepository } from '../data/credentials.repository.js';

/**
 * Whether a sign-in may complete while a platform announcement for every organization blocks it. Platform
 * administrators always get through: they are the ones who must end the maintenance. Only asked after the password (or
 * with a challenge that proves it), so it adds no signal about which accounts exist.
 */
@Injectable()
export class SignInGate {
  constructor(
    @Inject(LoginBlockRegistry) private readonly blocks: LoginBlockRegistry,
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** The refusal for `userId`, if any. `platformAdmin` saves the lookup when the caller already knows it. */
  async refusalFor(userId: string, platformAdmin?: boolean): Promise<MaintenanceError | undefined> {
    const block = await this.blocks.blockFor('SIGN_IN');
    if (block === undefined) return undefined;
    if (platformAdmin ?? (await this.isPlatformAdmin(userId))) return undefined;
    return maintenanceErrorFor(block, this.clock.now());
  }

  async assertOpen(userId: string): Promise<void> {
    const refusal = await this.refusalFor(userId);
    if (refusal !== undefined) throw refusal;
  }

  private isPlatformAdmin(userId: string): Promise<boolean> {
    return this.runner.withUserTransaction(userId, (tx) => this.credentials.isPlatformAdmin(tx, userId));
  }
}
