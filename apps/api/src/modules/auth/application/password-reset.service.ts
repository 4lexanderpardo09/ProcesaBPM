import { Inject, Injectable } from '@nestjs/common';
import type { Organization } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { generateOpaqueToken, sha256Hex } from '../../../infrastructure/security/token-utils.js';
import { CredentialsRepository } from '../data/credentials.repository.js';
import { OutboxRepository } from '../data/outbox.repository.js';
import { PASSWORD_RESET_EMAIL_EVENT, PASSWORD_RESET_TTL_MS } from '../domain/auth-policy.js';
import { OneTimeTokenService } from './one-time-token.service.js';

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly authRunner: AuthTransactionRunner,
    @Inject(TenantTransactionRunner) private readonly tenantRunner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(OutboxRepository) private readonly outbox: OutboxRepository,
    @Inject(OneTimeTokenService) private readonly oneTimeTokens: OneTimeTokenService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  /**
   * The caller always gets the same answer. For an active account, a 30-minute token is issued and
   * the e-mail is queued in the outbox; the worker will send it.
   */
  async request(email: string): Promise<void> {
    const candidate = await this.authRunner.withAnonymousTransaction((tx) => this.credentials.findLoginCandidate(tx, email));
    if (candidate?.status !== 'ACTIVE') return;

    const tenantId = await this.notificationTenant(candidate.id);
    if (tenantId === undefined) {
      this.logger.warn('Password reset skipped: the user belongs to no organization', { event: 'auth.password_reset_skipped', userId: candidate.id });
      return;
    }

    const token = generateOpaqueToken();
    const expiresAt = new Date(this.clock.now().getTime() + PASSWORD_RESET_TTL_MS);
    await this.authRunner.withAnonymousTransaction((tx) =>
      this.credentials.issueToken(tx, { userId: candidate.id, type: 'PASSWORD_RESET', tokenHash: sha256Hex(token), expiresAt }),
    );
    await this.tenantContext.run({ tenantId, userId: candidate.id }, () =>
      this.tenantRunner.withTenantTransaction((tx) =>
        this.outbox.enqueue(tx, tenantId, PASSWORD_RESET_EMAIL_EVENT, {
          userId: candidate.id,
          email,
          token,
          expiresAt: expiresAt.toISOString(),
        }),
      ),
    );
  }

  /** Sets the new password; the database also clears the lockout and revokes every session. */
  async confirm(token: string, newPassword: string): Promise<void> {
    await this.oneTimeTokens.consume('PASSWORD_RESET', token, newPassword);
  }

  /**
   * The outbox belongs to a tenant, but a password is global: the e-mail is queued in an organization
   * of the user, preferring an active membership.
   */
  private async notificationTenant(userId: string): Promise<string | undefined> {
    const organizations = await this.authRunner.withUserTransaction(userId, (tx) => this.credentials.listOrganizations(tx, userId));
    const preferred = (organization: Organization) => (organization.membershipStatus === 'ACTIVE' ? 0 : 1);
    return [...organizations].sort((a, b) => preferred(a) - preferred(b))[0]?.tenantId;
  }
}
